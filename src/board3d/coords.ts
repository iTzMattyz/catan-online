import * as THREE from 'three';
import { HEX_SIZE, type BoardGraph, type HexId, type Point } from '../../shared/layout';
import { graphFor, type MapId } from '../../shared/scenario';
import { layIntro } from './anim';

/**
 * The shared layout is in SVG units (hex circumradius 60, y pointing down the
 * screen). The 3D board uses one hex = one world unit, with SVG y becoming world
 * z, so "down the screen" in 2D is "towards the camera" in 3D and both boards
 * read the same way round.
 */
export const toWorld = (p: Point): [number, number] => [p.x / HEX_SIZE, p.y / HEX_SIZE];

export const hexWorld = (h: HexId): [number, number] => toWorld(G.hexPos[h]);

/** Heights, bottom to top. */
export const Y = {
  sea: -0.14,
  tileTop: 0.2,
  frameTop: 0.24,
} as const;

/*
 * The active map. Only one board is ever on screen, so the 3D scene reads its
 * shape from here instead of threading the map through every component.
 * ponytail: module state; pass a context down if two boards ever render at once.
 */
let activeMap: MapId | null = null;
export let G: BoardGraph;
/** Coastline vertices in ring order, world coordinates. */
export let COAST: [number, number][] = [];
/**
 * The frame is a flat-top hexagon, possibly squashed: FRAME_Z is the distance to
 * its top and bottom edges, FRAME_B to its four slanted ones. Each clears the
 * furthest coast point, with room at the corners for the dice.
 */
export let FRAME_Z = 0;
export let FRAME_B = 0;

const slant = (x: number, z: number) => Math.abs(x) * 0.866 + Math.abs(z) * 0.5;

export function setActiveMap(map: MapId): void {
  if (map === activeMap) return;
  activeMap = map;
  G = graphFor(map);
  const ring = G.boundaryRing;
  COAST = [];
  let cursor = G.edges[ring[0]].vertices[0];
  for (const edgeId of ring) {
    const [a, b] = G.edges[edgeId].vertices;
    cursor = a === cursor ? b : a;
    COAST.push(toWorld(G.vertices[cursor].pos));
  }
  FRAME_Z = Math.max(...COAST.map(([, z]) => Math.abs(z))) + 0.5;
  FRAME_B = Math.max(...COAST.map(([x, z]) => slant(x, z))) + 0.5;
  layIntro(G);
}
setActiveMap('classic');

/** How far outside the frame's edge a point is (negative inside). */
export const frameDist = (x: number, z: number) => Math.max(Math.abs(z) - FRAME_Z, slant(x, z) - FRAME_B);

/** The frame's outline, grown by `extra`, starting at its right-hand corner. */
export function frameOutline(extra = 0): [number, number][] {
  const z = FRAME_Z + extra;
  const b = FRAME_B + extra;
  const side = b / 0.866;
  const top = (b - z * 0.5) / 0.866;
  return [[side, 0], [top, z], [-top, z], [-side, 0], [-top, -z], [top, -z]];
}

/** Distance from the centre to the frame's furthest corner. */
export const frameRadius = () => Math.max(...frameOutline().map(([x, z]) => Math.hypot(x, z)));

/**
 * A THREE.Shape lives in XY and extrudes along +Z; we lay it flat with
 * rotateX(-PI/2), which sends shape y to world -z. So points go in as (x, -z).
 */
export function shapeFrom(points: [number, number][]): THREE.Shape {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
  shape.closePath();
  return shape;
}

export function hexagon(radius: number, flatTop = false): [number, number][] {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - (flatTop ? 0 : 30));
    return [radius * Math.cos(a), radius * Math.sin(a)] as [number, number];
  });
}

/** Unit normal of a coastal edge, pointing out to sea. */
export function edgeOutward(pos: Point, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  let nx = -Math.sin(a);
  let nz = Math.cos(a);
  if (nx * pos.x + nz * pos.y < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

/** Rotation about world Y that lines a piece's local x axis up with an SVG angle. */
export const yawFromSvg = (angleDeg: number) => (-angleDeg * Math.PI) / 180;
