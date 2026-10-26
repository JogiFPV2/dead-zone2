import type { TileGrid } from './grid.js';
import { EF } from '../openings/state.js';
import { stairStepAllowed } from './levels.js';

/**
 * Grid ray casts over tile edges (Amanatides–Woo DDA from (x0, y0) to (x1, y1) on level z).
 * Crossing the vertical line x = k between tiles k−1 and k at row ty crosses `edgeW(k, ty)`,
 * crossing y = k crosses `edgeN(tx, k)`. When the ray passes exactly through a corner both
 * orders (x then y, y then x) are checked.
 *
 * - `sight`: walls, closed doors and barricades block; windows and open doors do not; void tiles
 *   do not (holes, outside). With the furniture footprint flag, entering a tile of tall furniture
 *   (`worldSettings.furnitureTall`) blocks too.
 * - `sound`: returns the number of muffling edges crossed (walls, closed doors / windows),
 *   capped at `cap`; open doors and broken windows do not count.
 * - Exact walls (`SimChunk.wallSegments`) also block `sight` and `walk` (`crossesSegment`).
 * - `melee`: a blow from body to body (zombie attacks): any edge that blocks movement or sight
 *   blocks (walls, closed doors, windows in any state incl. open / broken, fences, barricades),
 *   also through a corner in either order; tiles do not. Open doorways let it through.
 * - `walk`: an edge blocking movement, a void tile, a furniture tile (footprint flag) or stepping onto / off a flight of stairs
 *   other than along it through the entrance blocks (straight-line walkability for AI).
 */

const Mode = { Sight: 0, Sound: 1, Walk: 2, Melee: 3, Reach: 4 } as const;
type Mode = (typeof Mode)[keyof typeof Mode];

let crossed = 0;

function edgeBlocks(f: number, mode: Mode): boolean {
  // Melee: open / broken windows are `slow` (climb through), so they block a blow too.
  if (mode === Mode.Melee) return (f & (EF.blocksSight | EF.blocksMove | EF.slow)) !== 0;
  // Reach (looting, docs 9.69): an open / broken window lets the hand through (PZ).
  if (mode === Mode.Reach) return (f & (EF.blocksSight | EF.blocksMove)) !== 0;
  // A window cover (docs 9.78) hides the view only: reach, blows, movement and sound pass.
  if (mode === Mode.Sight) return (f & (EF.blocksSight | EF.covered)) !== 0;
  return (f & EF.blocksMove) !== 0;
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
  if (mode === Mode.Melee || mode === Mode.Reach) return false;
  if (mode !== Mode.Walk) return grid.blocksSightTile(tx + sx, ty + sy, z);
  if (grid.isBlocked(tx + sx, ty + sy, z)) return true;
  // Flights of stairs: only along them through the entrance (physics blocks the sides).
  return grid.stairs.length > 0 && !stairStepAllowed(grid, z, tx, ty, sx, sy);
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
        if (mode === Mode.Walk || mode === Mode.Melee || mode === Mode.Reach ? a || b : a && b)
          return false;
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
): boolean =>
  trace(grid, z, x0, y0, x1, y1, Mode.Sight, 0) && !crossesSegment(grid, z, x0, y0, x1, y1);

/** Straight line without any edge or void tile (AI can steer directly). */
export const walkableLine = (
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean =>
  trace(grid, z, x0, y0, x1, y1, Mode.Walk, 0) && !crossesSegment(grid, z, x0, y0, x1, y1);

/** A melee blow can land along this line (no wall, window, closed door or exact wall). */
export const meleeLine = (
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean =>
  trace(grid, z, x0, y0, x1, y1, Mode.Melee, 0) && !crossesSegment(grid, z, x0, y0, x1, y1);

/**
 * A hand can reach along this line (looting, docs 9.69): like `meleeLine`, but open / broken
 * windows do not block; walls, closed windows / doors, fences, planks, corners, exact walls do.
 */
export const reachLine = (
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean =>
  trace(grid, z, x0, y0, x1, y1, Mode.Reach, 0) && !crossesSegment(grid, z, x0, y0, x1, y1);

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/**
 * The line crosses or touches an exact wall (`SimChunk.wallSegments`, docs 9.63). Openings are
 * gaps in the segments, so windows and doorways stay to the tile edges; sound stays on tiles.
 * Skipped until a chunk with segments was read (the trace reads every chunk on the line).
 */
function crossesSegment(
  grid: TileGrid,
  z: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  if (!grid.segmentsSeen) return false;
  let hit = false;
  grid.forSegments(
    Math.min(x0, x1),
    Math.min(y0, y1),
    Math.max(x0, x1),
    Math.max(y0, y1),
    z,
    (_k, ax, ay, bx, by) => {
      if (hit) return;
      const d1 = orient(x0, y0, x1, y1, ax, ay);
      const d2 = orient(x0, y0, x1, y1, bx, by);
      if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return;
      const d3 = orient(ax, ay, bx, by, x0, y0);
      const d4 = orient(ax, ay, bx, by, x1, y1);
      if ((d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0)) return;
      // Collinear and apart: the bounding boxes already overlap, so only degenerate cases remain.
      if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
        const t = (px: number, py: number) => (Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? px : py);
        const lo = Math.min(t(x0, y0), t(x1, y1));
        const hi = Math.max(t(x0, y0), t(x1, y1));
        if (Math.max(t(ax, ay), t(bx, by)) < lo || Math.min(t(ax, ay), t(bx, by)) > hi) return;
      }
      hit = true;
    },
  );
  return hit;
}

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
