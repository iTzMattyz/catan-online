import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import type { BoardGraph, HexId } from '../../shared/layout';

/*
 * Motion for the 3D board. Everything is timed off the canvas clock, which
 * starts when the canvas mounts, so the opening sequence needs no extra state:
 * "0.4 s after the board appeared" is just clock.elapsedTime === 0.4.
 */

export const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function easeOutBounce(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

/** First contact of easeOutBounce: where a dropped piece first hits the board. */
export const BOUNCE_CONTACT = 1 / 2.75;

export function easeOutBack(x: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ------------------------------------------------------------ opening ---


const TILE_STEP = 0.07;
const TILE_FALL = 0.6;
const TILE_HEIGHT = 2.2;
const TOKEN_STEP = 0.035;
const TOKEN_POP = 0.35;

/** Tiles land from the centre outwards, a ring at a time. Set per map by `layIntro`. */
let HEX_ORDER: Record<HexId, number> = {};
export let TILES_DONE = 0;
/** When pieces already on the board at load drop in. */
export let INTRO_DONE = 0;

/** Re-time the opening for a board of this shape. Called when the active map changes. */
export function layIntro(g: BoardGraph): void {
  HEX_ORDER = Object.fromEntries(
    [...g.hexes]
      .map((h) => {
        const { x, y } = g.hexPos[h];
        return { h, d: Math.round(Math.hypot(x, y) / 6), a: Math.atan2(y, x) };
      })
      .sort((p, q) => p.d - q.d || p.a - q.a)
      .map((p, i) => [p.h, i]),
  );
  TILES_DONE = reducedMotion ? 0 : (g.hexes.length - 1) * TILE_STEP + TILE_FALL + 0.15;
  INTRO_DONE = reducedMotion ? 0 : TILES_DONE + g.hexes.length * TOKEN_STEP + TOKEN_POP;
}

/** Height above its resting place of a tile (and everything on it) at time t. */
export function tileLift(hex: HexId, t: number): number {
  if (reducedMotion) return 0;
  const since = t - HEX_ORDER[hex] * TILE_STEP;
  // Not its turn yet: parked far above the camera rather than hovering in view.
  if (since < 0) return 60;
  return TILE_HEIGHT * (1 - easeOutBounce(clamp01(since / TILE_FALL)));
}

/** Scale of a number chit at time t: pops in once the tiles are down. */
export function tokenScale(hex: HexId, t: number): number {
  if (reducedMotion) return 1;
  const p = clamp01((t - TILES_DONE - HEX_ORDER[hex] * TOKEN_STEP) / TOKEN_POP);
  return p === 0 ? 0.0001 : easeOutBack(p);
}

// ------------------------------------------------------------- pieces ---

/**
 * Drop a group onto the board with a bounce. The group should rest at y=0 in
 * its parent. Returns the time (canvas clock) of first contact, for dust.
 */
export function useDrop(ref: React.RefObject<THREE.Object3D>, delay = 0, height = 1.6, duration = 0.8) {
  const start = useRef<number | null>(null);
  const done = useRef(false);
  useFrame(({ clock }) => {
    const g = ref.current;
    if (!g || done.current) return;
    if (start.current === null) start.current = clock.elapsedTime + delay;
    if (reducedMotion) {
      g.visible = true;
      g.position.y = 0;
      done.current = true;
      return;
    }
    const t = clock.elapsedTime - start.current;
    g.visible = t >= 0;
    const p = clamp01(t / duration);
    g.position.y = height * (1 - easeOutBounce(p));
    // A little tumble on the way down that settles as it lands.
    g.rotation.z = (1 - p) * (1 - p) * 0.5;
    if (p >= 1) {
      g.rotation.z = 0;
      done.current = true;
    }
  });
}
