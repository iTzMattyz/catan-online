/**
 * Board geometry for a pointy-top hex board.
 *
 * Nothing here is hand-listed. Hexes are axial coordinates within distance 2 of
 * the origin (19 of them, in rows of 3-4-5-4-3). A vertex is *identified* by the
 * sorted triple of hexes that touch it, and an edge by the sorted pair of its two
 * vertices. That makes both sets automatically de-duplicated and canonical: the
 * same corner reached from three different hexes produces the same id, so the
 * graph comes out at exactly 19 hexes / 54 vertices / 72 edges with no bookkeeping.
 *
 * Everything the rules need — the distance rule, road connectivity, longest road,
 * which hexes pay a settlement — is a lookup in this graph.
 */

export type Axial = { q: number; r: number };
export type HexId = string;
export type VertexId = string;
export type EdgeId = string;
export type Point = { x: number; y: number };

/** Circumradius in SVG units. The board is ~10 hexes wide at this size. */
export const HEX_SIZE = 60;

/**
 * The two neighbours sharing corner i, where corner i sits at angle 60*i - 30
 * (i=0 upper-right, going clockwise on screen). Corner i is the meeting point of
 * this hex and the two neighbours either side of it.
 */
const CORNER_NEIGHBOURS: readonly [Axial, Axial][] = [
  [{ q: 1, r: -1 }, { q: 1, r: 0 }], // upper-right: NE + E
  [{ q: 1, r: 0 }, { q: 0, r: 1 }], // lower-right: E + SE
  [{ q: 0, r: 1 }, { q: -1, r: 1 }], // bottom: SE + SW
  [{ q: -1, r: 1 }, { q: -1, r: 0 }], // lower-left: SW + W
  [{ q: -1, r: 0 }, { q: 0, r: -1 }], // upper-left: W + NW
  [{ q: 0, r: -1 }, { q: 1, r: -1 }], // top: NW + NE
];

export function hexId(a: Axial): HexId {
  return `${a.q},${a.r}`;
}

export function parseHexId(id: HexId): Axial {
  const [q, r] = id.split(',').map(Number);
  return { q, r };
}

function add(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** Axial ring distance from the origin. */
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Centre of a hex in SVG units, origin at board centre. */
export function hexCenter(a: Axial, size = HEX_SIZE): Point {
  return {
    x: size * Math.sqrt(3) * (a.q + a.r / 2),
    y: size * 1.5 * a.r,
  };
}

/** Corner i of a hex, at angle 60*i - 30 degrees. */
export function hexCorner(a: Axial, i: number, size = HEX_SIZE): Point {
  const c = hexCenter(a, size);
  const angle = (Math.PI / 180) * (60 * i - 30);
  return { x: c.x + size * Math.cos(angle), y: c.y + size * Math.sin(angle) };
}

/** The 19 land positions, in display rows of 3-4-5-4-3. */
export const HEX_COORDS: readonly Axial[] = (() => {
  const out: Axial[] = [];
  for (let r = -2; r <= 2; r++) {
    for (let q = Math.max(-2, -2 - r); q <= Math.min(2, 2 - r); q++) {
      out.push({ q, r });
    }
  }
  return out;
})();

export type VertexInfo = { id: VertexId; pos: Point; hexes: HexId[] };
export type EdgeInfo = {
  id: EdgeId;
  vertices: [VertexId, VertexId];
  pos: Point;
  /** Degrees, for rotating a road sprite onto the edge. */
  angle: number;
};

export type BoardGraph = {
  hexes: HexId[];
  /** Hex centres, shifted so the island's centroid sits at the origin. */
  hexPos: Record<HexId, Point>;
  /** Vertices of each hex, corner order 0..5. */
  hexVertices: Record<HexId, VertexId[]>;
  /** Edges of each hex, edge i spans corner i -> corner i+1. */
  hexEdges: Record<HexId, EdgeId[]>;
  vertices: Record<VertexId, VertexInfo>;
  edges: Record<EdgeId, EdgeInfo>;
  /** Land hexes touching a vertex (a subset of the identifying triple). */
  vertexHexes: Record<VertexId, HexId[]>;
  vertexEdges: Record<VertexId, EdgeId[]>;
  /** The (2 or 3) vertices one edge away. This is the distance rule. */
  vertexNeighbours: Record<VertexId, VertexId[]>;
  /** Edges on the coastline, ordered as a walkable ring. Ports sit on these. */
  boundaryRing: EdgeId[];
};

function vertexIdFor(hexesAround: Axial[]): VertexId {
  return hexesAround.map(hexId).sort().join('|');
}

function edgeIdFor(a: VertexId, b: VertexId): EdgeId {
  return a < b ? `${a}/${b}` : `${b}/${a}`;
}

export function buildBoardGraph(coords: readonly Axial[] = HEX_COORDS): BoardGraph {
  const hexes = coords.map(hexId);
  const isLand = new Set(hexes);
  // Odd-width boards (e.g. 3-4-5-6-5-4-3) have no hex at the middle, so centre on the centroid.
  const centres = coords.map((c) => hexCenter(c));
  const off = {
    x: centres.reduce((n, c) => n + c.x, 0) / centres.length,
    y: centres.reduce((n, c) => n + c.y, 0) / centres.length,
  };
  const shift = (p: Point): Point => ({ x: p.x - off.x, y: p.y - off.y });
  const hexPos = Object.fromEntries(hexes.map((h, i) => [h, shift(centres[i])]));

  const vertices: Record<VertexId, VertexInfo> = {};
  const edges: Record<EdgeId, EdgeInfo> = {};
  const hexVertices: Record<HexId, VertexId[]> = {};
  const hexEdges: Record<HexId, EdgeId[]> = {};
  const vertexEdges: Record<VertexId, EdgeId[]> = {};

  for (const coord of coords) {
    const h = hexId(coord);
    const corners: VertexId[] = [];
    for (let i = 0; i < 6; i++) {
      const [d1, d2] = CORNER_NEIGHBOURS[i];
      const trio = [coord, add(coord, d1), add(coord, d2)];
      const vid = vertexIdFor(trio);
      if (!vertices[vid]) {
        vertices[vid] = {
          id: vid,
          pos: shift(hexCorner(coord, i)),
          hexes: trio.map(hexId),
        };
        vertexEdges[vid] = [];
      }
      corners.push(vid);
    }
    hexVertices[h] = corners;

    const own: EdgeId[] = [];
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      const eid = edgeIdFor(a, b);
      if (!edges[eid]) {
        const pa = vertices[a].pos;
        const pb = vertices[b].pos;
        edges[eid] = {
          id: eid,
          vertices: [a, b],
          pos: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
          angle: (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI,
        };
        vertexEdges[a].push(eid);
        vertexEdges[b].push(eid);
      }
      own.push(eid);
    }
    hexEdges[h] = own;
  }

  const vertexHexes: Record<VertexId, HexId[]> = {};
  const vertexNeighbours: Record<VertexId, VertexId[]> = {};
  for (const vid of Object.keys(vertices)) {
    vertexHexes[vid] = vertices[vid].hexes.filter((h) => isLand.has(h));
    vertexNeighbours[vid] = vertexEdges[vid].map((eid) => {
      const [a, b] = edges[eid].vertices;
      return a === vid ? b : a;
    });
  }

  return {
    hexes,
    hexPos,
    hexVertices,
    hexEdges,
    vertices,
    edges,
    vertexHexes,
    vertexEdges,
    vertexNeighbours,
    boundaryRing: buildBoundaryRing(edges, hexEdges, vertexEdges),
  };
}

/**
 * Walk the coastline. A coastal edge belongs to exactly one land hex; starting
 * from one and always stepping to the next unused coastal edge yields the ring in
 * order, which is what lets ports be spaced evenly around the board.
 */
function buildBoundaryRing(
  edges: Record<EdgeId, EdgeInfo>,
  hexEdges: Record<HexId, EdgeId[]>,
  vertexEdges: Record<VertexId, EdgeId[]>,
): EdgeId[] {
  const useCount = new Map<EdgeId, number>();
  for (const list of Object.values(hexEdges)) {
    for (const eid of list) useCount.set(eid, (useCount.get(eid) ?? 0) + 1);
  }
  const coastal = new Set([...useCount].filter(([, n]) => n === 1).map(([id]) => id));
  if (coastal.size === 0) return [];

  const start = [...coastal][0];
  const ring: EdgeId[] = [start];
  const used = new Set([start]);
  let cursor = edges[start].vertices[1];

  while (ring.length < coastal.size) {
    const nextEdge = vertexEdges[cursor].find((e) => coastal.has(e) && !used.has(e));
    if (!nextEdge) break;
    ring.push(nextEdge);
    used.add(nextEdge);
    const [a, b] = edges[nextEdge].vertices;
    cursor = a === cursor ? b : a;
  }
  return ring;
}

/** The base 19-hex board. Game code should use `graphOf(board)` from scenario.ts. */
export const BOARD = buildBoardGraph();
