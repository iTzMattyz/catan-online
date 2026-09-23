/**
 * Plays a complete game against itself and narrates it.
 *
 *   npm run simulate            -- random seed, 4 players
 *   npm run simulate -- 8 3     -- seed 8, 3 players
 *   npm run simulate -- 8 3 large  -- same, on the large island
 *
 * The bot is deliberately ordinary: it wants high-probability corners, upgrades
 * to cities when it can, and trades away surpluses. It exists to exercise the
 * engine end to end, not to play well.
 */
import { parseHexId, type EdgeId, type HexId, type VertexId } from '../shared/layout';
import { MAPS, graphOf, isMapId } from '../shared/scenario';
import {
  applyAction,
  bankRate,
  createGame,
  legalMoves,
  playerById,
  publicVictoryPoints,
  totalVictoryPoints,
  type LegalMoves,
} from '../shared/rules';
import {
  BUILD_COSTS,
  RESOURCES,
  TERRAIN_YIELD,
  emptyResources,
  type Action,
  type GameState,
  type PlayerId,
  type Resource,
  type ResourceCounts,
} from '../shared/types';

const NAMES = ['Ann', 'Bob', 'Cid', 'Dee'];

const seed = Number(process.argv[2] ?? Math.floor(Math.random() * 100000));
const playerCount = Math.min(4, Math.max(2, Number(process.argv[3] ?? 4)));
const map = isMapId(process.argv[4]) ? process.argv[4] : 'classic';

// --- helpers ---------------------------------------------------------------

/** How many of the 36 dice combinations hit this token. 6 and 8 are the best. */
function pips(token: number | null): number {
  return token === null ? 0 : 6 - Math.abs(7 - token);
}

function hexPips(state: GameState, hex: HexId): number {
  const h = state.board.hexes[hex];
  return TERRAIN_YIELD[h.terrain] ? pips(h.token) : 0;
}

/** What a corner is worth: total probability, plus a nudge toward variety. */
function vertexScore(state: GameState, vertex: VertexId, owner: PlayerId): number {
  const hexes = graphOf(state.board).vertexHexes[vertex];
  let score = 0;
  const kinds = new Set<Resource>();
  for (const h of hexes) {
    const resource = TERRAIN_YIELD[state.board.hexes[h].terrain];
    if (!resource) continue;
    score += hexPips(state, h);
    kinds.add(resource);
  }
  score += kinds.size * 1.5;

  const owned = new Set<Resource>();
  for (const [v, b] of Object.entries(state.board.buildings)) {
    if (b.owner !== owner) continue;
    for (const h of graphOf(state.board).vertexHexes[v]) {
      const r = TERRAIN_YIELD[state.board.hexes[h].terrain];
      if (r) owned.add(r);
    }
  }
  for (const k of kinds) if (!owned.has(k)) score += 2;

  if (state.board.ports.some((p) => p.vertices.includes(vertex))) score += 1.5;
  return score;
}

function best<T>(items: readonly T[], score: (item: T) => number): T | undefined {
  let winner: T | undefined;
  let top = -Infinity;
  for (const item of items) {
    const s = score(item);
    if (s > top) {
      top = s;
      winner = item;
    }
  }
  return winner;
}

/** Which resources this player is short of for the thing they want next. */
function shortfall(state: GameState, id: PlayerId): ResourceCounts {
  const me = playerById(state, id)!;
  const goal = me.pieces.city > 0 && Object.values(state.board.buildings).some((b) => b.owner === id && b.type === 'settlement')
    ? BUILD_COSTS.city
    : BUILD_COSTS.settlement;
  const need = emptyResources();
  for (const r of RESOURCES) need[r] = Math.max(0, goal[r] - me.resources[r]);
  return need;
}

/** Dump a surplus into something the player actually needs. */
function bankSwap(state: GameState, id: PlayerId, moves: LegalMoves): Action | null {
  const me = playerById(state, id)!;
  const need = shortfall(state, id);
  const wanted = RESOURCES.find((r) => need[r] > 0 && state.bank[r] > 0);
  if (!wanted) return null;
  const give = best(
    RESOURCES.filter((r) => r !== wanted && me.resources[r] >= moves.bankRates[r] + need[r]),
    (r) => me.resources[r] - bankRate(state, id, r),
  );
  return give ? { type: 'bankTrade', give, want: wanted } : null;
}

/** Park the robber where it hurts the leader most, and never on your own hex. */
function robberTarget(state: GameState, id: PlayerId, moves: LegalMoves): HexId {
  const scored = moves.robberSpots.map((h) => {
    let score = 0;
    for (const v of graphOf(state.board).hexVertices[h]) {
      const b = state.board.buildings[v];
      if (!b) continue;
      if (b.owner === id) return { h, score: -100 }; // never block yourself
      const weight = b.type === 'city' ? 2 : 1;
      score += hexPips(state, h) * weight * (1 + publicVictoryPoints(state, b.owner) / 10);
    }
    return { h, score };
  });
  return (best(scored, (s) => s.score) ?? { h: moves.robberSpots[0] }).h;
}

function discardChoice(state: GameState, id: PlayerId): ResourceCounts {
  const me = playerById(state, id)!;
  const need = shortfall(state, id);
  const out = emptyResources();
  let left = state.pendingDiscards[id];
  // Give up whatever is furthest from what the next build needs.
  const order = [...RESOURCES].sort((a, b) => me.resources[b] - need[b] - (me.resources[a] - need[a]));
  for (const r of order) {
    const take = Math.min(left, me.resources[r]);
    out[r] = take;
    left -= take;
    if (left === 0) break;
  }
  return out;
}

/** The road that opens up the most valuable new corner. */
function roadTowardValue(state: GameState, id: PlayerId, spots: EdgeId[]): EdgeId {
  return (
    best(spots, (e) => {
      let score = 0;
      for (const v of graphOf(state.board).edges[e].vertices) {
        if (state.board.buildings[v]) continue;
        const blocked = graphOf(state.board).vertexNeighbours[v].some((n) => state.board.buildings[n]);
        if (!blocked) score = Math.max(score, vertexScore(state, v, id));
        for (const n of graphOf(state.board).vertexNeighbours[v]) {
          if (!state.board.buildings[n] && !graphOf(state.board).vertexNeighbours[n].some((x) => state.board.buildings[x])) {
            score = Math.max(score, vertexScore(state, n, id) * 0.6);
          }
        }
      }
      return score;
    }) ?? spots[0]
  );
}

/** Pick the one move the bot wants to make, or null to end the turn. */
function decide(state: GameState, id: PlayerId): Action | null {
  const moves = legalMoves(state, id);
  const me = playerById(state, id)!;

  if (state.phase === 'setup') {
    return moves.settlementSpots.length
      ? { type: 'placeSetupSettlement', vertex: best(moves.settlementSpots, (v) => vertexScore(state, v, id))! }
      : { type: 'placeSetupRoad', edge: roadTowardValue(state, id, moves.roadSpots) };
  }
  if (state.phase === 'movingRobber') return { type: 'moveRobber', hex: robberTarget(state, id, moves) };
  if (state.phase === 'stealing') {
    return {
      type: 'steal',
      target: best(moves.stealTargets, (t) => playerById(state, t)!.pieces.road + publicVictoryPoints(state, t))!,
    };
  }
  if (moves.canRoll) {
    // A knight before the roll is free value when the robber is on your land.
    const robbed = graphOf(state.board).hexVertices[state.board.robber].some((v) => state.board.buildings[v]?.owner === id);
    if (robbed && moves.playableDevCards.includes('knight')) return { type: 'playKnight' };
    return { type: 'rollDice' };
  }

  if (state.phase !== 'main') return null;

  if (moves.citySpots.length) {
    return { type: 'buildCity', vertex: best(moves.citySpots, (v) => vertexScore(state, v, id))! };
  }
  if (moves.settlementSpots.length) {
    return { type: 'buildSettlement', vertex: best(moves.settlementSpots, (v) => vertexScore(state, v, id))! };
  }
  if (moves.playableDevCards.includes('knight') && me.knightsPlayed >= state.largestArmy.size) {
    return { type: 'playKnight' };
  }
  if (moves.playableDevCards.includes('monopoly')) {
    const take = best(RESOURCES, (r) => state.players.filter((p) => p.id !== id).reduce((n, p) => n + p.resources[r], 0))!;
    return { type: 'playMonopoly', resource: take };
  }
  if (moves.playableDevCards.includes('yearOfPlenty')) {
    const need = shortfall(state, id);
    const picks = RESOURCES.filter((r) => need[r] > 0 && state.bank[r] > 0);
    if (picks.length) return { type: 'playYearOfPlenty', resources: [picks[0], picks[1] ?? picks[0]] };
  }
  if (moves.playableDevCards.includes('roadBuilding') && moves.roadSpots.length) {
    return { type: 'playRoadBuilding' };
  }
  if (moves.roadSpots.length && (state.freeRoads > 0 || me.pieces.road > 3)) {
    return { type: 'buildRoad', edge: roadTowardValue(state, id, moves.roadSpots) };
  }
  if (moves.canBuyDevCard) return { type: 'buyDevCard' };

  const swap = bankSwap(state, id, moves);
  if (swap) return swap;

  return moves.canEndTurn ? { type: 'endTurn' } : null;
}

// --- run -------------------------------------------------------------------

const seats = NAMES.slice(0, playerCount).map((name, i) => ({ id: `p${i + 1}`, name }));
let state = createGame(seats, seed, MAPS[map]);

const nameOf = (id: PlayerId | null) => (id ? (playerById(state, id)?.name ?? id) : '');
const pad = (s: string, n: number) => s.padEnd(n);

console.log(`\nCATAN — ${playerCount} players, seed ${seed}\n${'='.repeat(46)}\n`);

let lastLogId = 0;
function flushLog(indent = '  ') {
  for (const entry of state.log.filter((e) => e.id > lastLogId)) {
    lastLogId = entry.id;
    const who = entry.player ? `${nameOf(entry.player)} ` : '';
    console.log(`${indent}${who}${entry.text}`);
  }
}

function standings(): string {
  return state.players
    .map((p) => `${p.name} ${publicVictoryPoints(state, p.id)}`)
    .join('   ');
}

let steps = 0;
let turnShown = 0;
const STEP_LIMIT = 20000;

while (!state.winner && steps++ < STEP_LIMIT) {
  // A pending discard blocks everyone until it is paid.
  const debtor = Object.keys(state.pendingDiscards)[0];
  const actor = debtor ?? state.players[state.current].id;
  const action: Action | null = debtor
    ? { type: 'discard', resources: discardChoice(state, debtor) }
    : decide(state, actor);

  if (!action) {
    console.log(`\n!! ${nameOf(actor)} has no legal move in phase ${state.phase}`);
    break;
  }

  if (state.phase !== 'setup' && state.turn > turnShown) {
    turnShown = state.turn;
    console.log(`\nTurn ${state.turn} — ${nameOf(state.players[state.current].id)}`);
  }

  const result = applyAction(state, actor, action);
  if (!result.ok) {
    console.log(`\n!! ${nameOf(actor)} ${action.type} rejected: ${result.error}`);
    break;
  }
  state = result.state;
  flushLog();

  if (state.setup === null && state.phase === 'rolling' && state.turn % 20 === 0 && state.current === 0) {
    console.log(`  -- ${standings()}`);
  }
}

console.log(`\n${'='.repeat(46)}`);
if (!state.winner) {
  console.log(`No winner after ${steps} actions (phase ${state.phase}).`);
} else {
  console.log(`${nameOf(state.winner)} wins on turn ${state.turn}.\n`);
  console.log(`  ${pad('player', 8)}${pad('vp', 5)}${pad('towns', 7)}${pad('cities', 8)}${pad('roads', 7)}knights`);
  for (const p of [...state.players].sort((a, b) => totalVictoryPoints(state, b.id) - totalVictoryPoints(state, a.id))) {
    const own = Object.values(state.board.buildings).filter((b) => b.owner === p.id);
    const towns = own.filter((b) => b.type === 'settlement').length;
    const cities = own.filter((b) => b.type === 'city').length;
    const roads = Object.values(state.board.roads).filter((r) => r.owner === p.id).length;
    const vpCards = p.devCards.filter((c) => c.type === 'victoryPoint').length;
    const badges = [
      state.longestRoad.owner === p.id ? `road ${state.longestRoad.length}` : '',
      state.largestArmy.owner === p.id ? `army ${state.largestArmy.size}` : '',
      vpCards ? `${vpCards} hidden` : '',
    ]
      .filter(Boolean)
      .join(', ');
    console.log(
      `  ${pad(p.name, 8)}${pad(String(totalVictoryPoints(state, p.id)), 5)}${pad(String(towns), 7)}${pad(String(cities), 8)}${pad(String(roads), 7)}${pad(String(p.knightsPlayed), 8)}${badges}`,
    );
  }
}

// Nothing should have leaked or been conjured over a whole game.
for (const r of RESOURCES) {
  const held = state.players.reduce((n, p) => n + p.resources[r], 0);
  if (state.bank[r] + held !== 19) console.log(`!! ${r} conservation broken: ${state.bank[r]} + ${held}`);
}
const cards = state.devDeck.length + state.players.reduce((n, p) => n + p.devCards.length, 0);
if (cards !== 25) console.log(`!! development deck conservation broken: ${cards}`);
console.log('');
