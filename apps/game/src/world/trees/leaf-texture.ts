import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
} from 'three';
import { spotHash } from './species.js';

/**
 * Leaf-cluster card texture (procedural, no asset): ~40 elliptic leaves on a transparent
 * background, light-grey shading (tinted per species by the instance colour). Alpha cut by
 * `alphaTest` (no sorting), mipmapped so far leaves fill in instead of shimmering.
 */
export function leafClusterPixels(size = 128): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const leaves = 46;
  for (let i = 0; i < leaves; i++) {
    const cx = 0.12 + 0.76 * spotHash(i, 1, 7);
    const cy = 0.12 + 0.76 * spotHash(i, 2, 7);
    const ang = Math.PI * 2 * spotHash(i, 3, 7);
    const len = 0.07 + 0.05 * spotHash(i, 4, 7);
    const wid = len * 0.45;
    const shade = 150 + Math.floor(105 * spotHash(i, 5, 7));
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const r = Math.ceil(len * size);
    const x0 = Math.floor(cx * size);
    const y0 = Math.floor(cy * size);
    for (let y = Math.max(0, y0 - r); y < Math.min(size, y0 + r); y++)
      for (let x = Math.max(0, x0 - r); x < Math.min(size, x0 + r); x++) {
        const dx = x / size - cx;
        const dy = y / size - cy;
        const u = (dx * ca + dy * sa) / len;
        const v = (-dx * sa + dy * ca) / wid;
        if (u * u + v * v > 1) continue;
        const o = (y * size + x) * 4;
        // Midrib a bit darker; one side of the leaf lit.
        const s = Math.min(255, shade + (v > 0 ? 18 : -10) - (Math.abs(v) < 0.12 ? 25 : 0));
        px[o] = px[o + 1] = px[o + 2] = Math.max(0, s);
        px[o + 3] = 255;
      }
  }
  return px;
}

export function leafClusterTexture(size = 128): DataTexture {
  const t = new DataTexture(leafClusterPixels(size), size, size, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}
