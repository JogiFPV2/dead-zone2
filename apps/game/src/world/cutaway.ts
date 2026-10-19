import { NO_BUILDING, type BuildingId } from './chunk.js';
import type { EdgeAxis } from './building-lookup.js';

/** Horizontal side the camera sits on: sx = sign of world X offset, sz = sign of world Z offset. */
export interface CameraSide {
  sx: 1 | -1;
  sz: 1 | -1;
}

/**
 * Camera side for a yaw (camera offset = (sin yaw, cos yaw) in XZ, see isometricOffset).
 * Views are always diagonal (ISO_YAW + k·90°), so neither component is ever zero.
 */
export const cameraSide = (yaw: number): CameraSide => ({
  sx: Math.sin(yaw) >= 0 ? 1 : -1,
  sz: Math.cos(yaw) >= 0 ? 1 : -1,
});

/**
 * Whether an edge lies between the player's tile (tx, ty) and the camera, i.e. may hide the
 * player. N edge of tile (x, y) is the line Z = y; W edge is the line X = x.
 * Camera on +Z: N lines south of the player's tile (y > ty). Camera on -Z: y <= ty. Same for X.
 */
export function edgeFacesCamera(
  axis: EdgeAxis,
  ex: number,
  ey: number,
  tx: number,
  ty: number,
  side: CameraSide,
): boolean {
  if (axis === 'N') return side.sz > 0 ? ey > ty : ey <= ty;
  return side.sx > 0 ? ex > tx : ex <= tx;
}

/** Cutaway state derived from the player; `building` = NO_BUILDING means no cutaway. */
export interface Cutaway {
  building: BuildingId;
  tx: number;
  ty: number;
  side: CameraSide;
  /** Player's floor (floor(Position.z)); levels above it are hidden in `building`. Default 0. */
  z?: number;
  /**
   * Other buildings crossing the line between the camera and the player (`occludersOf`): cut
   * down to the player's floor (levels above hidden, walls on it lowered, roof hidden).
   */
  occluders?: ReadonlySet<BuildingId>;
}

export const NO_CUTAWAY: Cutaway = { building: NO_BUILDING, tx: 0, ty: 0, side: { sx: 1, sz: 1 } };

/** Whether `building` is an occluder of `c`. */
export const isOccluder = (c: Cutaway, building: BuildingId): boolean =>
  building !== NO_BUILDING && building !== c.building && (c.occluders?.has(building) ?? false);

const occluderKey = (c: Cutaway): string =>
  c.occluders && c.occluders.size > 0 ? [...c.occluders].sort((a, b) => a - b).join(',') : '';

/** Key that changes only when the cutaway needs recomputing. */
export const cutawayKey = (c: Cutaway): string => {
  const occ = occluderKey(c);
  if (c.building === NO_BUILDING && occ === '') return '-';
  return `${c.building}:${c.tx},${c.ty}:${c.side.sx},${c.side.sz}:${c.z ?? 0}:${occ}`;
};

/**
 * Tiles around the player where camera-facing walls of any building are lowered too: a wall
 * shared with a neighbour is owned by the tile on its far side (`BuildingLookup.edge`), so in a
 * row of narrow buildings the player's own front wall may belong to the next building.
 */
export const CUT_NEAR = 3;

/** Whether edge (axis, ex, ey) lies within CUT_NEAR tiles of the player's tile. */
export const nearPlayer = (c: Cutaway, ex: number, ey: number): boolean =>
  ex >= c.tx - CUT_NEAR &&
  ex <= c.tx + CUT_NEAR + 1 &&
  ey >= c.ty - CUT_NEAR &&
  ey <= c.ty + CUT_NEAR + 1;

/** Whether an edge of `building` is lowered under cutaway `c`. */
export const isEdgeLowered = (
  c: Cutaway,
  building: BuildingId,
  axis: EdgeAxis,
  ex: number,
  ey: number,
): boolean =>
  building !== NO_BUILDING &&
  (isOccluder(c, building) ||
    (c.building !== NO_BUILDING &&
      (building === c.building || nearPlayer(c, ex, ey)) &&
      edgeFacesCamera(axis, ex, ey, c.tx, c.ty, c.side)));

/** Whether a roof tile of `building` is hidden under cutaway `c`. */
export const isRoofHidden = (c: Cutaway, building: BuildingId): boolean =>
  building !== NO_BUILDING && (building === c.building || isOccluder(c, building));

/** Whether level `z` of `building` is hidden (above the player's floor, own building or occluder). */
export const isLevelHidden = (c: Cutaway, building: BuildingId, z: number): boolean =>
  building !== NO_BUILDING &&
  z > (c.z ?? 0) &&
  (building === c.building || isOccluder(c, building));

/** Building at a tile and level (`BuildingLookup.at`). */
export type BuildingAt = (tx: number, ty: number, z: number) => BuildingId;

/** Storey height (m) and camera pitch, mirrored from instances.ts / isometric.ts (pure module). */
const STOREY_M = 3;
const RISE = Math.tan(Math.atan(1 / Math.SQRT2));
/** Highest level the ray climbs to (blueprint floors go up to z = 15). */
const TOP_LEVEL = 15;
/** Sample heights above the player's floor (feet, waist, head) and lateral offsets (body width). */
const RAY_HEIGHTS = [0.3, 1.0, 1.8];
const RAY_SIDE = [-0.6, 0, 0.6];
const RAY_STEP = 0.5;

/**
 * Buildings crossing the camera–player line: rays from the player's body toward the camera
 * (horizontal direction (sin yaw, cos yaw) in sim x / y, rising by tan(ISO_PITCH) per metre),
 * sampled every half tile until they clear the highest level. A sample inside a building's
 * level (`at(x, y, level)`) makes that building an occluder. The player's own building is not one.
 */
export function occludersOf(
  at: BuildingAt,
  px: number,
  py: number,
  z: number,
  yaw: number,
  own: BuildingId = NO_BUILDING,
): Set<BuildingId> {
  const out = new Set<BuildingId>();
  const dx = Math.sin(yaw);
  const dy = Math.cos(yaw);
  const base = z * STOREY_M;
  for (const h0 of RAY_HEIGHTS) {
    const dMax = ((TOP_LEVEL + 1) * STOREY_M - base - h0) / RISE;
    for (const off of RAY_SIDE) {
      const sx = px - dy * off;
      const sy = py + dx * off;
      let lastKey = NaN;
      for (let d = RAY_STEP; d <= dMax; d += RAY_STEP) {
        const tx = Math.floor(sx + dx * d);
        const ty = Math.floor(sy + dy * d);
        const lv = Math.floor((base + h0 + d * RISE) / STOREY_M);
        const key = (tx * 4096 + ty) * 32 + lv;
        if (key === lastKey) continue;
        lastKey = key;
        const b = at(tx, ty, lv);
        if (b !== NO_BUILDING && b !== own) out.add(b);
      }
    }
  }
  return out;
}
