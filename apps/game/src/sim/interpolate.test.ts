import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, interpolateEntity, lerpAngle, tickAlpha } from './interpolate.js';

const e = (x: number, y: number, facing = 0) => ({ id: 1, x, y, z: 0, facing });

describe('interpolation', () => {
  it('computes alpha from time since the last tick', () => {
    expect(tickAlpha(1000, 1000, 50)).toBe(0);
    expect(tickAlpha(1025, 1000, 50)).toBe(0.5);
    expect(tickAlpha(1100, 1000, 50)).toBe(1);
    expect(tickAlpha(990, 1000, 50)).toBe(0);
  });

  it('lerps position and takes the short way round for facing', () => {
    const m = interpolateEntity(e(0, 0, 0), e(2, -4, 0), 0.25);
    expect(m.x).toBeCloseTo(0.5);
    expect(m.y).toBeCloseTo(-1);
    expect(lerpAngle(3, -3, 0.5)).toBeCloseTo(Math.PI, 1);
    expect(Math.abs(lerpAngle(3, -3, 0.5))).toBeGreaterThan(3);
  });

  it('buffers the last two states', () => {
    const b = new SnapshotBuffer();
    expect(b.sample(0, 50)).toBeUndefined();
    b.push(e(0, 0), 0);
    expect(b.sample(10, 50)?.x).toBe(0);
    b.push(e(1, 0), 50);
    expect(b.sample(50, 50)?.x).toBe(0);
    expect(b.sample(75, 50)?.x).toBeCloseTo(0.5);
    expect(b.sample(200, 50)?.x).toBe(1);
  });
});
