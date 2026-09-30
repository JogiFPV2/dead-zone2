import { describe, expect, it } from 'vitest';
import {
  RNG_STREAMS,
  Rng,
  createRng,
  createRngStreams,
  deriveSeed,
  rngFor,
  splitmix32,
} from './rng.js';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());

describe('Rng (sfc32 + splitmix32)', () => {
  it('is repeatable for the same seed', () => {
    expect(take(createRng(42), 200)).toEqual(take(createRng(42), 200));
  });

  it('differs between seeds', () => {
    expect(take(createRng(1), 8)).not.toEqual(take(createRng(2), 8));
  });

  it('matches a known sequence (guards against accidental algorithm changes)', () => {
    expect(take(createRng(12345), 4)).toMatchInlineSnapshot(`
      [
        2142345551,
        3083893245,
        1997626643,
        3123200824,
      ]
    `);
    const sm = splitmix32(0);
    expect([sm(), sm()]).toMatchInlineSnapshot(`
      [
        1684164658,
        3653269916,
      ]
    `);
  });

  it('resumes from a saved state', () => {
    const a = createRng(7);
    take(a, 13);
    const b = new Rng(a.state());
    expect(take(b, 50)).toEqual(take(a, 50));
  });

  it('keeps floats in [0, 1) and ints in range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const f = rng.nextFloat();
      expect(f >= 0 && f < 1).toBe(true);
      expect(Math.fround(f)).toBe(f);
      const n = rng.int(-3, 3);
      expect(n >= -3 && n <= 3 && Number.isInteger(n)).toBe(true);
    }
  });

  it('pickWeighted respects zero weights and proportions', () => {
    const rng = createRng(3);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[rng.pickWeighted([1, 0, 3])]! += 1;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.4);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.6);
    expect(rng.pickWeighted([0, 0])).toBe(-1);
  });
});

describe('named streams', () => {
  it('are repeatable and distinct per name', () => {
    const a = createRngStreams(99);
    const b = createRngStreams(99);
    const firsts = new Set<number>();
    for (const name of RNG_STREAMS) {
      const v = a[name].nextU32();
      expect(b[name].nextU32()).toBe(v);
      firsts.add(v);
    }
    expect(firsts.size).toBe(RNG_STREAMS.length);
  });

  it('are independent: extra rolls in one stream do not shift another', () => {
    const a = createRngStreams(5);
    const b = createRngStreams(5);
    take(a.combat, 1000);
    expect(take(a.world, 20)).toEqual(take(b.world, 20));
  });

  it('derived RNG depends only on seed and parts', () => {
    expect(take(rngFor(1, 'loot', 3, 4, 0), 5)).toEqual(take(rngFor(1, 'loot', 3, 4, 0), 5));
    expect(take(rngFor(1, 'loot', 3, 4, 0), 5)).not.toEqual(take(rngFor(1, 'loot', 4, 3, 0), 5));
    expect(deriveSeed(1, 'a')).not.toBe(deriveSeed(1, 'b'));
  });
});
