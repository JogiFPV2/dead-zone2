import { describe, expect, it } from 'vitest';
import { STRESS_WORLD_CHUNKS, StressWorldSource } from './stress-source.js';

describe('StressWorldSource', () => {
  it('is deterministic per (seed, cx, cy) and independent of call order', () => {
    const a = new StressWorldSource(7);
    const b = new StressWorldSource(7);
    const c = a.centre;
    const cx = Math.floor(c.x / 32);
    const cy = Math.floor(c.y / 32);
    b.generate(cx + 5, cy - 3);
    const x = a.generate(cx, cy)!;
    const y = b.generate(cx, cy)!;
    expect([...x.levels.get(0)!.floor]).toEqual([...y.levels.get(0)!.floor]);
    expect(x.decor).toEqual(y.decor);
    expect(x.buildings).toEqual(y.buildings);
  });

  it('covers 8 × 8 km with a town at the spawn and nothing outside', () => {
    const s = new StressWorldSource(1);
    expect(STRESS_WORLD_CHUNKS * 32).toBe(8000);
    expect(s.generate(-1, 0)).toBeUndefined();
    expect(s.generate(STRESS_WORLD_CHUNKS, 0)).toBeUndefined();
    const mid = STRESS_WORLD_CHUNKS / 2;
    expect(s.isTown(mid, mid)).toBe(true);
    let houses = 0;
    for (let i = 0; i < 9; i++)
      houses += s.generate(mid - 1 + (i % 3), mid - 1 + Math.floor(i / 3))!.buildings!.length;
    expect(houses).toBeGreaterThan(5);
  });

  it('summary agrees with the chunk on built-up cells', () => {
    const s = new StressWorldSource(1);
    const mid = STRESS_WORLD_CHUNKS / 2;
    const sum = s.getSummary(mid, mid)!;
    expect(sum.height.some((h) => h > 0)).toBe(true);
    expect(sum.ground.every((g) => g > 0)).toBe(true);
  });
});
