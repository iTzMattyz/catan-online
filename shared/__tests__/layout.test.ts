import { describe, it, expect } from 'vitest';
import { BOARD, HEX_COORDS, hexDistance, hexId } from '../layout';

describe('board graph', () => {
  it('has the 19 land hexes in rows of 3-4-5-4-3', () => {
    expect(HEX_COORDS).toHaveLength(19);
    for (const c of HEX_COORDS) expect(hexDistance(c, { q: 0, r: 0 })).toBeLessThanOrEqual(2);
    const rows = new Map<number, number>();
    for (const c of HEX_COORDS) rows.set(c.r, (rows.get(c.r) ?? 0) + 1);
    expect([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, n]) => n)).toEqual([3, 4, 5, 4, 3]);
  });

  it('derives exactly 54 vertices and 72 edges', () => {
    expect(Object.keys(BOARD.vertices)).toHaveLength(54);
    expect(Object.keys(BOARD.edges)).toHaveLength(72);
  });

  it('satisfies Euler: V - E + F = 1 for the planar board', () => {
    const v = Object.keys(BOARD.vertices).length;
    const e = Object.keys(BOARD.edges).length;
    expect(v - e + BOARD.hexes.length).toBe(1);
  });

  it('gives every hex 6 distinct vertices and 6 distinct edges', () => {
    for (const h of BOARD.hexes) {
      expect(new Set(BOARD.hexVertices[h]).size).toBe(6);
      expect(new Set(BOARD.hexEdges[h]).size).toBe(6);
    }
  });

  it('shares corners: interior vertices touch 3 land hexes, coastal ones fewer', () => {
    const counts = Object.values(BOARD.vertexHexes).map((h) => h.length);
    expect(Math.max(...counts)).toBe(3);
    expect(Math.min(...counts)).toBe(1);
    // The centre hex is fully interior, so all 6 of its corners touch 3 hexes.
    for (const v of BOARD.hexVertices[hexId({ q: 0, r: 0 })]) {
      expect(BOARD.vertexHexes[v]).toHaveLength(3);
    }
  });

  it('keeps vertex adjacency symmetric with degree 2 or 3', () => {
    for (const [vid, nbrs] of Object.entries(BOARD.vertexNeighbours)) {
      expect(nbrs.length).toBeGreaterThanOrEqual(2);
      expect(nbrs.length).toBeLessThanOrEqual(3);
      expect(new Set(nbrs).size).toBe(nbrs.length);
      for (const n of nbrs) expect(BOARD.vertexNeighbours[n]).toContain(vid);
    }
  });

  it('walks a closed coastline of 30 edges', () => {
    expect(BOARD.boundaryRing).toHaveLength(30);
    expect(new Set(BOARD.boundaryRing).size).toBe(30);
    // Consecutive ring edges share a vertex, and the ring closes on itself.
    for (let i = 0; i < 30; i++) {
      const a = BOARD.edges[BOARD.boundaryRing[i]].vertices;
      const b = BOARD.edges[BOARD.boundaryRing[(i + 1) % 30]].vertices;
      expect(a.some((v) => b.includes(v))).toBe(true);
    }
  });

  it('places every edge between two vertices that list it', () => {
    for (const e of Object.values(BOARD.edges)) {
      for (const v of e.vertices) expect(BOARD.vertexEdges[v]).toContain(e.id);
    }
  });
});
