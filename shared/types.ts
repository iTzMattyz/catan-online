import type { EdgeId, HexId, VertexId } from './layout';
import type { Rng } from './rng';
import type { MapId } from './scenario';

export type Resource = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export const RESOURCES: readonly Resource[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** `sea` and `gold` are unused by the base game but kept so Seafarers can drop in. */
export type Terrain = 'hills' | 'forest' | 'pasture' | 'fields' | 'mountains' | 'desert' | 'sea' | 'gold';

export const TERRAIN_YIELD: Record<Terrain, Resource | null> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
  sea: null,
  gold: null,
};

export type PortType = Resource | 'any';

export type DevCardType = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint';

export type PlayerId = string;

export type ResourceCounts = Record<Resource, number>;

export function emptyResources(): ResourceCounts {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

export function countResources(r: ResourceCounts): number {
  return RESOURCES.reduce((n, k) => n + r[k], 0);
}

export const BUILD_COSTS = {
  road: { brick: 1, lumber: 1, wool: 0, grain: 0, ore: 0 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1, ore: 0 },
  city: { brick: 0, lumber: 0, wool: 0, grain: 2, ore: 3 },
  devCard: { brick: 0, lumber: 0, wool: 1, grain: 1, ore: 1 },
} as const satisfies Record<string, ResourceCounts>;

export const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 } as const;
export const VICTORY_POINTS_TO_WIN = 10;
export const LONGEST_ROAD_MINIMUM = 5;
export const LARGEST_ARMY_MINIMUM = 3;
export const HAND_LIMIT_BEFORE_DISCARD = 7;

export type Building = { owner: PlayerId; type: 'settlement' | 'city' };
export type Road = { owner: PlayerId };
export type Port = { type: PortType; edge: EdgeId; vertices: [VertexId, VertexId] };
export type HexState = { terrain: Terrain; token: number | null };

export type BoardState = {
  /** Which map's graph the ids below belong to. */
  map: MapId;
  hexes: Record<HexId, HexState>;
  ports: Port[];
  buildings: Record<VertexId, Building>;
  roads: Record<EdgeId, Road>;
  robber: HexId;
};

export type DevCard = {
  type: DevCardType;
  /** Cards cannot be played on the turn they are bought. */
  boughtOnTurn: number;
  played: boolean;
};

export type Player = {
  id: PlayerId;
  name: string;
  color: string;
  seat: number;
  connected: boolean;
  resources: ResourceCounts;
  devCards: DevCard[];
  knightsPlayed: number;
  /** Pieces still in the supply. */
  pieces: { road: number; settlement: number; city: number };
};

/**
 * Where the turn currently is. Phases that are not `main` deliberately block
 * everything else, which is what stops the game soft-locking on a half-resolved 7.
 */
export type Phase =
  | 'lobby'
  | 'setup'
  | 'rolling'
  | 'discarding'
  | 'movingRobber'
  | 'stealing'
  | 'main'
  | 'finished';

export type TradeOffer = {
  from: PlayerId;
  give: ResourceCounts;
  want: ResourceCounts;
  responses: Record<PlayerId, 'pending' | 'accept' | 'reject'>;
};

export type LogEntry = {
  id: number;
  turn: number;
  player: PlayerId | null;
  text: string;
};

export type GameState = {
  phase: Phase;
  players: Player[];
  board: BoardState;
  bank: ResourceCounts;
  devDeck: DevCardType[];
  rng: Rng;
  turn: number;
  /** Index into `players`. */
  current: number;
  dice: [number, number] | null;
  /** True until this turn's roll happens — a Knight played first must not skip it. */
  mustRoll: boolean;
  /** Setup draft: round 1 forward, round 2 in reverse. */
  setup: { round: 1 | 2; placing: 'settlement' | 'road'; lastVertex: VertexId | null } | null;
  /** Cards owed by each player after a 7. Empty object means nobody owes. */
  pendingDiscards: Record<PlayerId, number>;
  /** Who the current player may steal from, once the robber has moved. */
  stealTargets: PlayerId[];
  /** Free roads remaining from Road Building. */
  freeRoads: number;
  /** One development card per turn. */
  playedDevThisTurn: boolean;
  trade: TradeOffer | null;
  longestRoad: { owner: PlayerId | null; length: number };
  largestArmy: { owner: PlayerId | null; size: number };
  winner: PlayerId | null;
  log: LogEntry[];
  nextLogId: number;
};

export type Action =
  | { type: 'placeSetupSettlement'; vertex: VertexId }
  | { type: 'placeSetupRoad'; edge: EdgeId }
  | { type: 'rollDice' }
  | { type: 'discard'; resources: ResourceCounts }
  | { type: 'moveRobber'; hex: HexId }
  | { type: 'steal'; target: PlayerId | null }
  | { type: 'buildRoad'; edge: EdgeId }
  | { type: 'buildSettlement'; vertex: VertexId }
  | { type: 'buildCity'; vertex: VertexId }
  | { type: 'buyDevCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; resources: [Resource, Resource] }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'bankTrade'; give: Resource; want: Resource }
  | { type: 'offerTrade'; give: ResourceCounts; want: ResourceCounts }
  | { type: 'respondTrade'; accept: boolean }
  | { type: 'acceptTradeWith'; player: PlayerId }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' };

export type ActionType = Action['type'];
