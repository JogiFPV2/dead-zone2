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
}

export const NO_CUTAWAY: Cutaway = { building: NO_BUILDING, tx: 0, ty: 0, side: { sx: 1, sz: 1 } };

/** Key that changes only when the cutaway needs recomputing. */
export const cutawayKey = (c: Cutaway): string =>
  c.building === NO_BUILDING
    ? '-'
    : `${c.building}:${c.tx},${c.ty}:${c.side.sx},${c.side.sz}:${c.z ?? 0}`;

/** Whether an edge of `building` is lowered under cutaway `c`. */
export const isEdgeLowered = (
  c: Cutaway,
  building: BuildingId,
  axis: EdgeAxis,
  ex: number,
  ey: number,
): boolean =>
  c.building !== NO_BUILDING &&
  building === c.building &&
  edgeFacesCamera(axis, ex, ey, c.tx, c.ty, c.side);

/** Whether a roof tile of `building` is hidden under cutaway `c`. */
export const isRoofHidden = (c: Cutaway, building: BuildingId): boolean =>
  c.building !== NO_BUILDING && building === c.building;
