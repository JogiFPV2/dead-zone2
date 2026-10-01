import { describe, expect, it } from 'vitest';
import { PIXEL_SIZE_PX, isPixelStyle, pixelRows, pixelTargetSize } from './graphics-style.js';

describe('pixel styles: one art-pixel size per style', () => {
  it('pixel stays 3 px (427 × 240), pixel-fine is 2 px (640 × 360) at 1280 × 720', () => {
    expect(PIXEL_SIZE_PX).toEqual({ pixel: 3, 'pixel-fine': 2 });
    expect(pixelRows('pixel')).toBe(240);
    expect(pixelRows('pixel-fine')).toBe(360);
    expect(pixelTargetSize('pixel', 1280, 720)).toEqual({ w: 427, h: 240 });
    expect(pixelTargetSize('pixel-fine', 1280, 720)).toEqual({ w: 640, h: 360 });
    // Fixed row count: a 2× drawing buffer keeps the same art grid.
    expect(pixelTargetSize('pixel-fine', 2560, 1440)).toEqual({ w: 640, h: 360 });
  });

  it('never upsamples a small buffer; classic / outline are not pixel styles', () => {
    expect(pixelTargetSize('pixel-fine', 320, 180)).toEqual({ w: 320, h: 180 });
    expect(isPixelStyle('pixel-fine')).toBe(true);
    expect(isPixelStyle('outline')).toBe(false);
  });
});
