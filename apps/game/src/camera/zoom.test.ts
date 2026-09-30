import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_LIMITS, zoomFromWheel } from './zoom.js';

const limits = { min: 0.5, max: 2, step: 1.25 };

describe('zoomFromWheel', () => {
  it('zooms in on scroll up and out on scroll down', () => {
    expect(zoomFromWheel(1, -100, limits)).toBeCloseTo(1.25);
    expect(zoomFromWheel(1, 100, limits)).toBeCloseTo(0.8);
  });

  it('is symmetric (in then out returns to start)', () => {
    expect(zoomFromWheel(zoomFromWheel(1, -37, limits), 37, limits)).toBeCloseTo(1);
  });

  it('clamps to limits', () => {
    expect(zoomFromWheel(1.9, -1000, limits)).toBe(2);
    expect(zoomFromWheel(0.6, 1000, limits)).toBe(0.5);
  });

  it('has sane defaults', () => {
    expect(DEFAULT_ZOOM_LIMITS.min).toBeLessThan(1);
    expect(DEFAULT_ZOOM_LIMITS.max).toBeGreaterThan(1);
  });
});
