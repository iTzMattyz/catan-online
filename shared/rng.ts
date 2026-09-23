/**
 * Deterministic PRNG. The seed lives inside GameState so every transition is a
 * pure function of the state: same state + same action always yields the same
 * result, which makes games replayable and the reducer testable.
 */
export type Rng = { seed: number };

export function makeRng(seed?: number): Rng {
  return { seed: (seed ?? Math.floor(Math.random() * 2 ** 32)) >>> 0 };
}

/** mulberry32 — returns [0, 1) and advances the seed in place. */
export function next(rng: Rng): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function nextInt(rng: Rng, n: number): number {
  return Math.floor(next(rng) * n);
}

/** One die. */
export function rollDie(rng: Rng): number {
  return nextInt(rng, 6) + 1;
}

/** Fisher-Yates, returns a new array. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick one element. Caller guarantees the array is non-empty. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[nextInt(rng, items.length)];
}
