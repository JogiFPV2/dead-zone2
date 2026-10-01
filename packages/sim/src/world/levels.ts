import type { StairDir } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import type { TileGrid } from './grid.js';

/**
 * Levels (storeys). `Position.z` is an f32 in levels: integer on a floor, fractional only on
 * stairs (base level + progress along the flight). Everything that compares levels or reads the
 * map uses `floorZ`, so a fractional z never leaks into chunk lookups or `!==` checks.
 *
 * Floor data is the map's `floor` layer (0 = no floor) per chunk level; stairs come from the
 * optional `SimChunk.stairs` (`stairsAt`). The floor data itself, LOS / sound through ceilings,
 * pathfinding between levels and spawning on levels belong to the Symulacja side.
 */

/** Level of a z value (floor index; on stairs the level the flight starts from until the top). */
export const levelOf = (z: number): number => Math.floor(z);

/** Level the entity collides on (`Math.floor(Position.z)`). */
export function floorZ(w: SimWorld, eid: number): number {
  return Math.floor(w.c.Position.z[eid] ?? 0);
}

/** The tile has a floor on level `z` (map `floor` layer ≠ 0). */
export function hasFloor(grid: TileGrid, tx: number, ty: number, z: number): boolean {
  return !grid.isVoid(tx, ty, z);
}

/**
 * A flight of stairs in world tiles: starts at tile (tx, ty) on level `z` and climbs `len` tiles
 * in `dir` to level z + 1. Entrance = the edge of the first tile facing away from `dir`; exit =
 * the far edge of the last tile, onto tile (tx, ty) + len × dir on level z + 1.
 */
export interface Stair {
  readonly id: number;
  readonly tx: number;
  readonly ty: number;
  readonly z: number;
  readonly dir: StairDir;
  readonly len: number;
  /** Unit step of `dir` in tiles. */
  readonly dx: number;
  readonly dy: number;
}

export const STAIR_STEP: Readonly<Record<StairDir, { dx: number; dy: number }>> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

/** The flight covering tile (tx, ty) of level `z` (its base level), if any. */
export function stairsAt(grid: TileGrid, tx: number, ty: number, z: number): Stair | undefined {
  return grid.stairAt(tx, ty, z);
}

/**
 * Position along a flight: `along` 0 at the entrance edge … `len` at the exit edge, `across`
 * 0..1 over its width (left to right when facing `dir`).
 */
export function stairLocal(s: Stair, x: number, y: number): { along: number; across: number } {
  // Corner of the entrance edge: the entrance-side corner of the first tile.
  const ox = s.dx < 0 ? s.tx + 1 : s.tx;
  const oy = s.dy < 0 ? s.ty + 1 : s.ty;
  if (s.dx !== 0) return { along: (x - ox) * s.dx, across: y - s.ty };
  return { along: (y - oy) * s.dy, across: x - s.tx };
}

/** World position of local (along, across) on a flight (inverse of `stairLocal`). */
export function stairWorld(s: Stair, along: number, across: number): { x: number; y: number } {
  const ox = s.dx < 0 ? s.tx + 1 : s.tx;
  const oy = s.dy < 0 ? s.ty + 1 : s.ty;
  if (s.dx !== 0) return { x: ox + along * s.dx, y: s.ty + across };
  return { x: s.tx + across, y: oy + along * s.dy };
}

/** z on a flight at `along` (base level + progress, clamped to the flight). */
export function stairZ(s: Stair, along: number): number {
  const p = along <= 0 ? 0 : along >= s.len ? 1 : along / s.len;
  return Math.fround(s.z + p);
}
