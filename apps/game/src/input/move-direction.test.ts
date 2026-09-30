import { describe, expect, it } from 'vitest';
import { yawForStep } from '../camera/rotation.js';
import { moveDirection, sameMove, type MoveKeys } from './move-direction.js';

const keys = (s: string): MoveKeys => ({
  up: s.includes('W'),
  down: s.includes('S'),
  left: s.includes('A'),
  right: s.includes('D'),
});
const H = Math.SQRT1_2;

// Camera sits at (sin yaw, cos yaw) from the target; W points away from it.
const cases: [step: number, w: [number, number], d: [number, number]][] = [
  [0, [-H, -H], [H, -H]],
  [1, [-H, H], [-H, -H]],
  [2, [H, H], [-H, H]],
  [3, [H, -H], [H, H]],
];

describe('moveDirection', () => {
  it.each(cases)('camera step %i maps W and D to world axes', (step, w, d) => {
    const yaw = yawForStep(step);
    const mw = moveDirection(keys('W'), yaw);
    const md = moveDirection(keys('D'), yaw);
    const ms = moveDirection(keys('S'), yaw);
    const ma = moveDirection(keys('A'), yaw);
    expect([mw.dx, mw.dy].map((v, i) => v - w[i]!)).toEqual([expect.closeTo(0), expect.closeTo(0)]);
    expect(md.dx).toBeCloseTo(d[0]);
    expect(md.dy).toBeCloseTo(d[1]);
    expect(ms.dx).toBeCloseTo(-w[0]);
    expect(ms.dy).toBeCloseTo(-w[1]);
    expect(ma.dx).toBeCloseTo(-d[0]);
    expect(ma.dy).toBeCloseTo(-d[1]);
  });

  it.each([0, 1, 2, 3])('normalizes diagonals for camera step %i', (step) => {
    const yaw = yawForStep(step);
    for (const combo of ['WD', 'WA', 'SD', 'SA']) {
      const m = moveDirection(keys(combo), yaw);
      expect(Math.hypot(m.dx, m.dy)).toBeCloseTo(1);
    }
    // In the classic view W+D runs along world -Z (screen up-right).
    if (step === 0) {
      const m = moveDirection(keys('WD'), yaw);
      expect(m.dx).toBe(0);
      expect(m.dy).toBeCloseTo(-1);
    }
  });

  it('returns zero for no keys or opposing keys', () => {
    expect(moveDirection(keys(''), 1)).toEqual({ dx: 0, dy: 0 });
    expect(moveDirection(keys('WSAD'), 1)).toEqual({ dx: 0, dy: 0 });
  });

  it('compares moves with a tolerance', () => {
    expect(sameMove({ dx: 1, dy: 0 }, { dx: 1 + 1e-9, dy: 0 })).toBe(true);
    expect(sameMove({ dx: 1, dy: 0 }, { dx: 0, dy: 1 })).toBe(false);
  });
});
