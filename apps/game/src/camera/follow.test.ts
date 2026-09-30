import { describe, expect, it } from 'vitest';
import { followFactor, followStep } from './follow.js';

describe('camera follow', () => {
  it('closes half the gap per half-life, independent of frame split', () => {
    expect(followFactor(100, 100)).toBeCloseTo(0.5);
    expect(followFactor(0, 100)).toBe(0);
    expect(followFactor(16, 0)).toBe(1);
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 0 };
    const goal = { x: 10, y: 0, z: -10 };
    followStep(a, goal, 100, 100);
    followStep(b, goal, 50, 100);
    followStep(b, goal, 50, 100);
    expect(a.x).toBeCloseTo(5);
    expect(a.z).toBeCloseTo(-5);
    expect(b.x).toBeCloseTo(a.x);
  });
});
