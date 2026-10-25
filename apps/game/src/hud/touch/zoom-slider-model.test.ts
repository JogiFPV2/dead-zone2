import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_LIMITS } from '../../camera/zoom.js';
import { sliderAt, sliderFromZoom, zoomFromSlider } from './zoom-slider-model.js';

const L = DEFAULT_ZOOM_LIMITS;

describe('touch zoom slider', () => {
  it('maps the ends to the zoom limits (top = closest)', () => {
    expect(zoomFromSlider(0, L)).toBeCloseTo(L.min);
    expect(zoomFromSlider(1, L)).toBeCloseTo(L.max);
    expect(zoomFromSlider(2, L)).toBeCloseTo(L.max);
  });
  it('round-trips zoom ↔ position', () => {
    for (const z of [0.6, 0.8, 1, 1.3, 1.6])
      expect(zoomFromSlider(sliderFromZoom(z, L), L)).toBeCloseTo(z);
  });
  it('finger position: top of the track = 1, bottom = 0, clamped', () => {
    expect(sliderAt(100, 100, 200)).toBe(1);
    expect(sliderAt(300, 100, 200)).toBe(0);
    expect(sliderAt(200, 100, 200)).toBeCloseTo(0.5);
    expect(sliderAt(500, 100, 200)).toBe(0);
    expect(sliderAt(0, 100, 0)).toBe(0);
  });
});
