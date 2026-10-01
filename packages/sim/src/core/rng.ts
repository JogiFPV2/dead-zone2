/**
 * Deterministic RNG: sfc32 (4 × u32 state) seeded through splitmix32. Only integer ops
 * (`Math.imul`, shifts, `| 0`), so the sequence is identical on every JS engine.
 */

/** splitmix32 step: returns a generator of well-mixed u32 values from a 32-bit seed. */
export function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** FNV-1a over UTF-16 code units; used to turn stream names into seeds. */
export function hashString32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  }
  return h >>> 0;
}

/** Mixes a seed with any number of names / integers into a new 32-bit seed. */
export function deriveSeed(seed: number, ...parts: readonly (string | number)[]): number {
  let h = seed >>> 0;
  for (const p of parts) {
    const v = typeof p === 'string' ? hashString32(p) : p | 0;
    h = splitmix32((h ^ v) | 0)();
  }
  return h >>> 0;
}

export type Sfc32State = [number, number, number, number];

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: Readonly<Sfc32State>) {
    [this.a, this.b, this.c, this.d] = state.map((v) => v | 0) as Sfc32State;
  }

  /** Seeds sfc32 with 4 splitmix32 outputs and discards the first 12 outputs (warm-up). */
  static fromSeed(seed: number): Rng {
    const sm = splitmix32(seed);
    const rng = new Rng([sm(), sm(), sm(), sm()]);
    for (let i = 0; i < 12; i++) rng.nextU32();
    return rng;
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1) with 24 random bits (exactly representable as f32). */
  nextFloat(): number {
    return (this.nextU32() >>> 8) / 16777216;
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    const range = max - min + 1;
    return min + Math.floor((this.nextU32() / 4294967296) * range);
  }

  chance(p: number): boolean {
    return this.nextFloat() < p;
  }

  /** Index picked proportionally to integer weights. Returns -1 when all weights are 0. */
  pickWeighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return -1;
    let r = this.int(0, total - 1);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] ?? 0;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Four u32 words, for save games and the state hash. */
  state(): Sfc32State {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}

/**
 * Named streams, so extra rolls in one system never shift randomness in another
 * (docs/sim-architecture.md 2.2). The order is fixed and is part of the state hash.
 */
export const RNG_STREAMS = [
  'world',
  'ai',
  'combat',
  'health',
  'survival',
  'actions',
  'progression',
  'physics',
] as const;
export type RngStream = (typeof RNG_STREAMS)[number];
export type RngStreams = Record<RngStream, Rng>;

export function createRngStreams(seed: number): RngStreams {
  const out = {} as RngStreams;
  for (const name of RNG_STREAMS) out[name] = Rng.fromSeed(deriveSeed(seed, name));
  return out;
}

/** Stateless derived RNG, e.g. `rngFor(seed, 'loot', cx, cy, containerIndex)`. */
export function rngFor(seed: number, ...parts: readonly (string | number)[]): Rng {
  return Rng.fromSeed(deriveSeed(seed, ...parts));
}

/** Convenience single-stream RNG from a seed. */
export const createRng = (seed: number): Rng => Rng.fromSeed(seed);
