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
  voidBlocks = true,
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
      if ((voidBlocks && grid.isVoid(tx, ty, z)) || grid.furnitureBlocks(tx, ty, z))
        test(a, a + 1, c, c + 1);
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
  /** false: tiles without floor do not stop the circle (knock-back over an edge, physics). */
  voidBlocks = true,
): Vec2 {
  const nx = Math.fround(sweep(grid, z, 0, x, y, dx, r, voidBlocks));
  const ny = Math.fround(sweep(grid, z, 1, y, nx, dy, r, voidBlocks));
  out.x = nx;
  out.y = ny;
  return out;
}

/** True if the circle overlaps any void tile, furniture tile (footprint flag) or wall edge. */
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
      if (grid.isBlocked(tx, ty, z) && hit(tx, tx + 1, ty, ty + 1)) return true;
      if (grid.hasWallN(tx, ty, z) && hit(tx, tx + 1, ty, ty)) return true;
      if (grid.hasWallW(tx, ty, z) && hit(tx, tx, ty, ty + 1)) return true;
    }
  }
  return false;
}

/**
 * Character movement with smooth wall sliding (players, `systems/movement.ts`): the move is cut
 * into substeps of at most `r / 2` (a wall edge has no thickness, so a centre can never cross
 * one unnoticed: no tunnelling), and after each substep the circle is pushed out of the deepest
 * overlap along the normal from the closest obstacle point, up to 4 times. Against a straight
 * wall that keeps the tangential part of the move unchanged; around a wall end or the corner of
 * a void tile the normal is radial, so the circle rounds the corner instead of snagging on it.
 * It rests `SKIN` outside every obstacle, so standing in a corner gives the same position every
 * tick (no jitter). Obstacles the circle already overlapped at the start (a bad spawn, a door
 * closed on it) are ignored, as in `moveCircle`.
 *
 * `normals` (optional) receives the unit contact normals (flat nx, ny pairs, out of the
 * obstacles) of everything within `CONTACT_EPS` of the circle at the end.
 */
export const CONTACT_EPS = 4 * SKIN;
const MAX_PUSHES = 4;

/** Closest obstacle sink: visits void rects and wall edges around (x, y) in a fixed order. */
function forObstacles(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  reach: number,
  voidBlocks: boolean,
  fn: (key: number, x0: number, x1: number, y0: number, y1: number) => void,
): void {
  const ty0 = Math.floor(y - reach) - 1;
  const ty1 = Math.floor(y + reach) + 1;
  const tx0 = Math.floor(x - reach) - 1;
  const tx1 = Math.floor(x + reach) + 1;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const k = (tx * 65536 + ty) * 4;
      if ((voidBlocks && grid.isVoid(tx, ty, z)) || grid.furnitureBlocks(tx, ty, z))
        fn(k, tx, tx + 1, ty, ty + 1);
      if (grid.hasWallN(tx, ty, z)) fn(k + 1, tx, tx + 1, ty, ty);
      if (grid.hasWallW(tx, ty, z)) fn(k + 2, tx, tx, ty, ty + 1);
    }
  }
}

const ignored: number[] = [];

export function slideCircle(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  r: number,
  out: Vec2 = { x: 0, y: 0 },
  normals?: number[],
  voidBlocks = true,
): Vec2 {
  ignored.length = 0;
  forObstacles(grid, z, x, y, r, voidBlocks, (k, x0, x1, y0, y1) => {
    const ex = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
    const ey = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    if (ex * ex + ey * ey < (r - SKIN) * (r - SKIN)) ignored.push(k);
  });
  const len = Math.sqrt(dx * dx + dy * dy);
  const n = len > 0 ? Math.max(1, Math.ceil(len / (r * 0.5))) : 0;
  const sx = n > 0 ? dx / n : 0;
  const sy = n > 0 ? dy / n : 0;
  let px = x;
  let py = y;
  for (let i = 0; i < n; i++) {
    px += sx;
    py += sy;
    for (let it = 0; it < MAX_PUSHES; it++) {
      let best = 0;
      let bnx = 0;
      let bny = 0;
      let bcx = 0;
      let bcy = 0;
      forObstacles(grid, z, px, py, r, voidBlocks, (k, x0, x1, y0, y1) => {
        if (ignored.length > 0 && ignored.includes(k)) return;
        const cx = px < x0 ? x0 : px > x1 ? x1 : px;
        const cy = py < y0 ? y0 : py > y1 ? y1 : py;
        const ex = px - cx;
        const ey = py - cy;
        const d2 = ex * ex + ey * ey;
        if (d2 >= r * r) return;
        const d = Math.sqrt(d2);
        let nx: number;
        let ny: number;
        if (d > 0) {
          nx = ex / d;
          ny = ey / d;
        } else if (x0 === x1 || y0 === y1) {
          // Centre exactly on an edge: back along the substep.
          nx = -sx / (len / n);
          ny = -sy / (len / n);
        } else return;
        const pen = r - d;
        if (pen > best) {
          best = pen;
          bnx = nx;
          bny = ny;
          bcx = cx;
          bcy = cy;
        }
      });
      if (best <= 0) break;
      px = bcx + bnx * (r + SKIN);
      py = bcy + bny * (r + SKIN);
    }
  }
  out.x = Math.fround(px);
  out.y = Math.fround(py);
  if (normals) circleContacts(grid, z, out.x, out.y, r, normals, voidBlocks);
  return out;
}

/** Unit normals (flat nx, ny pairs) of obstacles within `CONTACT_EPS` of the circle. */
export function circleContacts(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  r: number,
  normals: number[],
  voidBlocks = true,
): number[] {
  normals.length = 0;
  const lim = r + CONTACT_EPS;
  forObstacles(grid, z, x, y, lim, voidBlocks, (_k, x0, x1, y0, y1) => {
    const cx = x < x0 ? x0 : x > x1 ? x1 : x;
    const cy = y < y0 ? y0 : y > y1 ? y1 : y;
    const ex = x - cx;
    const ey = y - cy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= lim * lim || d2 < (r - SKIN) * (r - SKIN)) return;
    const d = Math.sqrt(d2);
    const nx = ex / d;
    const ny = ey / d;
    // Nearly parallel normals (the end of the next segment of a straight wall, a joint between
    // two void tiles) are one contact: keep the closer one, so joints add no sideways push.
    for (let i = 0; i < normals.length; i += 2) {
      if (nx * normals[i]! + ny * normals[i + 1]! > MERGE_COS) {
        if (d < contactDist[i >> 1]!) {
          normals[i] = nx;
          normals[i + 1] = ny;
          contactDist[i >> 1] = d;
        }
        return;
      }
    }
    contactDist[normals.length >> 1] = d;
    normals.push(nx, ny);
  });
  return normals;
}

const MERGE_COS = 0.9;
const contactDist: number[] = [];
