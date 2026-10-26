import type { SimWorld } from '../core/world.js';
import { objectFurnitureId } from '../furniture/menu.js';
import {
  furniturePiece,
  furnitureStrengthKg,
  furnitureWeightKg,
  isFixedFurniture,
} from '../physics/furniture.js';
import { floorZ } from '../world/levels.js';
import { unpackKey } from './state.js';

/**
 * Furniture standing right in front of a window (docs 9.75): a piece whose footprint covers the
 * tile on either side of the edge. The window climb is refused with `blocked-by-furniture`; the
 * menu offers "Przesuń mebel" (`pushFurniture` / `pullFurniture` with `furnitureId`) when
 * `canMove`. Fixtures (`furnitureFixed`) and pieces heavier than the player's push strength stay.
 */
export interface WindowBlocker {
  /** `useFurniture` / `pushFurniture` id of the piece. */
  furnitureId: number;
  contentId: string;
  /** Side of the window relative to the player (`near` = the player's tile side). */
  side: 'near' | 'far';
  /** Not a fixture and not heavier than the player's push strength. */
  canMove: boolean;
  /** Why it cannot be moved. */
  reason?: 'fixed' | 'too-heavy';
  weightKg: number;
  strengthKg: number;
}

/** Furniture pieces (map or moved) covering tile (tx, ty, z). */
function pieceCovering(w: SimWorld, tx: number, ty: number, z: number) {
  if (!w.furniture || (w.furniture.flags(tx, ty, z) & 1) === 0) return undefined;
  // Footprints reach at most 3 tiles past the anchor (north-west tile).
  for (let ay = ty; ay >= ty - 3; ay--)
    for (let ax = tx; ax >= tx - 3; ax--)
      for (let n = 0; n < 8; n++) {
        const id = objectFurnitureId(ax, ay, z, n);
        const p = furniturePiece(w, id);
        if (!p) continue;
        const r = p.rect;
        if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return { id, p };
      }
  return undefined;
}

/** The piece blocking window edge `key` (near side first), undefined when it is clear. */
export function windowBlocker(w: SimWorld, eid: number, key: number): WindowBlocker | undefined {
  const { side, tx, ty, z } = unpackKey(key);
  const low = side === 'n' ? { x: tx, y: ty - 1 } : { x: tx - 1, y: ty };
  const high = { x: tx, y: ty };
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const playerLow = side === 'n' ? py < ty : px < tx;
  const zz = Number.isFinite(z) ? z : floorZ(w, eid);
  const tiles = playerLow
    ? ([
        [low, 'near'],
        [high, 'far'],
      ] as const)
    : ([
        [high, 'near'],
        [low, 'far'],
      ] as const);
  for (const [t, where] of tiles) {
    const hit = pieceCovering(w, t.x, t.y, zz);
    if (!hit) continue;
    const fixed = isFixedFurniture(w, hit.p.contentId);
    const weightKg = furnitureWeightKg(w, hit.p);
    const strengthKg = furnitureStrengthKg(w, eid, 'push');
    const reason = fixed ? 'fixed' : weightKg > strengthKg ? 'too-heavy' : undefined;
    return {
      furnitureId: hit.id,
      contentId: hit.p.contentId,
      side: where,
      canMove: reason === undefined,
      ...(reason ? { reason } : {}),
      weightKg,
      strengthKg,
    };
  }
  return undefined;
}
