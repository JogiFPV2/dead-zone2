import { CHUNK_SIZE } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { rectDist2, type TileRect } from '../world/furniture.js';
import { floorZ } from '../world/levels.js';

/**
 * Reach to furniture with a footprint (docs 9.49). With `worldSettings.furnitureFootprint` off
 * every rectangle is the 1×1 anchor tile, so all checks are exactly the old "distance to the
 * tile centre ≤ 1.5" ones.
 */

/** Reach radius in tiles (docs 2.4; `INTERACT_RANGE_TILES`). */
export const FURNITURE_REACH_TILES = 1.5;

/** Occupied rectangle of map object `contentId` (rotation `rot`) anchored at world tile (x, y). */
export function objectRect(
  w: SimWorld,
  x: number,
  y: number,
  contentId: string,
  rot: number | undefined,
): TileRect {
  if (!w.furniture) return { x, y, w: 1, h: 1 };
  const s = w.furniture.sizeOf(contentId, rot);
  return { x, y, w: s.w, h: s.h, longSide: s.longSide };
}

/**
 * Rectangle of the furniture anchored at world tile (x, y, z): the first map object on that tile
 * that is furniture (one storage per piece: compartments share it); 1×1 without one.
 */
export function anchorRect(w: SimWorld, x: number, y: number, z: number): TileRect {
  const f = w.furniture;
  if (!f) return { x, y, w: 1, h: 1 };
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  for (const o of w.map.getChunk(cx, cy, z)?.objects ?? []) {
    if (cx * CHUNK_SIZE + o.x !== x || cy * CHUNK_SIZE + o.y !== y) continue;
    if (!f.resolve(o.contentId)) continue;
    const s = f.sizeOf(o.contentId, o.rot);
    return { x, y, w: s.w, h: s.h, longSide: s.longSide };
  }
  return { x, y, w: 1, h: 1 };
}

/** Squared distance from the player to the nearest occupied tile centre of `r`. */
export function rectDist2To(w: SimWorld, eid: number, r: TileRect): number {
  return rectDist2(r, w.c.Position.x[eid] ?? 0, w.c.Position.y[eid] ?? 0);
}

/** The player can reach furniture `r` on level z (from any tile next to it, also diagonally). */
export function rectInReach(w: SimWorld, eid: number, r: TileRect, z: number): boolean {
  if (floorZ(w, eid) !== z) return false;
  return rectDist2To(w, eid, r) <= FURNITURE_REACH_TILES * FURNITURE_REACH_TILES;
}
