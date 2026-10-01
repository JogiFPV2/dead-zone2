import type { ChunkRange, ChunkSource } from '../world/chunk.js';
import { CHUNK_SIZE } from '../world/chunk.js';
import type { HudContentIndex } from './content-index.js';
import type { SleepSurface } from './sleep-settings.js';

/** A map object at a world tile (chunk `objects`), by content id. */
export interface MapObjectAt {
  contentId: string;
  tx: number;
  ty: number;
  z: number;
}

/** Furniture to sleep on or a TV, at a world tile. */
export interface LeisureSpot {
  kind: 'bed' | 'sofa' | 'tv';
  tx: number;
  ty: number;
  z: number;
}

/** Sleep / TV furniture within this many tiles (`sleep` uses 1.5, `leisure.tvRadiusTiles`). */
export const SPOT_RADIUS_TILES = 1.5;

/** Static map objects of the loaded range (one pass at load; the list never changes). */
export function mapObjectsOf(source: ChunkSource, range: ChunkRange): MapObjectAt[] {
  const out: MapObjectAt[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      for (const o of source.getChunk(cx, cy, range.z)?.objects ?? []) {
        out.push({
          contentId: o.contentId,
          tx: cx * CHUNK_SIZE + o.x,
          ty: cy * CHUNK_SIZE + o.y,
          z: range.z,
        });
      }
    }
  }
  return out;
}

/** Beds, sofas and TVs among the map objects (content decides which ids are which). */
export function leisureSpots(
  objects: readonly MapObjectAt[],
  content: HudContentIndex,
): LeisureSpot[] {
  const out: LeisureSpot[] = [];
  for (const o of objects) {
    const def = content.items.get(o.contentId);
    const kind = def?.sleepSurface ?? (def?.tv ? 'tv' : undefined);
    if (kind) out.push({ kind, tx: o.tx, ty: o.ty, z: o.z });
  }
  return out;
}

const within = (s: LeisureSpot, px: number, py: number, r: number): boolean =>
  Math.hypot(s.tx + 0.5 - px, s.ty + 0.5 - py) <= r;

/** Where sleeping here would happen (sim rule: bed > sofa within 1.5 tiles, else the floor). */
export function sleepSurfaceAt(
  spots: readonly LeisureSpot[],
  px: number,
  py: number,
  r = SPOT_RADIUS_TILES,
): SleepSurface {
  let best: SleepSurface = 'floor';
  for (const s of spots) {
    if (s.kind === 'tv' || !within(s, px, py, r)) continue;
    if (s.kind === 'bed') return 'bed';
    best = 'sofa';
  }
  return best;
}

/** A TV within reach (the sim checks power; `no-power` comes back as a rejection). */
export const tvNearby = (
  spots: readonly LeisureSpot[],
  px: number,
  py: number,
  r = SPOT_RADIUS_TILES,
): boolean => spots.some((s) => s.kind === 'tv' && within(s, px, py, r));
