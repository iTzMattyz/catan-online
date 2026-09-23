import { HEX_COORDS, buildBoardGraph, type Axial, type BoardGraph } from './layout';
import type { PortType, Terrain } from './types';

export type MapId = 'classic' | 'beginner' | 'large';

/**
 * A board recipe: the island's shape plus the tiles, tokens and harbours dealt
 * onto it. Seafarers or a custom map would be another one of these.
 */
export type Scenario = {
  id: MapId;
  name: string;
  blurb: string;
  /** Land hex positions. Row order matters for `fixed` maps. */
  coords: readonly Axial[];
  /** Terrain supply, one entry per land hex. */
  terrains: Terrain[];
  /** Number tokens, one per non-desert hex. */
  tokens: number[];
  /** Harbour supply, spaced evenly around the coastline. */
  ports: PortType[];
  /** Deal terrains, tokens and harbours in the order listed instead of shuffling. */
  fixed?: boolean;
};

function repeat<T>(value: T, n: number): T[] {
  return Array.from({ length: n }, () => value);
}

/** Rows of `lengths` hexes, centred: 3-4-5-4-3 is the base island. */
function rows(lengths: number[]): Axial[] {
  const out: Axial[] = [];
  const mid = Math.floor(lengths.length / 2);
  const widest = Math.max(...lengths);
  lengths.forEach((len, i) => {
    const r = i - mid;
    // x of hex (q, r) is q + r/2 in hex widths; start each row so it is centred.
    const first = Math.ceil(-r / 2 - widest / 2 + (widest - len) / 2);
    for (let q = first; q < first + len; q++) out.push({ q, r });
  });
  return out;
}

const BASE_PORTS: PortType[] = ['any', 'any', 'any', 'any', 'brick', 'lumber', 'wool', 'grain', 'ore'];

/** 4 forest, 4 fields, 4 pasture, 3 hills, 3 mountains, 1 desert — shuffled every game. */
export const BASE_GAME: Scenario = {
  id: 'classic',
  name: 'Classic',
  blurb: 'The standard island, shuffled fresh every game.',
  coords: HEX_COORDS,
  terrains: [
    ...repeat<Terrain>('forest', 4),
    ...repeat<Terrain>('fields', 4),
    ...repeat<Terrain>('pasture', 4),
    ...repeat<Terrain>('hills', 3),
    ...repeat<Terrain>('mountains', 3),
    'desert',
  ],
  // One each of 2 and 12, two each of 3-6 and 8-11. No 7.
  tokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
  ports: BASE_PORTS,
};

/** The rulebook's "starting setup for beginners": the same island every time. */
export const BEGINNER: Scenario = {
  id: 'beginner',
  name: 'Beginner',
  blurb: 'The fixed starter island from the rulebook. Same board every game.',
  coords: HEX_COORDS,
  fixed: true,
  // Top row first, left to right.
  terrains: [
    'mountains', 'pasture', 'forest',
    'fields', 'hills', 'pasture', 'hills',
    'fields', 'forest', 'desert', 'forest', 'mountains',
    'forest', 'mountains', 'fields', 'pasture',
    'hills', 'fields', 'pasture',
  ],
  // The same order, skipping the desert.
  tokens: [10, 2, 9, 12, 6, 4, 10, 9, 11, 3, 8, 8, 3, 4, 5, 5, 6, 11],
  ports: ['any', 'wool', 'any', 'any', 'brick', 'lumber', 'any', 'grain', 'ore'],
};

/** The 5-6 player extension island: 30 hexes in rows of 3-4-5-6-5-4-3. */
export const LARGE: Scenario = {
  id: 'large',
  name: 'Large island',
  blurb: 'The 30-hex board from the 5–6 player extension. More room, two deserts.',
  coords: rows([3, 4, 5, 6, 5, 4, 3]),
  terrains: [
    ...repeat<Terrain>('forest', 6),
    ...repeat<Terrain>('fields', 6),
    ...repeat<Terrain>('pasture', 6),
    ...repeat<Terrain>('hills', 5),
    ...repeat<Terrain>('mountains', 5),
    'desert',
    'desert',
  ],
  // Two each of 2 and 12, three each of 3-6 and 8-11.
  tokens: [2, 2, 12, 12, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap((n) => [n, n, n])],
  ports: [...BASE_PORTS, 'any', 'wool'],
};

export const MAPS: Record<MapId, Scenario> = { classic: BASE_GAME, beginner: BEGINNER, large: LARGE };

export function isMapId(x: unknown): x is MapId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(MAPS, x);
}

const graphs = new Map<MapId, BoardGraph>();

/** The hex/vertex/edge graph for a map, built once per shape. */
export function graphFor(map: MapId): BoardGraph {
  let g = graphs.get(map);
  if (!g) graphs.set(map, (g = buildBoardGraph(MAPS[map].coords)));
  return g;
}

/** The graph a board is played on. */
export const graphOf = (board: { map: MapId }) => graphFor(board.map);

/** 6 and 8 are the high-probability "red" tokens and may not sit side by side. */
export const RED_TOKENS = new Set([6, 8]);
