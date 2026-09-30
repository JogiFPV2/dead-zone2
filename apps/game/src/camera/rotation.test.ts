import { describe, expect, it } from 'vitest';
import { ISO_YAW } from './isometric.js';
import { easeInOutCubic, isTweenDone, sampleYaw, yawForStep } from './rotation.js';

describe('rotation', () => {
  it('steps yaw by 90°', () => {
    expect(yawForStep(0)).toBeCloseTo(ISO_YAW);
    expect(yawForStep(1) - yawForStep(0)).toBeCloseTo(Math.PI / 2);
    expect(yawForStep(-1)).toBeCloseTo(ISO_YAW - Math.PI / 2);
  });

  it('eases from 0 to 1 through 0.5', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it('samples a tween and ends exactly at the target', () => {
    const tween = { from: 0, to: 1, startMs: 100, durationMs: 200 };
    expect(sampleYaw(tween, 50)).toBe(0);
    expect(sampleYaw(tween, 200)).toBeCloseTo(0.5);
    expect(sampleYaw(tween, 300)).toBe(1);
    expect(sampleYaw(tween, 999)).toBe(1);
    expect(isTweenDone(tween, 299)).toBe(false);
    expect(isTweenDone(tween, 300)).toBe(true);
  });

  it('handles zero duration', () => {
    expect(sampleYaw({ from: 0, to: 2, startMs: 0, durationMs: 0 }, 0)).toBe(2);
  });
});
