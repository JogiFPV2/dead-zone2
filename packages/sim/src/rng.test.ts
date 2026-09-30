import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';

const take = (seed: number, n: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('is deterministic for the same seed', () => {
    expect(take(42, 100)).toEqual(take(42, 100));
  });

  it('differs between seeds', () => {
    expect(take(1, 10)).not.toEqual(take(2, 10));
  });

  it('matches a known sequence (guards against accidental algorithm changes)', () => {
    expect(take(12345, 3).map((x) => x.toFixed(8))).toMatchInlineSnapshot(`
      [
        "0.97972827",
        "0.30675226",
        "0.48420542",
      ]
    `);
  });

  it('produces floats in [0, 1) and ints in range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(-3, 3);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
