import type { Obb, Vehicle } from './types.js';
import type { VehicleTypeDef } from '../content/adapter.js';

/** Minimum translation: push the box by `depth` along the unit normal (nx, ny). */
export interface Mtv {
  depth: number;
  nx: number;
  ny: number;
}

export const obbOf = (v: Vehicle, t: VehicleTypeDef): Obb => ({
  x: v.x,
  y: v.y,
  hx: v.hx,
  hy: v.hy,
  hl: t.length / 2,
  hw: t.width / 2,
});

/** Half extents of the box's axis-aligned bounds. */
export const obbExtent = (o: Obb): { ex: number; ey: number } => ({
  ex: o.hl * Math.abs(o.hx) + o.hw * Math.abs(o.hy),
  ey: o.hl * Math.abs(o.hy) + o.hw * Math.abs(o.hx),
});

/** Projection radius of the box on unit axis (ux, uy). */
const radiusOn = (o: Obb, ux: number, uy: number): number =>
  o.hl * Math.abs(o.hx * ux + o.hy * uy) + o.hw * Math.abs(-o.hy * ux + o.hx * uy);

/**
 * Box vs axis-aligned unit segment (a tile edge) from (ax, ay), along +x (`horizontal`) or +y.
 * Separating axes: world x, world y, the box's nose and side. Returns the push for the box
 * (normal pointing from the segment into the box) or undefined when they do not overlap.
 */
export function obbVsEdge(o: Obb, ax: number, ay: number, horizontal: boolean): Mtv | undefined {
  const cx = horizontal ? ax + 0.5 : ax;
  const cy = horizontal ? ay : ay + 0.5;
  const sx = horizontal ? 1 : 0;
  const sy = horizontal ? 0 : 1;
  let best: Mtv | undefined;
  const axes: [number, number][] = [
    [1, 0],
    [0, 1],
    [o.hx, o.hy],
    [-o.hy, o.hx],
  ];
  for (const [ux, uy] of axes) {
    const d = (cx - o.x) * ux + (cy - o.y) * uy;
    const overlap = radiusOn(o, ux, uy) + 0.5 * Math.abs(sx * ux + sy * uy) - Math.abs(d);
    if (overlap <= 0) return undefined;
    if (!best || overlap < best.depth) {
      const s = d > 0 ? -1 : 1;
      best = { depth: overlap, nx: ux * s, ny: uy * s };
    }
  }
  return best;
}

/**
 * Circle vs box: push for the circle (normal from the box to the circle) and the contact point
 * on the box, or undefined.
 */
export function circleVsObb(
  o: Obb,
  px: number,
  py: number,
  r: number,
): (Mtv & { cx: number; cy: number }) | undefined {
  const dx = px - o.x;
  const dy = py - o.y;
  const lx = dx * o.hx + dy * o.hy;
  const ly = -dx * o.hy + dy * o.hx;
  if (Math.abs(lx) > o.hl + r || Math.abs(ly) > o.hw + r) return undefined;
  let nlx: number;
  let nly: number;
  let depth: number;
  let qx = Math.max(-o.hl, Math.min(o.hl, lx));
  let qy = Math.max(-o.hw, Math.min(o.hw, ly));
  if (qx === lx && qy === ly) {
    // Centre inside the box: out through the nearest side.
    const fx = o.hl - Math.abs(lx);
    const fy = o.hw - Math.abs(ly);
    if (fx < fy) {
      nlx = lx >= 0 ? 1 : -1;
      nly = 0;
      depth = fx + r;
      qx = nlx * o.hl;
    } else {
      nlx = 0;
      nly = ly >= 0 ? 1 : -1;
      depth = fy + r;
      qy = nly * o.hw;
    }
  } else {
    const ex = lx - qx;
    const ey = ly - qy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d >= r) return undefined;
    nlx = ex / d;
    nly = ey / d;
    depth = r - d;
  }
  return {
    depth,
    nx: nlx * o.hx - nly * o.hy,
    ny: nlx * o.hy + nly * o.hx,
    cx: o.x + qx * o.hx - qy * o.hy,
    cy: o.y + qx * o.hy + qy * o.hx,
  };
}

/** Box vs box (SAT on the 4 box axes): push for `b` (normal from `a` to `b`), or undefined. */
export function obbVsObb(a: Obb, b: Obb): Mtv | undefined {
  let best: Mtv | undefined;
  for (const [ux, uy] of [
    [a.hx, a.hy],
    [-a.hy, a.hx],
    [b.hx, b.hy],
    [-b.hy, b.hx],
  ] as const) {
    const d = (b.x - a.x) * ux + (b.y - a.y) * uy;
    const overlap = radiusOn(a, ux, uy) + radiusOn(b, ux, uy) - Math.abs(d);
    if (overlap <= 0) return undefined;
    if (!best || overlap < best.depth) {
      const s = d >= 0 ? 1 : -1;
      best = { depth: overlap, nx: ux * s, ny: uy * s };
    }
  }
  return best;
}

/** Zone (front 0, rear 1, left 2, right 3) of the box hit at world point (px, py). */
export function zoneAt(o: Obb, px: number, py: number): number {
  const dx = px - o.x;
  const dy = py - o.y;
  const lx = (dx * o.hx + dy * o.hy) / o.hl;
  const ly = (-dx * o.hy + dy * o.hx) / o.hw;
  if (Math.abs(lx) >= Math.abs(ly)) return lx >= 0 ? 0 : 1;
  return ly >= 0 ? 3 : 2;
}
