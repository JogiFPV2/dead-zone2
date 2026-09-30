import { describe, expect, it } from 'vitest';
import { createRng } from '@deadzone/sim';
import { readEntity } from '../sim/snapshot.js';
import {
  CROWD_FIRST_ID,
  CROWD_SPEED,
  createCrowd,
  parseCrowdParam,
  stepCrowd,
  writeCrowd,
} from './mock-crowd.js';

const bounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 };

describe('mock crowd', () => {
  it('is deterministic for a seed and stays in bounds', () => {
    const run = () => {
      const rng = createRng(42);
      const c = createCrowd(50, rng, bounds);
      for (let t = 0; t < 400; t++) stepCrowd(c, rng, 0.05, bounds);
      return c.state;
    };
    const a = run();
    expect(a).toEqual(run());
    for (let i = 0; i < 50; i++) {
      expect(Math.abs(a[i * 3] ?? 99)).toBeLessThanOrEqual(5);
      expect(Math.abs(a[i * 3 + 1] ?? 99)).toBeLessThanOrEqual(5);
    }
  });

  it('walks at CROWD_SPEED away from walls', () => {
    const c = { count: 1, state: new Float32Array([0, 0, 0]) };
    stepCrowd(c, { nextFloat: () => 0.99 }, 0.5, bounds);
    expect(c.state[0]).toBeCloseTo(CROWD_SPEED * 0.5);
  });

  it('writes snapshot entities with stable ids after an offset', () => {
    const c = { count: 2, state: new Float32Array([1, 2, 0.5, 3, 4, 1]) };
    const out = new Float32Array(15);
    writeCrowd(c, out, 5);
    expect(readEntity(out, 2)).toEqual({ id: CROWD_FIRST_ID + 1, x: 3, y: 4, z: 0, facing: 1 });
  });

  it('parses ?crowd=N', () => {
    expect(parseCrowdParam('?crowd=200')).toBe(200);
    expect(parseCrowdParam('?crowd=abc')).toBe(0);
    expect(parseCrowdParam('')).toBe(0);
    expect(parseCrowdParam('?crowd=999999')).toBe(5000);
  });
});
