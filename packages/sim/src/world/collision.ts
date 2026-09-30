import type { TileGrid } from './grid.js';

/**
 * Circle vs tile grid, resolved per axis (x first, then y → sliding along walls).
 *
 * Obstacles are axis-aligned rectangles: void tiles ([tx, tx+1] × [ty, ty+1]) and wall edges
 * (degenerate rectangles: north edge [tx, tx+1] × {ty}, west edge {tx} × [ty, ty+1]).
 * For a move along one axis, the circle overlaps a rectangle exactly while its centre is inside
 * the interval [lo − h, hi + h] on that axis, where h = sqrt(r² − d²) and d is the distance from
 * the centre to the rectangle on the other axis. We clamp the move to the first such interval on
 * the swept path, which is exact for any speed, so fast movement never tunnels through walls.
 *
 * The circle stops `SKIN` before contact, so after a stop it is strictly outside every obstacle
 * even after f32 rounding; this also stops it from snagging on joints of a straight wall.
 * An obstacle the circle already overlaps (bad spawn) is ignored so the entity can walk out.
 */
export const SKIN = 1 / 1024;

function sweep(
  grid: TileGrid,
  z: number,
  axis: 0 | 1,
  along: number,
  across: number,
  d: number,
  r: number,
): number {
  if (d === 0) return along;
  let target = along + d;
  const lo = Math.min(along, target) - r;
  const hi = Math.max(along, target) + r;
  const a0 = Math.floor(lo) - 1;
  const a1 = Math.floor(hi) + 1;
  const c0 = Math.floor(across - r) - 1;
  const c1 = Math.floor(across + r) + 1;
  const r2 = r * r;

  // Rectangle in (along, across) space: [p0, p1] × [q0, q1].
  const test = (p0: number, p1: number, q0: number, q1: number): void => {
    const dq = across < q0 ? q0 - across : across > q1 ? across - q1 : 0;
    if (dq >= r) return;
    const h = Math.sqrt(r2 - dq * dq);
    const enter = p0 - h;
    const exit = p1 + h;
    if (d > 0) {
      if (along < exit && along <= enter + SKIN)
        target = Math.min(target, Math.max(along, enter - SKIN));
    } else if (along > enter && along >= exit - SKIN) {
      target = Math.max(target, Math.min(along, exit + SKIN));
    }
  };

  for (let c = c0; c <= c1; c++) {
    for (let a = a0; a <= a1; a++) {
      const tx = axis === 0 ? a : c;
      const ty = axis === 0 ? c : a;
      if (grid.isVoid(tx, ty, z)) test(a, a + 1, c, c + 1);
      // North edge: y = ty, x ∈ [tx, tx+1]. West edge: x = tx, y ∈ [ty, ty+1].
      if (grid.hasWallN(tx, ty, z)) {
        if (axis === 0) test(a, a + 1, c, c);
        else test(a, a, c, c + 1);
      }
      if (grid.hasWallW(tx, ty, z)) {
        if (axis === 0) test(a, a, c, c + 1);
        else test(a, a + 1, c, c);
      }
    }
  }
  return target;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Moves a circle by (dx, dy) with collisions; result is f32-rounded and written to `out`. */
export function moveCircle(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  out: Vec2 = { x: 0, y: 0 },
): Vec2 {
  const nx = Math.fround(sweep(grid, z, 0, x, y, dx, r));
  const ny = Math.fround(sweep(grid, z, 1, y, nx, dy, r));
  out.x = nx;
  out.y = ny;
  return out;
}

/** True if the circle overlaps any void tile or wall edge. */
export function circleOverlaps(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  r: number,
): boolean {
  const r2 = r * r;
  const hit = (x0: number, x1: number, y0: number, y1: number): boolean => {
    const ddx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const ddy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    return ddx * ddx + ddy * ddy < r2;
  };
  for (let ty = Math.floor(y - r) - 1; ty <= Math.floor(y + r) + 1; ty++) {
    for (let tx = Math.floor(x - r) - 1; tx <= Math.floor(x + r) + 1; tx++) {
      if (grid.isVoid(tx, ty, z) && hit(tx, tx + 1, ty, ty + 1)) return true;
      if (grid.hasWallN(tx, ty, z) && hit(tx, tx + 1, ty, ty)) return true;
      if (grid.hasWallW(tx, ty, z) && hit(tx, tx, ty, ty + 1)) return true;
    }
  }
  return false;
}
