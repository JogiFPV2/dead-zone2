import {
  FOG_CHUNK_M,
  gridBounds,
  isDiscovered,
  screenToWorld,
  type FogGrid,
  type View,
  type Viewport,
} from './bigmap-model.js';

/** Paper noise 0..1 (value noise over a hashed lattice, period 64). */
const lattice = (() => {
  const t = new Float32Array(64 * 64);
  let s = 1234567;
  for (let i = 0; i < t.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    t[i] = s / 4294967295;
  }
  return t;
})();

export function paperNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const at = (a: number, b: number) => lattice[(b & 63) * 64 + (a & 63)]!;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
  const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
  return top + (bot - top) * sy;
}

export const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Discovery 0..1 at a world point: the bitmap sampled bilinearly between chunk centres. */
export function discoveryAt(fog: FogGrid, x: number, y: number): number {
  const gx = x / FOG_CHUNK_M - 0.5;
  const gy = y / FOG_CHUNK_M - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const d = (cx: number, cy: number) => (isDiscovered(fog, cx, cy) ? 1 : 0);
  const top = d(x0, y0) * (1 - fx) + d(x0 + 1, y0) * fx;
  const bot = d(x0, y0 + 1) * (1 - fx) + d(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Fogged paper base colour (`#5C5344`, spec §11 / mockup generator). */
const FOG_RGB = [92, 83, 68] as const;

/**
 * One fog pixel as a source-over RGBA over the paper map, matching the approved mockup
 * (`dz-html/bigmap/gen_bigmap_base.py`): `out = paper · v + fog · (1 − v)`, then the whole
 * pixel darkened by 18 % on the edge (`edge = (1 − |v − ½| · 2)²`). Fog = `#5C5344` with a
 * soft quadratic vignette (−35 % · r², ≈ `#3E382E`… at the corners) and a little grain.
 * Exact as alpha compositing: A = 1 − v(1 − k), C = fog · (1 − v)(1 − k) / A.
 */
export function fogPixel(
  v: number,
  vg: number,
  grain: number,
  out: Uint8ClampedArray,
  i: number,
): void {
  const edge = Math.max(0, 1 - Math.abs(v - 0.5) * 2) ** 2;
  const keep = 1 - 0.18 * edge;
  const a = 1 - v * keep;
  const shade = 1 - 0.35 * vg;
  const f = a > 1e-6 ? ((1 - v) * keep) / a : 0;
  out[i] = (FOG_RGB[0] * shade + grain) * f;
  out[i + 1] = (FOG_RGB[1] * shade + grain) * f;
  out[i + 2] = (FOG_RGB[2] * shade + grain * 0.8) * f;
  out[i + 3] = a * 255;
}

/**
 * Fog overlay (spec §11): linear mask + paper noise → smoothstep(0.35, 0.75) for a soft, torn
 * edge (never 32 m steps); undiscovered = dark paper with a vignette and grain; the edge itself
 * is darkened 18 % („burnt paper”). Rendered at `1 / down` resolution.
 */
export function renderFog(
  fog: FogGrid,
  view: View,
  vp: Viewport,
  down = 2,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const width = Math.ceil(vp.width / down);
  const height = Math.ceil(vp.height / down);
  const data = new Uint8ClampedArray(width * height * 4);
  const any = fog.bits.some((b) => b !== 0);
  const b = gridBounds(fog);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const sx = px * down;
      const sy = py * down;
      const w = screenToWorld(view, vp, sx, sy);
      const inGrid = w.x >= b.x0 && w.y >= b.y0 && w.x < b.x1 && w.y < b.y1;
      const mask = any && inGrid ? discoveryAt(fog, w.x, w.y) : 0;
      // Noise in screen space (paper texture ~1/6 of the screen) plus a finer grain.
      const n =
        paperNoise(sx / (vp.width / 6), sy / (vp.width / 6)) * 0.7 +
        paperNoise(sx / 18, sy / 18) * 0.3;
      const v = smoothstep(0.35, 0.75, mask + (n - 0.5) * 0.55);
      const dx = sx / vp.width - 0.5;
      const dy = sy / vp.height - 0.5;
      const grain =
        (paperNoise(sx / 6, sy / 6) - 0.5) * 12 + (paperNoise(sx / 2.5, sy / 2.5) - 0.5) * 8;
      fogPixel(v, dx * dx + dy * dy, grain, data, (py * width + px) * 4);
    }
  }
  return { data, width, height };
}
