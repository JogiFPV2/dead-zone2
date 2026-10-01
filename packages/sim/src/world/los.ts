import type { TileGrid } from './grid.js';
import { EF } from '../openings/state.js';

/**
 * Grid ray casts over tile edges (Amanatides–Woo DDA from (x0, y0) to (x1, y1) on level z).
 * Crossing the vertical line x = k between tiles k−1 and k at row ty crosses `edgeW(k, ty)`,
 * crossing y = k crosses `edgeN(tx, k)`. When the ray passes exactly through a corner both
 * orders (x then y, y then x) are checked.
 *
 * - `sight`: walls, closed doors and barricades block; windows and open doors do not; void tiles
 *   do not (holes, outside).
 * - `sound`: returns the number of muffling edges crossed (walls, closed doors / windows),
 *   capped at `cap`; open doors and broken windows do not count.
 * - `walk`: an edge blocking movement or a void tile blocks (straight-line walkability for AI).
 */

const Mode = { Sight: 0, Sound: 1, Walk: 2 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];

let crossed = 0;

function edgeBlocks(f: number, mode: Mode): boolean {
  return (f & (mode === Mode.Sight ? EF.blocksSight : EF.blocksMove)) !== 0;
}

/** Flags of the edge crossed when stepping from tile (tx, ty) by (sx, 0) or (0, sy). */
function stepEdge(
  grid: TileGrid,
  z: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
): number {
  if (sx > 0) return grid.flagsW(tx + 1, ty, z);
  if (sx < 0) return grid.flagsW(tx, ty, z);
  if (sy > 0) return grid.flagsN(tx, ty + 1, z);
  return grid.flagsN(tx, ty, z);
}

/** One step; returns true when blocked (walk / sight). Counts edges for sound. */
function step(
  grid: TileGrid,
  z: number,
  tx: number,
  ty: number,
  sx: number,
  sy: number,
  mode: Mode,
): boolean {
  const f = stepEdge(grid, z, tx, ty, sx, sy);
  if (mode === Mode.Sound) {
    if (f & EF.muffles) crossed++;
    return false;
  }
  if (edgeBlocks(f, mode)) return true;
  return mode === Mode.Walk && grid.isVoid(tx + sx, ty + sy, z);
}

function trace(
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  mode: Mode,
  cap: number,
): boolean {
  crossed = 0;
  let tx = Math.floor(x0);
  let ty = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  if (mode === Mode.Walk && grid.isVoid(tx, ty, z)) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const tdx = sx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = sy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = sx > 0 ? (tx + 1 - x0) * tdx : sx < 0 ? (x0 - tx) * tdx : Infinity;
  let tmy = sy > 0 ? (ty + 1 - y0) * tdy : sy < 0 ? (y0 - ty) * tdy : Infinity;
  let n = Math.abs(ex - tx) + Math.abs(ey - ty);
  while (n > 0) {
    if (tmx < tmy) {
      if (step(grid, z, tx, ty, sx, 0, mode)) return false;
      tx += sx;
      tmx += tdx;
      n--;
    } else if (tmy < tmx) {
      if (step(grid, z, tx, ty, 0, sy, mode)) return false;
      ty += sy;
      tmy += tdy;
      n--;
    } else {
      // Exactly through a corner: both orders.
      if (mode === Mode.Sound) {
        const before = crossed;
        step(grid, z, tx, ty, sx, 0, mode);
        step(grid, z, tx + sx, ty, 0, sy, mode);
        const a = crossed - before;
        crossed = before;
        step(grid, z, tx, ty, 0, sy, mode);
        step(grid, z, tx, ty + sy, sx, 0, mode);
        const b = crossed - before;
        crossed = before + Math.min(a, b);
      } else {
        const a = step(grid, z, tx, ty, sx, 0, mode) || step(grid, z, tx + sx, ty, 0, sy, mode);
        const b = step(grid, z, tx, ty, 0, sy, mode) || step(grid, z, tx, ty + sy, sx, 0, mode);
        if (mode === Mode.Walk ? a || b : a && b) return false;
      }
      tx += sx;
      ty += sy;
      tmx += tdx;
      tmy += tdy;
      n -= 2;
    }
    if (mode === Mode.Sound && crossed >= cap) return true;
  }
  return true;
}

/** Line of sight between two points on level z (walls block, windows do not). */
export const lineOfSight = (
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean => trace(grid, z, x0, y0, x1, y1, Mode.Sight, 0);

/** Straight line without any edge or void tile (AI can steer directly). */
export const walkableLine = (
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean => trace(grid, z, x0, y0, x1, y1, Mode.Walk, 0);

/** Walls and windows between two points (sound damping), at most `cap`. */
export function edgesBetween(
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cap: number,
): number {
  trace(grid, z, x0, y0, x1, y1, Mode.Sound, cap);
  return Math.min(crossed, cap);
}
