import { describe, expect, it } from 'vitest';
import { TOWER_SHAFT, TOWER_SPIRE, churchTower } from './church-tower.js';

const cells = { uv: () => [0.1, 0.1] as [number, number], color: () => undefined as never };

describe('church tower', () => {
  it('stands on the footprint, reaches above the roof, both variants', () => {
    const f = { x0: 0, z0: 0, x1: 19, z1: 9 };
    const tops = new Set<number>();
    for (let id = 1; id < 20; id++) {
      const g = churchTower(f, id, 'w', 'r', cells, 3);
      const bb = g.boundingBox!;
      expect(bb.min.x).toBeGreaterThanOrEqual(-0.5);
      expect(bb.max.x).toBeLessThanOrEqual(20.5);
      expect(bb.max.y).toBeCloseTo(3 + TOWER_SHAFT + 0.3 + TOWER_SPIRE, 3);
      tops.add(Math.round(bb.min.x));
    }
    expect(tops.size).toBe(2); // either short end
  });
});
