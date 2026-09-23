import { describe, it, expect } from 'vitest';
import { BOARD, hexId, type VertexId } from '../layout';
import {
  applyAction,
  bankRate,
  createGame,
  legalMoves,
  longestRoadLength,
  playerById,
  publicVictoryPoints,
  totalVictoryPoints,
} from '../rules';
import type { Action, GameState, PlayerId, Resource, ResourceCounts } from '../types';
import { RESOURCES, emptyResources } from '../types';

const SEATS = [
  { id: 'A', name: 'Ann' },
  { id: 'B', name: 'Bob' },
  { id: 'C', name: 'Cid' },
];

/** Apply an action and fail the test loudly if the engine rejected it. */
function must(state: GameState, who: PlayerId, action: Action): GameState {
  const r = applyAction(state, who, action);
  if (!r.ok) throw new Error(`${who} ${action.type} rejected: ${r.error}`);
  return r.state;
}

function expectRejected(state: GameState, who: PlayerId, action: Action): string {
  const r = applyAction(state, who, action);
  expect(r.ok).toBe(false);
  return r.ok ? '' : r.error;
}

function give(state: GameState, who: PlayerId, counts: Partial<ResourceCounts>): GameState {
  const next = structuredClone(state);
  const p = playerById(next, who)!;
  for (const r of RESOURCES) p.resources[r] += counts[r] ?? 0;
  return next;
}

/** Setup hands players their second-settlement resources; clear them so that
 *  tests asserting absolute counts are not measuring the draft. */
function clearHands(state: GameState): GameState {
  const next = structuredClone(state);
  for (const p of next.players) p.resources = emptyResources();
  return next;
}

function handSize(state: GameState, who: PlayerId): number {
  const p = playerById(state, who)!;
  return RESOURCES.reduce((n, r) => n + p.resources[r], 0);
}

/** Drive the snake draft to completion by always taking the first legal option. */
function runSetup(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'setup' && guard++ < 50) {
    const who = s.players[s.current].id;
    const moves = legalMoves(s, who);
    s =
      s.setup!.placing === 'settlement'
        ? must(s, who, { type: 'placeSetupSettlement', vertex: moves.settlementSpots[0] })
        : must(s, who, { type: 'placeSetupRoad', edge: moves.roadSpots[0] });
  }
  return s;
}

/** Put a state into the main phase for the current player, skipping the roll. */
function intoMain(state: GameState): GameState {
  const s = structuredClone(state);
  s.phase = 'main';
  s.mustRoll = false;
  s.dice = [3, 4];
  return s;
}

describe('setup draft', () => {
  it('runs a snake order and ends with two settlements and two roads each', () => {
    const s = runSetup(createGame(SEATS, 7));
    expect(s.phase).toBe('rolling');
    expect(s.current).toBe(0);

    for (const p of s.players) {
      const buildings = Object.values(s.board.buildings).filter((b) => b.owner === p.id);
      const roads = Object.values(s.board.roads).filter((r) => r.owner === p.id);
      expect(buildings).toHaveLength(2);
      expect(roads).toHaveLength(2);
      expect(p.pieces.settlement).toBe(3);
      expect(p.pieces.road).toBe(13);
    }
  });

  it('pays out only for the second settlement', () => {
    let s = createGame(SEATS, 7);
    // First round: three settlements + roads, nobody collects anything.
    for (let i = 0; i < 3; i++) {
      const who = s.players[s.current].id;
      s = must(s, who, { type: 'placeSetupSettlement', vertex: legalMoves(s, who).settlementSpots[0] });
      s = must(s, who, { type: 'placeSetupRoad', edge: legalMoves(s, who).roadSpots[0] });
    }
    expect(s.setup!.round).toBe(2);
    for (const p of s.players) expect(handSize(s, p.id)).toBe(0);

    const who = s.players[s.current].id;
    const vertex = legalMoves(s, who).settlementSpots[0];
    s = must(s, who, { type: 'placeSetupSettlement', vertex });
    const producing = BOARD.vertexHexes[vertex].filter((h) => s.board.hexes[h].terrain !== 'desert');
    expect(handSize(s, who)).toBe(producing.length);
  });

  it('refuses a settlement touching another and a road that floats free', () => {
    let s = createGame(SEATS, 7);
    const vertex = legalMoves(s, 'A').settlementSpots[0];
    s = must(s, 'A', { type: 'placeSetupSettlement', vertex });

    const road = legalMoves(s, 'A').roadSpots[0];
    s = must(s, 'A', { type: 'placeSetupRoad', edge: road });

    // Bob now tries the neighbour of Ann's settlement.
    const tooClose = BOARD.vertexNeighbours[vertex][0];
    expect(expectRejected(s, 'B', { type: 'placeSetupSettlement', vertex: tooClose })).toMatch(/too close/i);

    // And a road nowhere near his own settlement.
    const bobSpot = legalMoves(s, 'B').settlementSpots.find((v) => !BOARD.vertexNeighbours[vertex].includes(v))!;
    s = must(s, 'B', { type: 'placeSetupSettlement', vertex: bobSpot });
    const detached = Object.keys(BOARD.edges).find(
      (e) => !BOARD.edges[e].vertices.includes(bobSpot) && !s.board.roads[e],
    )!;
    expect(expectRejected(s, 'B', { type: 'placeSetupRoad', edge: detached })).toMatch(/must touch/i);
  });

  it('will not let a player act out of turn', () => {
    const s = createGame(SEATS, 7);
    expect(expectRejected(s, 'B', { type: 'placeSetupSettlement', vertex: BOARD.hexVertices['0,0'][0] })).toMatch(
      /not your turn/i,
    );
  });
});

describe('rolling and production', () => {
  it('pays 1 for a settlement and 2 for a city, and skips the robbed hex', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    const hex = BOARD.hexes.find((h) => s.board.hexes[h].token !== null && h !== s.board.robber)!;
    const roll = s.board.hexes[hex].token!;
    const resource = (
      { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore' } as const
    )[s.board.hexes[hex].terrain as 'hills' | 'forest' | 'pasture' | 'fields' | 'mountains'];

    // Hand-place a settlement and a city on that hex, and clear other buildings
    // so the payout is unambiguous.
    s.board.buildings = {};
    const [v1, , v3] = BOARD.hexVertices[hex];
    s.board.buildings[v1] = { owner: 'A', type: 'settlement' };
    s.board.buildings[v3] = { owner: 'B', type: 'city' };

    const before = { a: playerById(s, 'A')!.resources[resource], b: playerById(s, 'B')!.resources[resource] };
    s.phase = 'rolling';
    s.mustRoll = true;
    // Force the roll rather than looping dice: production is the unit under test.
    const produced = must({ ...s, rng: { seed: 1 } }, 'A', { type: 'rollDice' });
    void produced;

    // Directly exercise production through a scripted roll instead.
    let t = structuredClone(s);
    t.phase = 'main';
    t.mustRoll = false;
    const withPayout = payout(t, roll);
    expect(playerById(withPayout, 'A')!.resources[resource]).toBe(before.a + 1);
    expect(playerById(withPayout, 'B')!.resources[resource]).toBe(before.b + 2);

    // With the robber sitting on it, nobody collects.
    t.board.robber = hex;
    const robbed = payout(t, roll);
    expect(playerById(robbed, 'A')!.resources[resource]).toBe(before.a);
  });

  it('forces discards from players over seven cards on a 7', () => {
    let s = clearHands(intoMain(runSetup(createGame(SEATS, 7))));
    s = give(s, 'A', { brick: 5, lumber: 5 }); // 10 cards -> discards 5
    s = give(s, 'B', { ore: 3 }); // under the limit
    s.phase = 'rolling';
    s.mustRoll = true;
    s.rng = { seed: seedRolling7() };

    const rolled = must(s, 'A', { type: 'rollDice' });
    expect(rolled.dice![0] + rolled.dice![1]).toBe(7);
    expect(rolled.phase).toBe('discarding');
    expect(rolled.pendingDiscards['A']).toBe(5);
    expect(rolled.pendingDiscards['B']).toBeUndefined();

    expect(expectRejected(rolled, 'A', { type: 'moveRobber', hex: BOARD.hexes[0] })).toMatch(/not waiting/i);
    expect(
      expectRejected(rolled, 'A', { type: 'discard', resources: { ...emptyResources(), brick: 4 } }),
    ).toMatch(/exactly 5/i);

    const discarded = must(rolled, 'A', {
      type: 'discard',
      resources: { ...emptyResources(), brick: 3, lumber: 2 },
    });
    expect(discarded.phase).toBe('movingRobber');
    expect(handSize(discarded, 'A')).toBe(5);
  });
});

describe('building', () => {
  it('charges for a road, a settlement and a city and returns the settlement piece', () => {
    let s = clearHands(intoMain(runSetup(createGame(SEATS, 7))));
    const me = 'A';
    s = give(s, me, { brick: 2, lumber: 2, wool: 1, grain: 3, ore: 3 });

    const roadSpot = legalMoves(s, me).roadSpots[0];
    s = must(s, me, { type: 'buildRoad', edge: roadSpot });
    expect(s.board.roads[roadSpot].owner).toBe(me);

    // The first road may still be boxed in by the distance rule; keep extending
    // until a legal settlement spot opens up.
    let guard = 0;
    while (legalMoves(s, me).settlementSpots.length === 0 && guard++ < 6) {
      s = give(s, me, { brick: 1, lumber: 1 });
      s = must(s, me, { type: 'buildRoad', edge: legalMoves(s, me).roadSpots[0] });
    }
    const settlementSpot = legalMoves(s, me).settlementSpots[0];
    expect(settlementSpot).toBeDefined();
    s = must(s, me, { type: 'buildSettlement', vertex: settlementSpot });
    expect(publicVictoryPoints(s, me)).toBeGreaterThanOrEqual(3);

    expect(playerById(s, me)!.pieces.settlement).toBe(2);
    s = must(s, me, { type: 'buildCity', vertex: settlementSpot });
    expect(s.board.buildings[settlementSpot].type).toBe('city');
    expect(playerById(s, me)!.pieces.city).toBe(3);
    expect(playerById(s, me)!.pieces.settlement).toBe(3); // piece came back
  });

  it('refuses builds that are unaffordable, unconnected or on top of something', () => {
    const s = intoMain(runSetup(createGame(SEATS, 7)));
    const spot = legalMoves(give(s, 'A', { brick: 1, lumber: 1 }), 'A').roadSpots[0];
    expect(expectRejected(s, 'A', { type: 'buildRoad', edge: spot })).toMatch(/afford/i);

    const rich = give(s, 'A', { brick: 4, lumber: 4, wool: 4, grain: 4, ore: 4 });
    const faraway = Object.keys(BOARD.edges).find((e) => !legalMoves(rich, 'A').roadSpots.includes(e))!;
    expect(expectRejected(rich, 'A', { type: 'buildRoad', edge: faraway })).toMatch(/cannot go there/i);

    const occupied = Object.keys(rich.board.buildings)[0];
    expect(expectRejected(rich, 'A', { type: 'buildSettlement', vertex: occupied })).toMatch(/cannot go there/i);
  });

  it('stops at the piece limits', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s = give(s, 'A', { brick: 20, lumber: 20 });
    playerById(s, 'A')!.pieces.road = 0;
    const spot = Object.keys(BOARD.edges).find((e) => !s.board.roads[e])!;
    expect(expectRejected(s, 'A', { type: 'buildRoad', edge: spot })).toMatch(/no road pieces/i);
  });
});

describe('longest road', () => {
  /** Lay a chain of `n` roads for `owner` starting at `from`, and return the path. */
  function chain(state: GameState, owner: PlayerId, from: VertexId, n: number): VertexId[] {
    const path = [from];
    let cursor = from;
    for (let i = 0; i < n; i++) {
      const edge = BOARD.vertexEdges[cursor].find((e) => {
        if (state.board.roads[e]) return false;
        const other = BOARD.edges[e].vertices.find((v) => v !== cursor)!;
        return !path.includes(other);
      });
      if (!edge) break;
      state.board.roads[edge] = { owner };
      cursor = BOARD.edges[edge].vertices.find((v) => v !== cursor)!;
      path.push(cursor);
    }
    return path;
  }

  it('measures a straight chain and awards the card at five', () => {
    const s = intoMain(createGame(SEATS, 11));
    s.board.buildings = {};
    s.board.roads = {};
    const path = chain(s, 'A', BOARD.hexVertices[hexId({ q: 0, r: 0 })][0], 5);
    expect(path.length).toBe(6);
    expect(longestRoadLength(s, 'A')).toBe(5);

    // Route it through the reducer so the award logic runs.
    const built = must(give(s, 'A', { brick: 1, lumber: 1 }), 'A', {
      type: 'buildRoad',
      edge: BOARD.vertexEdges[path[5]].find((e) => !s.board.roads[e])!,
    });
    expect(built.longestRoad.owner).toBe('A');
    expect(built.longestRoad.length).toBe(6);
    expect(publicVictoryPoints(built, 'A')).toBe(2);
  });

  it('does not count roads that only meet at an opponent settlement', () => {
    const s = intoMain(createGame(SEATS, 11));
    s.board.buildings = {};
    s.board.roads = {};
    const path = chain(s, 'A', BOARD.hexVertices[hexId({ q: 0, r: 0 })][0], 6);
    expect(longestRoadLength(s, 'A')).toBe(6);

    // Bob drops a settlement in the middle of Ann's road.
    s.board.buildings[path[3]] = { owner: 'B', type: 'settlement' };
    expect(longestRoadLength(s, 'A')).toBe(3);
  });

  it('hands the card over when someone builds longer, and drops it on a tie', () => {
    let s = intoMain(createGame(SEATS, 11));
    s.board.buildings = {};
    s.board.roads = {};
    chain(s, 'A', BOARD.hexVertices[hexId({ q: 0, r: 0 })][0], 5);
    s = must(give(s, 'A', { brick: 1, lumber: 1 }), 'A', {
      type: 'buildRoad',
      edge: BOARD.vertexEdges[BOARD.hexVertices[hexId({ q: 0, r: 0 })][0]].find((e) => !s.board.roads[e])!,
    });
    expect(s.longestRoad.owner).toBe('A');

    // Bob builds a longer chain far away.
    chain(s, 'B', BOARD.hexVertices[hexId({ q: 2, r: -2 })][2], 7);
    const bobsTurn = intoMain({ ...structuredClone(s), current: 1 });
    const after = must(give(bobsTurn, 'B', { brick: 1, lumber: 1 }), 'B', {
      type: 'buildRoad',
      edge: legalMoves(give(bobsTurn, 'B', { brick: 1, lumber: 1 }), 'B').roadSpots[0],
    });
    expect(after.longestRoad.owner).toBe('B');
    expect(publicVictoryPoints(after, 'A')).toBe(0);
  });
});

describe('development cards', () => {
  function grant(state: GameState, who: PlayerId, type: Action extends never ? never : string): GameState {
    const s = structuredClone(state);
    playerById(s, who)!.devCards.push({ type: type as never, boughtOnTurn: 0, played: false });
    return s;
  }

  it('cannot be played on the turn it was bought', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s = give(s, 'A', { wool: 1, grain: 1, ore: 1 });
    s = must(s, 'A', { type: 'buyDevCard' });
    const bought = playerById(s, 'A')!.devCards[0];
    expect(bought.boughtOnTurn).toBe(s.turn);

    const action: Action =
      bought.type === 'knight'
        ? { type: 'playKnight' }
        : bought.type === 'monopoly'
          ? { type: 'playMonopoly', resource: 'brick' }
          : bought.type === 'yearOfPlenty'
            ? { type: 'playYearOfPlenty', resources: ['brick', 'ore'] }
            : { type: 'playRoadBuilding' };
    if (bought.type !== 'victoryPoint') {
      expect(expectRejected(s, 'A', action)).toMatch(/bought this turn/i);
    }
  });

  it('gives Largest Army at the third knight and moves the robber', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s.turn = 5;
    s = grant(grant(grant(s, 'A', 'knight'), 'A', 'knight'), 'A', 'knight');

    for (let i = 0; i < 3; i++) {
      s = must(s, 'A', { type: 'playKnight' });
      expect(s.phase).toBe('movingRobber');
      const target = BOARD.hexes.find((h) => h !== s.board.robber)!;
      s = must(s, 'A', { type: 'moveRobber', hex: target });
      if (s.phase === 'stealing') s = must(s, 'A', { type: 'steal', target: s.stealTargets[0] });
      expect(s.phase).toBe('main');
      if (i < 2) {
        expect(s.largestArmy.owner).toBeNull();
        s = must(s, 'A', { type: 'endTurn' });
        s = { ...s, current: 0, phase: 'main', mustRoll: false };
      }
    }
    expect(s.largestArmy.owner).toBe('A');
    expect(s.largestArmy.size).toBe(3);
    expect(publicVictoryPoints(s, 'A')).toBe(4); // two settlements + army
  });

  it('allows one card per turn only', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s.turn = 5;
    s = grant(grant(s, 'A', 'monopoly'), 'A', 'yearOfPlenty');
    s = must(s, 'A', { type: 'playMonopoly', resource: 'brick' });
    expect(expectRejected(s, 'A', { type: 'playYearOfPlenty', resources: ['ore', 'ore'] })).toMatch(/already played/i);
  });

  it('monopoly sweeps one resource from everyone else', () => {
    let s = clearHands(intoMain(runSetup(createGame(SEATS, 7))));
    s.turn = 5;
    s = grant(s, 'A', 'monopoly');
    const before = playerById(s, 'A')!.resources.wool;
    s = give(give(s, 'B', { wool: 3 }), 'C', { wool: 2 });
    s = must(s, 'A', { type: 'playMonopoly', resource: 'wool' });
    expect(playerById(s, 'A')!.resources.wool).toBe(before + 5);
    expect(playerById(s, 'B')!.resources.wool).toBe(0);
    expect(playerById(s, 'C')!.resources.wool).toBe(0);
  });

  it('year of plenty draws two cards from the bank', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s.turn = 5;
    s = grant(s, 'A', 'yearOfPlenty');
    const bankBefore = s.bank.ore;
    s = must(s, 'A', { type: 'playYearOfPlenty', resources: ['ore', 'ore'] });
    expect(s.bank.ore).toBe(bankBefore - 2);
    expect(expectRejected(s, 'A', { type: 'playYearOfPlenty', resources: ['ore', 'ore'] })).toBeTruthy();
  });

  it('road building grants two free roads that cost nothing', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s.turn = 5;
    s = grant(s, 'A', 'roadBuilding');
    const handBefore = handSize(s, 'A');
    s = must(s, 'A', { type: 'playRoadBuilding' });
    expect(s.freeRoads).toBe(2);

    s = must(s, 'A', { type: 'buildRoad', edge: legalMoves(s, 'A').roadSpots[0] });
    s = must(s, 'A', { type: 'buildRoad', edge: legalMoves(s, 'A').roadSpots[0] });
    expect(s.freeRoads).toBe(0);
    expect(handSize(s, 'A')).toBe(handBefore);
    expect(playerById(s, 'A')!.pieces.road).toBe(11);
  });

  it('still makes you roll when a knight is played before the roll', () => {
    let s = runSetup(createGame(SEATS, 7));
    s.turn = 5;
    s = grant(s, 'A', 'knight');
    expect(s.phase).toBe('rolling');

    s = must(s, 'A', { type: 'playKnight' });
    expect(s.phase).toBe('movingRobber');
    s = must(s, 'A', { type: 'moveRobber', hex: BOARD.hexes.find((h) => h !== s.board.robber)! });
    if (s.phase === 'stealing') s = must(s, 'A', { type: 'steal', target: s.stealTargets[0] });

    expect(s.phase).toBe('rolling');
    expect(expectRejected(s, 'A', { type: 'endTurn' })).toMatch(/cannot end/i);
  });
});

describe('trading', () => {
  it('uses 4:1 by default and 2:1 with the matching harbour', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s.board.buildings = {};
    s.board.roads = {};
    expect(bankRate(s, 'A', 'ore')).toBe(4);

    const orePort = s.board.ports.find((p) => p.type === 'ore')!;
    s.board.buildings[orePort.vertices[0]] = { owner: 'A', type: 'settlement' };
    expect(bankRate(s, 'A', 'ore')).toBe(2);
    expect(bankRate(s, 'A', 'wool')).toBe(4);

    const anyPort = s.board.ports.find((p) => p.type === 'any')!;
    s.board.buildings[anyPort.vertices[0]] = { owner: 'A', type: 'settlement' };
    expect(bankRate(s, 'A', 'wool')).toBe(3);

    s = give(s, 'A', { ore: 2 });
    const traded = must(s, 'A', { type: 'bankTrade', give: 'ore', want: 'grain' });
    expect(playerById(traded, 'A')!.resources.ore).toBe(0);
    expect(playerById(traded, 'A')!.resources.grain).toBe(1);
  });

  it('runs an offer through accept and settlement', () => {
    let s = clearHands(intoMain(runSetup(createGame(SEATS, 7))));
    s = give(s, 'A', { brick: 2 });
    s = give(s, 'B', { ore: 1 });
    const aBrick = playerById(s, 'A')!.resources.brick;
    const bOre = playerById(s, 'B')!.resources.ore;

    s = must(s, 'A', {
      type: 'offerTrade',
      give: { ...emptyResources(), brick: 2 },
      want: { ...emptyResources(), ore: 1 },
    });
    expect(legalMoves(s, 'B').mustAnswerTrade).toBe(true);

    expect(expectRejected(s, 'A', { type: 'acceptTradeWith', player: 'B' })).toMatch(/not accepted/i);
    s = must(s, 'C', { type: 'respondTrade', accept: false });
    s = must(s, 'B', { type: 'respondTrade', accept: true });
    expect(expectRejected(s, 'A', { type: 'acceptTradeWith', player: 'C' })).toMatch(/not accepted/i);

    s = must(s, 'A', { type: 'acceptTradeWith', player: 'B' });
    expect(s.trade).toBeNull();
    expect(playerById(s, 'A')!.resources.brick).toBe(aBrick - 2);
    expect(playerById(s, 'A')!.resources.ore).toBe(1);
    expect(playerById(s, 'B')!.resources.ore).toBe(bOre - 1);
    expect(playerById(s, 'B')!.resources.brick).toBe(2);
  });

  it('refuses an offer of cards you do not hold', () => {
    const s = intoMain(runSetup(createGame(SEATS, 7)));
    expect(
      expectRejected(s, 'A', {
        type: 'offerTrade',
        give: { ...emptyResources(), ore: 9 },
        want: { ...emptyResources(), brick: 1 },
      }),
    ).toMatch(/do not hold/i);
  });

  it('refuses an offer nobody can pay, and an accept you cannot pay', () => {
    let s = clearHands(intoMain(runSetup(createGame(SEATS, 7))));
    s = give(s, 'A', { brick: 1 });
    s = give(s, 'B', { ore: 1 });
    s = give(s, 'C', { ore: 1 });
    const offer = (ore: number): Action => ({
      type: 'offerTrade',
      give: { ...emptyResources(), brick: 1 },
      want: { ...emptyResources(), ore },
    });
    // Two ore exist between them, but no single player holds both.
    expect(legalMoves(s, 'A').tradeWantMax.ore).toBe(1);
    expect(expectRejected(s, 'A', offer(2))).toMatch(/nobody holds/i);

    s = must(s, 'A', offer(1));
    s = give(s, 'C', { ore: -1 });
    expect(legalMoves(s, 'C').canAcceptTrade).toBe(false);
    expect(expectRejected(s, 'C', { type: 'respondTrade', accept: true })).toMatch(/do not hold/i);
    must(s, 'C', { type: 'respondTrade', accept: false });
    expect(legalMoves(s, 'B').canAcceptTrade).toBe(true);
  });
});

describe('winning', () => {
  it('ends the game at ten points and counts hidden cards', () => {
    let s = intoMain(runSetup(createGame(SEATS, 7)));
    s.board.buildings = {};
    // Four cities (8) + two hidden victory point cards = 10.
    const spots = BOARD.hexVertices[hexId({ q: 0, r: 0 })];
    for (let i = 0; i < 3; i++) s.board.buildings[spots[i * 2]] = { owner: 'A', type: 'city' };
    const p = playerById(s, 'A')!;
    p.devCards.push({ type: 'victoryPoint', boughtOnTurn: 0, played: false });
    p.devCards.push({ type: 'victoryPoint', boughtOnTurn: 0, played: false });
    p.pieces.city = 1;

    expect(publicVictoryPoints(s, 'A')).toBe(6);
    expect(totalVictoryPoints(s, 'A')).toBe(8);
    expect(s.winner).toBeNull();

    // A fourth city takes them to 10.
    const free = Object.keys(BOARD.vertices).find(
      (v) => !s.board.buildings[v] && BOARD.vertexNeighbours[v].every((n) => !s.board.buildings[n]),
    )!;
    s.board.buildings[free] = { owner: 'A', type: 'settlement' };
    s = give(s, 'A', { grain: 2, ore: 3 });
    s = must(s, 'A', { type: 'buildCity', vertex: free });

    expect(s.winner).toBe('A');
    expect(s.phase).toBe('finished');
    expect(expectRejected(s, 'A', { type: 'endTurn' })).toMatch(/game is over/i);
  });
});

describe('a full scripted game', () => {
  /**
   * A greedy bot playing every seat. It is not trying to play well — it is there
   * to prove the engine always offers *some* legal move and eventually produces a
   * winner, which is what catches soft-locks and unreachable phases.
   */
  function playOut(seed: number): GameState {
    let rs = seed >>> 0;
    const rnd = () => (rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296;
    const any = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

    let s = createGame(SEATS, seed);
    let guard = 0;

    // Spread the opening settlements out; clustering them starves the board of
    // three of the five resources and the game never goes anywhere.
    while (s.phase === 'setup' && guard++ < 50) {
      const who = s.players[s.current].id;
      const moves = legalMoves(s, who);
      s =
        s.setup!.placing === 'settlement'
          ? must(s, who, { type: 'placeSetupSettlement', vertex: any(moves.settlementSpots) })
          : must(s, who, { type: 'placeSetupRoad', edge: any(moves.roadSpots) });
    }

    guard = 0;
    while (!s.winner && guard++ < 8000) {
      // Anyone who owes cards pays first. A broken implementation soft-locks
      // here, so it is checked on every single iteration.
      if (s.phase === 'discarding') {
        const debtor = Object.keys(s.pendingDiscards)[0];
        s = must(s, debtor, { type: 'discard', resources: cheapestDiscard(s, debtor) });
        continue;
      }

      const who = s.players[s.current].id;
      const moves = legalMoves(s, who);

      if (moves.canRoll) {
        s = must(s, who, { type: 'rollDice' });
      } else if (s.phase === 'movingRobber') {
        s = must(s, who, { type: 'moveRobber', hex: any(moves.robberSpots) });
      } else if (s.phase === 'stealing') {
        s = must(s, who, { type: 'steal', target: moves.stealTargets[0] });
      } else if (moves.citySpots.length) {
        s = must(s, who, { type: 'buildCity', vertex: moves.citySpots[0] });
      } else if (moves.settlementSpots.length) {
        s = must(s, who, { type: 'buildSettlement', vertex: any(moves.settlementSpots) });
      } else if (moves.canBuyDevCard) {
        s = must(s, who, { type: 'buyDevCard' });
      } else if (moves.roadSpots.length && playerById(s, who)!.pieces.road > 0) {
        s = must(s, who, { type: 'buildRoad', edge: any(moves.roadSpots) });
      } else if (moves.playableDevCards.includes('knight')) {
        s = must(s, who, { type: 'playKnight' });
      } else {
        const swap = bankSwap(s, who, moves.bankRates);
        if (swap) s = must(s, who, swap);
        else if (moves.canEndTurn) s = must(s, who, { type: 'endTurn' });
        else throw new Error(`no legal move available in phase ${s.phase} as ${who}`);
      }
    }
    return s;
  }

  it.each([2024, 77, 12345])('reaches a winner without stalling (seed %i)', (seed) => {
    const s = playOut(seed);

    expect(s.winner).not.toBeNull();
    expect(s.phase).toBe('finished');
    expect(totalVictoryPoints(s, s.winner!)).toBeGreaterThanOrEqual(10);

    // Invariants that must survive a whole game.
    for (const p of s.players) {
      for (const r of RESOURCES) expect(p.resources[r]).toBeGreaterThanOrEqual(0);
      expect(p.pieces.road).toBeGreaterThanOrEqual(0);
      expect(p.pieces.settlement).toBeGreaterThanOrEqual(0);
      expect(p.pieces.city).toBeGreaterThanOrEqual(0);
    }
    // Nothing is created or destroyed: every card is either in the bank or a hand.
    for (const r of RESOURCES) {
      const inHands = s.players.reduce((n, p) => n + p.resources[r], 0);
      expect(s.bank[r] + inHands).toBe(19);
    }
    expect(s.devDeck.length + s.players.reduce((n, p) => n + p.devCards.length, 0)).toBe(25);
  });
});

// --- test-only helpers -----------------------------------------------------

/** Re-run production for a given roll without going through the dice. */
function payout(state: GameState, roll: number): GameState {
  const s = structuredClone(state);
  s.phase = 'rolling';
  s.mustRoll = true;
  // Search for a seed whose two dice sum to `roll`, then roll for real.
  for (let seed = 1; seed < 5000; seed++) {
    const attempt = applyAction({ ...structuredClone(s), rng: { seed } }, s.players[s.current].id, {
      type: 'rollDice',
    });
    if (attempt.ok && attempt.state.dice![0] + attempt.state.dice![1] === roll) return attempt.state;
  }
  throw new Error(`no seed produced a roll of ${roll}`);
}

/** A seed whose first roll is a 7. */
function seedRolling7(): number {
  const probe = createGame(SEATS, 1);
  for (let seed = 1; seed < 5000; seed++) {
    const s = { ...structuredClone(probe), phase: 'rolling' as const, setup: null, rng: { seed } };
    const r = applyAction(s, 'A', { type: 'rollDice' });
    if (r.ok && r.state.dice![0] + r.state.dice![1] === 7) return seed;
  }
  throw new Error('no seed rolled a 7');
}

function cheapestDiscard(state: GameState, who: PlayerId): ResourceCounts {
  const p = playerById(state, who)!;
  const owed = state.pendingDiscards[who];
  const out = emptyResources();
  let left = owed;
  for (const r of RESOURCES as readonly Resource[]) {
    const take = Math.min(left, p.resources[r]);
    out[r] = take;
    left -= take;
    if (left === 0) break;
  }
  return out;
}

/** Dump a surplus into something the player has none of, to keep a game moving. */
function bankSwap(state: GameState, who: PlayerId, rates: Record<Resource, number>): Action | null {
  const p = playerById(state, who)!;
  const give = RESOURCES.find((r) => p.resources[r] > rates[r]);
  if (!give) return null;
  const want = RESOURCES.find((r) => r !== give && p.resources[r] === 0 && state.bank[r] > 0);
  return want ? { type: 'bankTrade', give, want } : null;
}
