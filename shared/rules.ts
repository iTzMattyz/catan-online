import { type EdgeId, type HexId, type VertexId } from './layout';
import { makeRng, nextInt, rollDie, shuffle } from './rng';
import { BASE_GAME, graphOf, type Scenario } from './scenario';
import { generateBoard } from './setup';
import {
  BUILD_COSTS,
  HAND_LIMIT_BEFORE_DISCARD,
  LARGEST_ARMY_MINIMUM,
  LONGEST_ROAD_MINIMUM,
  PIECE_LIMITS,
  RESOURCES,
  TERRAIN_YIELD,
  VICTORY_POINTS_TO_WIN,
  countResources,
  emptyResources,
  type Action,
  type DevCardType,
  type GameState,
  type Player,
  type PlayerId,
  type Resource,
  type ResourceCounts,
} from './types';

export type ApplyResult = { ok: true; state: GameState } | { ok: false; error: string };

/** 14 knights, 5 victory points, 2 each of the three action cards. */
const DEV_DECK: readonly { type: DevCardType; count: number }[] = [
  { type: 'knight', count: 14 },
  { type: 'victoryPoint', count: 5 },
  { type: 'roadBuilding', count: 2 },
  { type: 'yearOfPlenty', count: 2 },
  { type: 'monopoly', count: 2 },
];

export const PLAYER_COLORS = ['#d9534f', '#3b7dd8', '#e8a33d', '#4aa96c'] as const;

const BANK_PER_RESOURCE = 19;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function playerById(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

function currentPlayer(state: GameState): Player {
  return state.players[state.current];
}

function otherVertex(edge: EdgeId, from: VertexId): VertexId {
  // An edge id is its two vertex ids joined by '/', so no graph lookup is needed.
  const [a, b] = edge.split('/');
  return a === from ? b : a;
}

export function canAfford(p: Player, cost: ResourceCounts): boolean {
  return RESOURCES.every((r) => p.resources[r] >= cost[r]);
}

function pay(state: GameState, p: Player, cost: ResourceCounts): void {
  for (const r of RESOURCES) {
    p.resources[r] -= cost[r];
    state.bank[r] += cost[r];
  }
}

/** Draw from the bank, capped by what the bank actually holds. */
function gain(state: GameState, p: Player, resource: Resource, amount: number): number {
  const given = Math.min(amount, state.bank[resource]);
  p.resources[resource] += given;
  state.bank[resource] -= given;
  return given;
}

function addLog(state: GameState, player: PlayerId | null, text: string): void {
  state.log.push({ id: state.nextLogId++, turn: state.turn, player, text });
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
}

function describe(counts: ResourceCounts): string {
  const parts = RESOURCES.filter((r) => counts[r] > 0).map((r) => `${counts[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}

function isEmpty(counts: ResourceCounts): boolean {
  return countResources(counts) === 0;
}

/** Normalise a client-supplied bundle so a hostile payload cannot inject junk. */
function sanitiseCounts(input: unknown): ResourceCounts {
  const out = emptyResources();
  if (typeof input !== 'object' || input === null) return out;
  const record = input as Record<string, unknown>;
  for (const r of RESOURCES) {
    const n = record[r];
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[r] = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Board queries
// ---------------------------------------------------------------------------

/** A settlement may not touch another building, its owner's included. */
export function respectsDistanceRule(state: GameState, vertex: VertexId): boolean {
  if (state.board.buildings[vertex]) return false;
  return graphOf(state.board).vertexNeighbours[vertex].every((v) => !state.board.buildings[v]);
}

/**
 * A road must touch one of your own buildings, or one of your own roads at a
 * vertex an opponent has not built on — you cannot extend a network *through*
 * someone else's settlement.
 */
export function roadConnects(state: GameState, id: PlayerId, edge: EdgeId): boolean {
  return graphOf(state.board).edges[edge].vertices.some((v) => {
    const building = state.board.buildings[v];
    if (building) return building.owner === id;
    return graphOf(state.board).vertexEdges[v].some((e) => e !== edge && state.board.roads[e]?.owner === id);
  });
}

export function canPlaceRoad(state: GameState, id: PlayerId, edge: EdgeId): boolean {
  if (!graphOf(state.board).edges[edge] || state.board.roads[edge]) return false;
  return roadConnects(state, id, edge);
}

export function canPlaceSettlement(state: GameState, id: PlayerId, vertex: VertexId): boolean {
  if (!graphOf(state.board).vertices[vertex] || !respectsDistanceRule(state, vertex)) return false;
  return graphOf(state.board).vertexEdges[vertex].some((e) => state.board.roads[e]?.owner === id);
}

/** Harbour types a player can use, via buildings standing on harbour vertices. */
export function portsOf(state: GameState, id: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const port of state.board.ports) {
    if (port.vertices.some((v) => state.board.buildings[v]?.owner === id)) out.add(port.type);
  }
  return out;
}

/** 2 with the matching harbour, 3 with a generic harbour, otherwise 4. */
export function bankRate(state: GameState, id: PlayerId, give: Resource): number {
  const ports = portsOf(state, id);
  if (ports.has(give)) return 2;
  if (ports.has('any')) return 3;
  return 4;
}

/**
 * Longest unbroken road for one player: depth-first over their own edges, never
 * reusing an edge, stopping dead at any vertex holding an opponent's building —
 * which is exactly how an opponent "breaks" a road. Networks cap at 15 edges, so
 * the exponential worst case never materialises.
 */
export function longestRoadLength(state: GameState, id: PlayerId): number {
  const mine = Object.keys(state.board.roads).filter((e) => state.board.roads[e].owner === id);
  if (mine.length === 0) return 0;

  const used = new Set<EdgeId>();
  const walk = (vertex: VertexId): number => {
    let best = 0;
    for (const edge of graphOf(state.board).vertexEdges[vertex]) {
      if (used.has(edge) || state.board.roads[edge]?.owner !== id) continue;
      const next = otherVertex(edge, vertex);
      const blocker = state.board.buildings[next];
      used.add(edge);
      best = Math.max(best, 1 + (blocker && blocker.owner !== id ? 0 : walk(next)));
      used.delete(edge);
    }
    return best;
  };

  const starts = new Set<VertexId>();
  for (const e of mine) for (const v of graphOf(state.board).edges[e].vertices) starts.add(v);
  let best = 0;
  for (const v of starts) best = Math.max(best, walk(v));
  return best;
}

function buildingsOf(state: GameState, id: PlayerId) {
  return Object.values(state.board.buildings).filter((b) => b.owner === id);
}

/** Points everyone can see — victory point cards stay hidden until someone wins. */
export function publicVictoryPoints(state: GameState, id: PlayerId): number {
  let vp = 0;
  for (const b of buildingsOf(state, id)) vp += b.type === 'city' ? 2 : 1;
  if (state.longestRoad.owner === id) vp += 2;
  if (state.largestArmy.owner === id) vp += 2;
  return vp;
}

export function totalVictoryPoints(state: GameState, id: PlayerId): number {
  const p = playerById(state, id);
  const hidden = p ? p.devCards.filter((c) => c.type === 'victoryPoint').length : 0;
  return publicVictoryPoints(state, id) + hidden;
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

/**
 * Longest road is re-derived from scratch after anything that could change a road
 * network. The holder keeps the card while still tied for longest; if they fall
 * behind and the new lead is a tie, the card goes to nobody until it is settled.
 */
function updateLongestRoad(state: GameState): void {
  const lengths = new Map<PlayerId, number>();
  for (const p of state.players) lengths.set(p.id, longestRoadLength(state, p.id));

  const best = Math.max(0, ...lengths.values());
  const holder = state.longestRoad.owner;

  if (best < LONGEST_ROAD_MINIMUM) {
    if (holder) addLog(state, null, 'Longest Road is no longer held.');
    state.longestRoad = { owner: null, length: best };
    return;
  }

  const leaders = [...lengths].filter(([, n]) => n === best).map(([id]) => id);
  if (holder && leaders.includes(holder)) {
    state.longestRoad = { owner: holder, length: best };
    return;
  }
  const winner = leaders.length === 1 ? leaders[0] : null;
  state.longestRoad = { owner: winner, length: best };
  if (winner) addLog(state, winner, `takes Longest Road (${best} segments).`);
  else if (holder) addLog(state, null, 'Longest Road is contested and goes unheld.');
}

function updateLargestArmy(state: GameState, id: PlayerId): void {
  const p = playerById(state, id)!;
  if (p.knightsPlayed >= LARGEST_ARMY_MINIMUM && p.knightsPlayed > state.largestArmy.size) {
    if (state.largestArmy.owner !== id) addLog(state, id, `takes Largest Army (${p.knightsPlayed} knights).`);
    state.largestArmy = { owner: id, size: p.knightsPlayed };
  }
}

/** Only ever called on the acting player's own turn, per the official rule. */
function checkWinner(state: GameState): void {
  const p = currentPlayer(state);
  const vp = totalVictoryPoints(state, p.id);
  if (vp >= VICTORY_POINTS_TO_WIN) {
    state.winner = p.id;
    state.phase = 'finished';
    addLog(state, p.id, `wins the game with ${vp} victory points!`);
  }
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function createGame(
  seats: { id: PlayerId; name: string }[],
  seed?: number,
  scenario: Scenario = BASE_GAME,
): GameState {
  const rng = makeRng(seed);
  const deck: DevCardType[] = [];
  for (const { type, count } of DEV_DECK) for (let i = 0; i < count; i++) deck.push(type);

  const players: Player[] = seats.map((s, i) => ({
    id: s.id,
    name: s.name,
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
    seat: i,
    connected: true,
    resources: emptyResources(),
    devCards: [],
    knightsPlayed: 0,
    pieces: { ...PIECE_LIMITS },
  }));

  const bank = emptyResources();
  for (const r of RESOURCES) bank[r] = BANK_PER_RESOURCE;

  const state: GameState = {
    phase: 'setup',
    players,
    board: generateBoard(rng, scenario),
    bank,
    devDeck: shuffle(rng, deck),
    rng,
    turn: 1,
    current: 0,
    dice: null,
    mustRoll: true,
    setup: { round: 1, placing: 'settlement', lastVertex: null },
    pendingDiscards: {},
    stealTargets: [],
    freeRoads: 0,
    playedDevThisTurn: false,
    trade: null,
    longestRoad: { owner: null, length: 0 },
    largestArmy: { owner: null, size: 0 },
    winner: null,
    log: [],
    nextLogId: 1,
  };
  addLog(state, null, 'Setup: place your first settlement.');
  return state;
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

/**
 * Setup is a snake draft: seats in order, then back down. The second settlement
 * pays out the hexes it touches.
 */
function advanceSetup(state: GameState): void {
  const setup = state.setup!;
  const last = state.players.length - 1;

  if (setup.round === 1) {
    if (state.current < last) {
      state.current += 1;
    } else {
      setup.round = 2;
    }
  } else if (state.current > 0) {
    state.current -= 1;
  } else {
    state.setup = null;
    state.phase = 'rolling';
    state.current = 0;
    addLog(state, currentPlayer(state).id, 'begins the first turn.');
    return;
  }
  setup.placing = 'settlement';
  setup.lastVertex = null;
}

/**
 * Resolving a 7 or a Knight hands control back to wherever the turn was: a Knight
 * played before the roll still leaves the roll to be made.
 */
function finishRobber(state: GameState): void {
  state.stealTargets = [];
  state.phase = state.mustRoll ? 'rolling' : 'main';
}

/** After the robber lands: steal automatically when there is only one victim. */
function beginSteal(state: GameState, hex: HexId): void {
  const me = currentPlayer(state);
  const victims = new Set<PlayerId>();
  for (const v of graphOf(state.board).hexVertices[hex]) {
    const b = state.board.buildings[v];
    if (b && b.owner !== me.id && countResources(playerById(state, b.owner)!.resources) > 0) {
      victims.add(b.owner);
    }
  }
  state.stealTargets = [...victims];

  if (state.stealTargets.length === 0) {
    finishRobber(state);
  } else if (state.stealTargets.length === 1) {
    stealFrom(state, state.stealTargets[0]);
    finishRobber(state);
  } else {
    state.phase = 'stealing';
  }
}

function stealFrom(state: GameState, victimId: PlayerId): void {
  const me = currentPlayer(state);
  const victim = playerById(state, victimId)!;
  const hand: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < victim.resources[r]; i++) hand.push(r);
  if (hand.length === 0) return;

  const taken = hand[nextInt(state.rng, hand.length)];
  victim.resources[taken] -= 1;
  me.resources[taken] += 1;
  state.stealTargets = [];
  addLog(state, me.id, `steals a resource from ${victim.name}.`);
}

/**
 * Pay out a roll. If the bank cannot cover everyone owed a given resource, nobody
 * gets any of it — unless exactly one player is owed, who then takes what is left.
 */
function produce(state: GameState, roll: number): void {
  const owed = new Map<PlayerId, ResourceCounts>();
  const demand = emptyResources();

  for (const hexId of graphOf(state.board).hexes) {
    const hex = state.board.hexes[hexId];
    if (hex.token !== roll || hexId === state.board.robber) continue;
    const resource = TERRAIN_YIELD[hex.terrain];
    if (!resource) continue;

    for (const v of graphOf(state.board).hexVertices[hexId]) {
      const b = state.board.buildings[v];
      if (!b) continue;
      const amount = b.type === 'city' ? 2 : 1;
      if (!owed.has(b.owner)) owed.set(b.owner, emptyResources());
      owed.get(b.owner)![resource] += amount;
      demand[resource] += amount;
    }
  }

  for (const resource of RESOURCES) {
    if (demand[resource] === 0) continue;
    const claimants = [...owed].filter(([, c]) => c[resource] > 0);
    if (demand[resource] > state.bank[resource] && claimants.length > 1) {
      addLog(state, null, `The bank runs out of ${resource} — nobody collects it.`);
      for (const [, c] of claimants) c[resource] = 0;
    }
  }

  for (const [id, counts] of owed) {
    const p = playerById(state, id)!;
    const got = emptyResources();
    for (const r of RESOURCES) if (counts[r] > 0) got[r] = gain(state, p, r, counts[r]);
    if (!isEmpty(got)) addLog(state, id, `collects ${describe(got)}.`);
  }
}

function beginRobberPhase(state: GameState): void {
  const owing: Record<PlayerId, number> = {};
  for (const p of state.players) {
    const held = countResources(p.resources);
    if (held > HAND_LIMIT_BEFORE_DISCARD) owing[p.id] = Math.floor(held / 2);
  }
  state.pendingDiscards = owing;
  state.phase = Object.keys(owing).length > 0 ? 'discarding' : 'movingRobber';
  if (state.phase === 'discarding') addLog(state, null, 'Everyone holding more than 7 cards must discard half.');
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

const fail = (error: string): ApplyResult => ({ ok: false, error });

/**
 * The single source of truth. Pure: it clones, validates, mutates the clone, and
 * hands it back. Every rule check lives here, so the client cannot invent a move
 * the server would not also allow.
 */
export function applyAction(state: GameState, playerId: PlayerId, action: Action): ApplyResult {
  const actor = playerById(state, playerId);
  if (!actor) return fail('You are not in this game.');
  if (state.phase === 'finished') return fail('The game is over.');
  if (state.phase === 'lobby') return fail('The game has not started.');

  // Discarding blocks the table, and responding to a trade is the only thing an
  // off-turn player may ever do. Everything else is the current player's alone.
  const offTurnAllowed = action.type === 'discard' || action.type === 'respondTrade';
  if (!offTurnAllowed && currentPlayer(state).id !== playerId) return fail('It is not your turn.');

  const next = structuredClone(state);
  const me = playerById(next, playerId)!;
  const result = reduce(next, me, action);
  return result ?? { ok: true, state: next };
}

/** Returns a failure, or undefined when the mutation succeeded. */
function reduce(state: GameState, me: Player, action: Action): ApplyResult | undefined {
  switch (action.type) {
    // -- setup --------------------------------------------------------------
    case 'placeSetupSettlement': {
      if (state.phase !== 'setup' || state.setup!.placing !== 'settlement') return fail('Not placing a settlement.');
      if (!graphOf(state.board).vertices[action.vertex]) return fail('No such spot.');
      if (!respectsDistanceRule(state, action.vertex)) return fail('Too close to another settlement.');

      state.board.buildings[action.vertex] = { owner: me.id, type: 'settlement' };
      me.pieces.settlement -= 1;
      state.setup!.placing = 'road';
      state.setup!.lastVertex = action.vertex;
      addLog(state, me.id, 'places a settlement.');

      if (state.setup!.round === 2) {
        const got = emptyResources();
        for (const h of graphOf(state.board).vertexHexes[action.vertex]) {
          const resource = TERRAIN_YIELD[state.board.hexes[h].terrain];
          if (resource) got[resource] += gain(state, me, resource, 1);
        }
        if (!isEmpty(got)) addLog(state, me.id, `collects ${describe(got)} from the second settlement.`);
      }
      return;
    }

    case 'placeSetupRoad': {
      if (state.phase !== 'setup' || state.setup!.placing !== 'road') return fail('Not placing a road.');
      const edge = graphOf(state.board).edges[action.edge];
      if (!edge) return fail('No such edge.');
      if (state.board.roads[action.edge]) return fail('There is already a road there.');
      if (!edge.vertices.includes(state.setup!.lastVertex!)) {
        return fail('The road must touch the settlement you just placed.');
      }
      state.board.roads[action.edge] = { owner: me.id };
      me.pieces.road -= 1;
      addLog(state, me.id, 'builds a road.');
      updateLongestRoad(state);
      advanceSetup(state);
      return;
    }

    // -- the roll -----------------------------------------------------------
    case 'rollDice': {
      if (state.phase !== 'rolling') return fail('You cannot roll right now.');
      const dice: [number, number] = [rollDie(state.rng), rollDie(state.rng)];
      state.dice = dice;
      state.mustRoll = false;
      const total = dice[0] + dice[1];
      addLog(state, me.id, `rolls ${total}.`);

      if (total === 7) beginRobberPhase(state);
      else {
        produce(state, total);
        state.phase = 'main';
      }
      return;
    }

    case 'discard': {
      if (state.phase !== 'discarding') return fail('Nobody is discarding.');
      const owed = state.pendingDiscards[me.id];
      if (!owed) return fail('You do not need to discard.');

      const counts = sanitiseCounts(action.resources);
      if (countResources(counts) !== owed) return fail(`You must discard exactly ${owed} cards.`);
      if (!RESOURCES.every((r) => me.resources[r] >= counts[r])) return fail('You do not hold those cards.');

      pay(state, me, counts);
      delete state.pendingDiscards[me.id];
      addLog(state, me.id, `discards ${describe(counts)}.`);
      if (Object.keys(state.pendingDiscards).length === 0) state.phase = 'movingRobber';
      return;
    }

    case 'moveRobber': {
      if (state.phase !== 'movingRobber') return fail('The robber is not waiting to move.');
      if (!state.board.hexes[action.hex]) return fail('No such hex.');
      if (action.hex === state.board.robber) return fail('The robber must move to a different hex.');

      state.board.robber = action.hex;
      addLog(state, me.id, 'moves the robber.');
      beginSteal(state, action.hex);
      return;
    }

    case 'steal': {
      if (state.phase !== 'stealing') return fail('There is nobody to steal from.');
      if (action.target === null) {
        finishRobber(state);
        return;
      }
      if (!state.stealTargets.includes(action.target)) return fail('You cannot steal from that player.');
      stealFrom(state, action.target);
      finishRobber(state);
      return;
    }

    // -- building -----------------------------------------------------------
    case 'buildRoad': {
      if (state.phase !== 'main') return fail('You cannot build right now.');
      if (me.pieces.road <= 0) return fail('You have no road pieces left.');
      if (!canPlaceRoad(state, me.id, action.edge)) return fail('A road cannot go there.');

      const free = state.freeRoads > 0;
      if (!free && !canAfford(me, BUILD_COSTS.road)) return fail('You cannot afford a road.');
      if (free) state.freeRoads -= 1;
      else pay(state, me, BUILD_COSTS.road);

      state.board.roads[action.edge] = { owner: me.id };
      me.pieces.road -= 1;
      addLog(state, me.id, free ? 'builds a free road.' : 'builds a road.');
      updateLongestRoad(state);
      checkWinner(state);
      return;
    }

    case 'buildSettlement': {
      if (state.phase !== 'main') return fail('You cannot build right now.');
      if (me.pieces.settlement <= 0) return fail('You have no settlement pieces left.');
      if (!canPlaceSettlement(state, me.id, action.vertex)) return fail('A settlement cannot go there.');
      if (!canAfford(me, BUILD_COSTS.settlement)) return fail('You cannot afford a settlement.');

      pay(state, me, BUILD_COSTS.settlement);
      state.board.buildings[action.vertex] = { owner: me.id, type: 'settlement' };
      me.pieces.settlement -= 1;
      addLog(state, me.id, 'builds a settlement.');
      // A new settlement can cut an opponent's road in half.
      updateLongestRoad(state);
      checkWinner(state);
      return;
    }

    case 'buildCity': {
      if (state.phase !== 'main') return fail('You cannot build right now.');
      const existing = state.board.buildings[action.vertex];
      if (!existing || existing.owner !== me.id || existing.type !== 'settlement') {
        return fail('You can only upgrade your own settlement.');
      }
      if (me.pieces.city <= 0) return fail('You have no city pieces left.');
      if (!canAfford(me, BUILD_COSTS.city)) return fail('You cannot afford a city.');

      pay(state, me, BUILD_COSTS.city);
      existing.type = 'city';
      me.pieces.city -= 1;
      me.pieces.settlement += 1; // the settlement piece returns to the supply
      addLog(state, me.id, 'upgrades a settlement to a city.');
      checkWinner(state);
      return;
    }

    case 'buyDevCard': {
      if (state.phase !== 'main') return fail('You cannot buy right now.');
      if (state.devDeck.length === 0) return fail('The development card deck is empty.');
      if (!canAfford(me, BUILD_COSTS.devCard)) return fail('You cannot afford a development card.');

      pay(state, me, BUILD_COSTS.devCard);
      const drawn = state.devDeck.pop()!;
      me.devCards.push({ type: drawn, boughtOnTurn: state.turn, played: false });
      addLog(state, me.id, 'buys a development card.');
      checkWinner(state); // a victory point card can end the game immediately
      return;
    }

    // -- development cards ---------------------------------------------------
    case 'playKnight':
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly':
      return playDevCard(state, me, action);

    // -- trading --------------------------------------------------------------
    case 'bankTrade': {
      if (state.phase !== 'main') return fail('You cannot trade right now.');
      if (!RESOURCES.includes(action.give) || !RESOURCES.includes(action.want)) return fail('Unknown resource.');
      if (action.give === action.want) return fail('Trade for a different resource.');

      const rate = bankRate(state, me.id, action.give);
      if (me.resources[action.give] < rate) return fail(`You need ${rate} ${action.give}.`);
      if (state.bank[action.want] < 1) return fail(`The bank has no ${action.want} left.`);

      me.resources[action.give] -= rate;
      state.bank[action.give] += rate;
      gain(state, me, action.want, 1);
      addLog(state, me.id, `trades ${rate} ${action.give} for 1 ${action.want}.`);
      return;
    }

    case 'offerTrade': {
      if (state.phase !== 'main') return fail('You cannot trade right now.');
      if (state.trade) return fail('An offer is already on the table.');

      const give = sanitiseCounts(action.give);
      const want = sanitiseCounts(action.want);
      if (isEmpty(give) || isEmpty(want)) return fail('An offer needs cards on both sides.');
      if (!RESOURCES.every((r) => me.resources[r] >= give[r])) return fail('You do not hold what you are offering.');
      if (!state.players.some((p) => p.id !== me.id && canAfford(p, want))) return fail('Nobody holds what you want.');

      const responses: Record<PlayerId, 'pending' | 'accept' | 'reject'> = {};
      for (const p of state.players) if (p.id !== me.id) responses[p.id] = 'pending';
      state.trade = { from: me.id, give, want, responses };
      addLog(state, me.id, `offers ${describe(give)} for ${describe(want)}.`);
      return;
    }

    case 'respondTrade': {
      if (!state.trade) return fail('There is no offer to answer.');
      if (state.trade.from === me.id) return fail('You cannot answer your own offer.');
      if (action.accept && !canAfford(me, state.trade.want)) return fail('You do not hold what they want.');
      state.trade.responses[me.id] = action.accept ? 'accept' : 'reject';
      return;
    }

    case 'acceptTradeWith': {
      const offer = state.trade;
      if (!offer) return fail('There is no offer on the table.');
      if (offer.from !== me.id) return fail('Only the player who made the offer can close it.');
      if (offer.responses[action.player] !== 'accept') return fail('That player has not accepted.');

      const partner = playerById(state, action.player);
      if (!partner) return fail('Unknown player.');
      if (!RESOURCES.every((r) => me.resources[r] >= offer.give[r])) return fail('You no longer hold your side.');
      if (!RESOURCES.every((r) => partner.resources[r] >= offer.want[r])) return fail('They no longer hold their side.');

      for (const r of RESOURCES) {
        me.resources[r] += offer.want[r] - offer.give[r];
        partner.resources[r] += offer.give[r] - offer.want[r];
      }
      state.trade = null;
      addLog(state, me.id, `trades ${describe(offer.give)} to ${partner.name} for ${describe(offer.want)}.`);
      return;
    }

    case 'cancelTrade': {
      if (!state.trade) return fail('There is no offer to withdraw.');
      if (state.trade.from !== me.id) return fail('Only the player who made the offer can withdraw it.');
      state.trade = null;
      return;
    }

    // -- end of turn ----------------------------------------------------------
    case 'endTurn': {
      if (state.phase !== 'main') return fail('You cannot end your turn yet.');
      state.trade = null;
      state.dice = null;
      state.freeRoads = 0;
      state.playedDevThisTurn = false;
      state.stealTargets = [];
      state.mustRoll = true;
      state.current = (state.current + 1) % state.players.length;
      state.turn += 1;
      state.phase = 'rolling';
      addLog(state, currentPlayer(state).id, 'takes their turn.');
      return;
    }
  }
}

/**
 * One development card per turn, never on the turn it was bought, and never in
 * the middle of resolving a 7. Playing before the roll is allowed.
 */
function playDevCard(state: GameState, me: Player, action: Action): ApplyResult | undefined {
  if (state.phase !== 'main' && state.phase !== 'rolling') return fail('You cannot play a card right now.');
  if (state.playedDevThisTurn) return fail('You have already played a development card this turn.');

  const wanted: DevCardType =
    action.type === 'playKnight'
      ? 'knight'
      : action.type === 'playRoadBuilding'
        ? 'roadBuilding'
        : action.type === 'playYearOfPlenty'
          ? 'yearOfPlenty'
          : 'monopoly';

  const card = me.devCards.find((c) => c.type === wanted && !c.played && c.boughtOnTurn < state.turn);
  if (!card) {
    const heldButFresh = me.devCards.some((c) => c.type === wanted && !c.played);
    return fail(heldButFresh ? 'That card was bought this turn.' : 'You do not have that card.');
  }

  switch (action.type) {
    case 'playKnight': {
      card.played = true;
      me.knightsPlayed += 1;
      state.playedDevThisTurn = true;
      addLog(state, me.id, 'plays a Knight.');
      updateLargestArmy(state, me.id);
      state.phase = 'movingRobber';
      checkWinner(state);
      return;
    }

    case 'playRoadBuilding': {
      if (me.pieces.road <= 0) return fail('You have no road pieces left.');
      card.played = true;
      state.playedDevThisTurn = true;
      state.freeRoads = Math.min(2, me.pieces.road);
      if (state.phase === 'rolling') {
        // Roads are placed in the main phase, so the roll still has to happen
        // first; the free roads simply wait.
        addLog(state, me.id, 'plays Road Building — place the roads after rolling.');
      } else {
        addLog(state, me.id, `plays Road Building and may build ${state.freeRoads} free roads.`);
      }
      return;
    }

    case 'playYearOfPlenty': {
      const picks = action.resources;
      if (!Array.isArray(picks) || picks.length !== 2 || !picks.every((r) => RESOURCES.includes(r))) {
        return fail('Choose exactly two resources.');
      }
      const needed = emptyResources();
      for (const r of picks) needed[r] += 1;
      if (!RESOURCES.every((r) => state.bank[r] >= needed[r])) return fail('The bank cannot supply that.');

      card.played = true;
      state.playedDevThisTurn = true;
      for (const r of picks) gain(state, me, r, 1);
      addLog(state, me.id, `plays Year of Plenty and takes ${describe(needed)}.`);
      return;
    }

    case 'playMonopoly': {
      if (!RESOURCES.includes(action.resource)) return fail('Unknown resource.');
      card.played = true;
      state.playedDevThisTurn = true;
      let taken = 0;
      for (const p of state.players) {
        if (p.id === me.id) continue;
        taken += p.resources[action.resource];
        p.resources[action.resource] = 0;
      }
      me.resources[action.resource] += taken;
      addLog(state, me.id, `plays Monopoly and takes ${taken} ${action.resource}.`);
      return;
    }

    default:
      return fail('Unknown card.');
  }
}

// ---------------------------------------------------------------------------
// What can I do right now? — the client renders exactly this and nothing else.
// ---------------------------------------------------------------------------

export type LegalMoves = {
  isMyTurn: boolean;
  canRoll: boolean;
  canEndTurn: boolean;
  canBuyDevCard: boolean;
  mustDiscard: number;
  settlementSpots: VertexId[];
  citySpots: VertexId[];
  roadSpots: EdgeId[];
  robberSpots: HexId[];
  stealTargets: PlayerId[];
  playableDevCards: DevCardType[];
  bankRates: Record<Resource, number>;
  freeRoads: number;
  canOfferTrade: boolean;
  /** Most of each resource any single opponent holds: the cap on what an offer may ask for. */
  tradeWantMax: ResourceCounts;
  mustAnswerTrade: boolean;
  /** Whether the viewer holds what the offer on the table wants. */
  canAcceptTrade: boolean;
};

export function legalMoves(state: GameState, playerId: PlayerId): LegalMoves {
  const me = playerById(state, playerId);
  const mine = me !== undefined && state.players[state.current]?.id === playerId;
  const moves: LegalMoves = {
    isMyTurn: mine,
    canRoll: false,
    canEndTurn: false,
    canBuyDevCard: false,
    mustDiscard: state.pendingDiscards[playerId] ?? 0,
    settlementSpots: [],
    citySpots: [],
    roadSpots: [],
    robberSpots: [],
    stealTargets: [],
    playableDevCards: [],
    bankRates: { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 },
    freeRoads: state.freeRoads,
    canOfferTrade: false,
    tradeWantMax: emptyResources(),
    mustAnswerTrade:
      state.trade !== null && state.trade.from !== playerId && state.trade.responses[playerId] === 'pending',
    canAcceptTrade: me !== undefined && state.trade !== null && canAfford(me, state.trade.want),
  };
  if (!me || state.phase === 'finished' || state.phase === 'lobby') return moves;

  for (const r of RESOURCES) moves.bankRates[r] = bankRate(state, playerId, r);

  if (state.phase === 'setup' && mine) {
    if (state.setup!.placing === 'settlement') {
      moves.settlementSpots = Object.keys(graphOf(state.board).vertices).filter((v) => respectsDistanceRule(state, v));
    } else {
      const last = state.setup!.lastVertex!;
      moves.roadSpots = graphOf(state.board).vertexEdges[last].filter((e) => !state.board.roads[e]);
    }
    return moves;
  }

  if (!mine) return moves;

  const canPlayCard =
    !state.playedDevThisTurn && (state.phase === 'main' || state.phase === 'rolling');
  if (canPlayCard) {
    const playable = new Set<DevCardType>();
    for (const c of me.devCards) {
      if (c.played || c.type === 'victoryPoint' || c.boughtOnTurn >= state.turn) continue;
      if (c.type === 'roadBuilding' && me.pieces.road <= 0) continue;
      playable.add(c.type);
    }
    moves.playableDevCards = [...playable];
  }

  switch (state.phase) {
    case 'rolling':
      moves.canRoll = true;
      break;

    case 'movingRobber':
      moves.robberSpots = graphOf(state.board).hexes.filter((h) => h !== state.board.robber);
      break;

    case 'stealing':
      moves.stealTargets = state.stealTargets;
      break;

    case 'main': {
      moves.canEndTurn = true;
      moves.canOfferTrade = state.trade === null;
      for (const p of state.players) {
        if (p.id === playerId) continue;
        for (const r of RESOURCES) moves.tradeWantMax[r] = Math.max(moves.tradeWantMax[r], p.resources[r]);
      }
      moves.canBuyDevCard = state.devDeck.length > 0 && canAfford(me, BUILD_COSTS.devCard);

      const affordRoad = state.freeRoads > 0 || canAfford(me, BUILD_COSTS.road);
      if (affordRoad && me.pieces.road > 0) {
        moves.roadSpots = Object.keys(graphOf(state.board).edges).filter((e) => canPlaceRoad(state, playerId, e));
      }
      if (canAfford(me, BUILD_COSTS.settlement) && me.pieces.settlement > 0) {
        moves.settlementSpots = Object.keys(graphOf(state.board).vertices).filter((v) => canPlaceSettlement(state, playerId, v));
      }
      if (canAfford(me, BUILD_COSTS.city) && me.pieces.city > 0) {
        moves.citySpots = Object.keys(state.board.buildings).filter(
          (v) => state.board.buildings[v].owner === playerId && state.board.buildings[v].type === 'settlement',
        );
      }
      break;
    }

    default:
      break;
  }

  return moves;
}
