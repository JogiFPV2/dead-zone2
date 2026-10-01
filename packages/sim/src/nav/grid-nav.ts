import type { TileGrid } from '../world/grid.js';
import { EF } from '../openings/state.js';
import { stairStepAllowed } from '../world/levels.js';

/** Passable for navigation: no blocking edge, or a door / window (zombies bash closed ones). */
const navFree = (f: number): boolean => (f & EF.blocksMove) === 0 || (f & EF.opening) !== 0;

/**
 * Orthogonal step from tile (tx, ty) by (dx, 0) or (0, dy): no wall between, target has floor.
 * Doors and windows always count as passable, so the cached masks do not depend on their state.
 */
function orth(grid: TileGrid, z: number, tx: number, ty: number, dx: number, dy: number): boolean {
  if (grid.isVoid(tx + dx, ty + dy, z)) return false;
  if (grid.stairs.length > 0 && !stairStepAllowed(grid, z, tx, ty, dx, dy)) return false;
  if (dx > 0) return navFree(grid.flagsW(tx + 1, ty, z));
  if (dx < 0) return navFree(grid.flagsW(tx, ty, z));
  if (dy > 0) return navFree(grid.flagsN(tx, ty + 1, z));
  return navFree(grid.flagsN(tx, ty, z));
}

/**
 * Tile step for pathfinding (docs 2.5 `nav`): 8 directions, diagonals only when both orthogonal
 * routes around the corner are free (no corner cutting at walls).
 */
function canStepRaw(
  grid: TileGrid,
  z: number,
  tx: number,
  ty: number,
  dx: number,
  dy: number,
): boolean {
  if (dx === 0 || dy === 0) return orth(grid, z, tx, ty, dx, dy);
  return (
    orth(grid, z, tx, ty, dx, 0) &&
    orth(grid, z, tx, ty, 0, dy) &&
    orth(grid, z, tx + dx, ty, 0, dy) &&
    orth(grid, z, tx, ty + dy, dx, 0)
  );
}

/**
 * Cached step masks: per tile a bit per DIRS entry (bit 8 = computed). Walls are static and
 * door / window state does not change navigability (see `orth`). Derived state.
 */
const masks = new WeakMap<TileGrid, Map<number, Uint16Array>>();

function maskOf(grid: TileGrid, z: number, tx: number, ty: number): number {
  let byChunk = masks.get(grid);
  if (!byChunk) {
    byChunk = new Map();
    masks.set(grid, byChunk);
  }
  const key = ((tx >> 5) + 0x800) * 0x1000000 + ((ty >> 5) + 0x800) * 0x1000 + (z + 0x800);
  let m = byChunk.get(key);
  if (!m) {
    m = new Uint16Array(1024);
    byChunk.set(key, m);
  }
  const i = ((ty & 31) << 5) | (tx & 31);
  let v = m[i]!;
  if (v === 0) {
    v = 0x100;
    for (let d = 0; d < 8; d++) {
      const dir = DIRS[d]!;
      if (canStepRaw(grid, z, tx, ty, dir[0], dir[1])) v |= 1 << d;
    }
    m[i] = v;
  }
  return v;
}

/** Bit index in the step mask for a unit direction. */
const dirBit = (dx: number, dy: number): number => DIR_INDEX[(dy + 1) * 3 + (dx + 1)]!;

export function canStep(
  grid: TileGrid,
  z: number,
  tx: number,
  ty: number,
  dx: number,
  dy: number,
): boolean {
  return (maskOf(grid, z, tx, ty) & (1 << dirBit(dx, dy))) !== 0;
}

/** Step mask of a tile (bit d = DIRS[d] passable). */
export const stepMask = (grid: TileGrid, z: number, tx: number, ty: number): number =>
  maskOf(grid, z, tx, ty);

/** Neighbour order (fixed, part of determinism): N, E, S, W, NE, SE, SW, NW. */
export const DIRS: readonly (readonly [number, number, number])[] = [
  [0, -1, 10],
  [1, 0, 10],
  [0, 1, 10],
  [-1, 0, 10],
  [1, -1, 14],
  [1, 1, 14],
  [-1, 1, 14],
  [-1, -1, 14],
];

/** (dy + 1) * 3 + (dx + 1) → index in DIRS. */
const DIR_INDEX: readonly number[] = [7, 0, 4, 3, -1, 1, 6, 2, 5];
