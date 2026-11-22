import { describe, expect, it } from 'vitest';
import { paintedZoom, STYLE_TUNING, urlGraphicsStyle } from './graphics-style.js';

describe('„Malowany” graphics style', () => {
  it('?style=malowany / painted picks it for the session, other values do not', () => {
    expect(urlGraphicsStyle('?style=malowany')).toBe('painted');
    expect(urlGraphicsStyle('?style=painted')).toBe('painted');
    expect(urlGraphicsStyle('?style=real')).toBeUndefined();
    expect(urlGraphicsStyle('')).toBeUndefined();
  });

  it('zooming in shrinks the brush and brings back the sharp image', () => {
    const z = STYLE_TUNING.painted.zoom;
    const far = paintedZoom(z.min);
    const near = paintedZoom(z.max);
    expect(far).toEqual({ stride: z.strideFar, detail: 0 });
    expect(near.stride).toBeCloseTo(z.strideNear);
    expect(near.detail).toBeCloseTo(z.detail);
    const mid = paintedZoom(1);
    expect(mid.stride).toBeLessThan(far.stride);
    expect(mid.detail).toBeGreaterThan(0);
    expect(paintedZoom(5)).toEqual(paintedZoom(z.max));
  });
});
