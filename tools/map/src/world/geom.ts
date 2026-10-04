/** 2D helpers for the world plan (metres, x east, y south). */

export interface Pt {
  x: number;
  y: number;
}

/** Oriented rectangle: centre, size along its axes, angle (rad, +x toward +y). */
export interface ORect {
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from p to segment ab, and the closest point's parameter t. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return { d: Math.hypot(px - cx, py - cy), t, x: cx, y: cy };
}

/** True when (px, py) lies inside the rect grown by `margin`. */
export function inORect(r: ORect, px: number, py: number, margin = 0): boolean {
  const c = Math.cos(r.a);
  const s = Math.sin(r.a);
  const dx = px - r.x;
  const dy = py - r.y;
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return Math.abs(u) <= r.w / 2 + margin && Math.abs(v) <= r.h / 2 + margin;
}

/** Axis-aligned bounds of a rect grown by `margin`. */
export function oRectBounds(r: ORect, margin = 0) {
  const c = Math.abs(Math.cos(r.a));
  const s = Math.abs(Math.sin(r.a));
  const hw = (r.w / 2 + margin) * c + (r.h / 2 + margin) * s;
  const hh = (r.w / 2 + margin) * s + (r.h / 2 + margin) * c;
  return { x0: r.x - hw, y0: r.y - hh, x1: r.x + hw, y1: r.y + hh };
}

/** Polyline length. */
export function polyLength(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1] as Pt, pts[i] as Pt);
  return l;
}

/** Point and unit direction at arc length `s` along a polyline (clamped). */
export function pointAt(pts: readonly Pt[], s: number): { p: Pt; dx: number; dy: number } {
  let rest = Math.max(0, s);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Pt;
    const b = pts[i] as Pt;
    const l = dist(a, b);
    if (rest <= l || i === pts.length - 1) {
      const t = l > 0 ? Math.min(1, rest / l) : 0;
      const dx = l > 0 ? (b.x - a.x) / l : 1;
      const dy = l > 0 ? (b.y - a.y) / l : 0;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dx, dy };
    }
    rest -= l;
  }
  const p = pts[0] ?? { x: 0, y: 0 };
  return { p, dx: 1, dy: 0 };
}

/**
 * Meandering polyline from a to b: recursive midpoint displacement perpendicular to the chord,
 * amplitude `amp` × segment length, until segments are shorter than `minSeg`.
 */
export function meander(a: Pt, b: Pt, amp: number, minSeg: number, rand: () => number): Pt[] {
  const out: Pt[] = [a];
  const rec = (p: Pt, q: Pt, depth: number): void => {
    const l = dist(p, q);
    if (l < minSeg || depth > 12) {
      out.push(q);
      return;
    }
    const nx = -(q.y - p.y) / l;
    const ny = (q.x - p.x) / l;
    const off = (rand() * 2 - 1) * amp * l;
    const m = { x: (p.x + q.x) / 2 + nx * off, y: (p.y + q.y) / 2 + ny * off };
    rec(p, m, depth + 1);
    rec(m, q, depth + 1);
  };
  rec(a, b, 0);
  return out;
}
