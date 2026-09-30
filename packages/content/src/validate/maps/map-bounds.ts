import { CHUNK_SIZE } from '../../schemas/map/constants.js';
import type { MapManifest } from '../../schemas/map/manifest.js';
import type { ZoneRect } from '../../schemas/map/zone.js';

/** Granice piętra w globalnych kaflach: `[x0, x1) × [y0, y1)`. */
export interface TileBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Granice piętra `z`: prostokąt obejmujący wszystkie chunki manifestu na tym piętrze
 * (`cx * 32 … (cx + 1) * 32`). `undefined`, gdy piętro nie ma chunków.
 */
export function floorBounds(manifest: MapManifest, z: number): TileBounds | undefined {
  const cs = manifest.chunks.filter((c) => c.z === z);
  if (cs.length === 0) return undefined;
  const xs = cs.map((c) => c.cx);
  const ys = cs.map((c) => c.cy);
  return {
    x0: Math.min(...xs) * CHUNK_SIZE,
    y0: Math.min(...ys) * CHUNK_SIZE,
    x1: (Math.max(...xs) + 1) * CHUNK_SIZE,
    y1: (Math.max(...ys) + 1) * CHUNK_SIZE,
  };
}

export const rectInside = (r: ZoneRect, b: TileBounds): boolean =>
  r.x >= b.x0 && r.y >= b.y0 && r.x + r.w <= b.x1 && r.y + r.h <= b.y1;
