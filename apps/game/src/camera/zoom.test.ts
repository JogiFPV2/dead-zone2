import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_LIMITS, smoothZoom, zoomFromWheel } from './zoom.js';

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

  it('defaults to 0.6×–6× of the default zoom', () => {
    expect(DEFAULT_ZOOM_LIMITS.min).toBe(0.6);
    expect(DEFAULT_ZOOM_LIMITS.max).toBe(6);
    expect(zoomFromWheel(1, -100_000)).toBe(6);
    expect(zoomFromWheel(1, 100_000)).toBe(0.6);
  });
});

describe('smoothZoom', () => {
  it('halves the distance every half-life', () => {
    expect(smoothZoom(1, 2, 100, 100)).toBeCloseTo(1.5);
    expect(smoothZoom(1, 2, 200, 100)).toBeCloseTo(1.75);
  });

  it('does not move without time and never overshoots', () => {
    expect(smoothZoom(1, 2, 0, 100)).toBe(1);
    expect(smoothZoom(1, 2, 1e6, 100)).toBe(2);
  });

  it('snaps when close', () => {
    expect(smoothZoom(1.99995, 2, 1, 100)).toBe(2);
  });
});
