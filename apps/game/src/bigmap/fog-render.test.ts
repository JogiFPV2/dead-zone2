import { describe, expect, it } from 'vitest';
import { FOG_CHUNK_M, fogGrid, setDiscovered } from './bigmap-model.js';
import { discoveryAt, fogPixel, renderFog, smoothstep } from './fog-render.js';

describe('fog render', () => {
  it('smoothstep', () => {
    expect(smoothstep(0.35, 0.75, 0)).toBe(0);
    expect(smoothstep(0.35, 0.75, 1)).toBe(1);
    expect(smoothstep(0.35, 0.75, 0.55)).toBeCloseTo(0.5);
  });

  it('discovery is bilinear between chunk centres (world chunks, grid from bounds)', () => {
    const fog = fogGrid({ cx0: 5, cy0: 5, cx1: 20, cy1: 20 });
    setDiscovered(fog, 10, 10);
    const cx = 10.5 * FOG_CHUNK_M;
    expect(discoveryAt(fog, cx, cx)).toBeCloseTo(1);
    expect(discoveryAt(fog, cx + FOG_CHUNK_M / 2, cx)).toBeCloseTo(0.5);
    expect(discoveryAt(fog, cx + FOG_CHUNK_M, cx)).toBeCloseTo(0);
  });

  it('matches the mockup: #5C5344 in the centre, −35 % · r² vignette, 18 % burnt edge', () => {
    const px = new Uint8ClampedArray(4);
    fogPixel(0, 0, 0, px, 0);
    expect([...px]).toEqual([92, 83, 68, 255]);
    fogPixel(0, 0.5, 0, px, 0); // screen corner
    expect(px[0]).toBe(Math.round(92 * 0.825));
    fogPixel(1, 0, 0, px, 0); // discovered: transparent
    expect(px[3]).toBe(0);
    // Edge (v = ½): paper · ½ · 0.82 + fog · ½ · 0.82 → alpha 1 − 0.41.
    fogPixel(0.5, 0, 0, px, 0);
    expect(px[3]).toBe(Math.round((1 - 0.5 * 0.82) * 255));
    const over = (paper: number) => (px[0]! * px[3]!) / 255 + paper * (1 - px[3]! / 255);
    expect(over(200)).toBeCloseTo((200 * 0.5 + 92 * 0.5) * 0.82, 0);
  });

  it('undiscovered world is fogged paper, not black', () => {
    const fog = fogGrid({ cx0: 0, cy0: 0, cx1: 7, cy1: 7 });
    const { data, width, height } = renderFog(
      fog,
      { center: { x: 128, y: 128 }, zoom: 1 },
      { width: 64, height: 36 },
    );
    const mid = ((height >> 1) * width + (width >> 1)) * 4;
    expect(data[mid + 3]).toBe(255);
    expect(data[mid]).toBeGreaterThan(80);
  });
});
