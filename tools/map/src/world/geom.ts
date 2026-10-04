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

/** Corners of an oriented rectangle (grown by `margin` on every side). */
export function oRectCorners(r: ORect, margin = 0): Pt[] {
  const c = Math.cos(r.a);
  const s = Math.sin(r.a);
  const hw = r.w / 2 + margin;
  const hh = r.h / 2 + margin;
  return [
    [hw, hh],
    [hw, -hh],
    [-hw, -hh],
    [-hw, hh],
  ].map(([u = 0, v = 0]) => ({ x: r.x + u * c - v * s, y: r.y + u * s + v * c }));
}

/**
 * True when two oriented rectangles overlap (separating axis test). Touching is not overlap;
 * `eps` (m) also forgives that much interpenetration (rounding on wall-to-wall rows).
 */
export function oRectsOverlap(a: ORect, b: ORect, eps = 0): boolean {
  if (Math.hypot(a.x - b.x, a.y - b.y) > (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 2)
    return false;
  const ca = oRectCorners(a);
  const cb = oRectCorners(b);
  for (const ang of [a.a, a.a + Math.PI / 2, b.a, b.a + Math.PI / 2]) {
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const pa = ca.map((p) => p.x * ax + p.y * ay);
    const pb = cb.map((p) => p.x * ax + p.y * ay);
    if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps)
      return false;
  }
  return true;
}

/** Intersection of segments ab and cd: parameters along each (0..1) and the point, or undefined. */
export function segCross(
  a: Pt,
  b: Pt,
  c: Pt,
  d: Pt,
): { t: number; u: number; x: number; y: number } | undefined {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return undefined;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return undefined;
  return { t, u, x: a.x + rx * t, y: a.y + ry * t };
}

/** Grid index over one polyline's segments: fast distance and crossing queries (the river). */
export class PolylineIndex {
  private readonly cell = 400;
  private readonly cells = new Map<number, number[]>();
  constructor(readonly pts: readonly Pt[]) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as Pt;
      const b = pts[i] as Pt;
      for (
        let y = Math.floor(Math.min(a.y, b.y) / this.cell);
        y <= Math.floor(Math.max(a.y, b.y) / this.cell);
        y++
      )
        for (
          let x = Math.floor(Math.min(a.x, b.x) / this.cell);
          x <= Math.floor(Math.max(a.x, b.x) / this.cell);
          x++
        ) {
          const k = (y + 1024) * 4096 + x + 1024;
          const l = this.cells.get(k);
          if (l) l.push(i);
          else this.cells.set(k, [i]);
        }
    }
  }

  private near(x: number, y: number, ring: number): number[] {
    const out = new Set<number>();
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let j = -ring; j <= ring; j++)
      for (let i = -ring; i <= ring; i++)
        for (const s of this.cells.get((cy + j + 1024) * 4096 + cx + i + 1024) ?? []) out.add(s);
    return [...out];
  }

  /** Exact distance to the polyline. */
  dist(x: number, y: number): number {
    let d = Infinity;
    for (const i of this.near(x, y, 1)) {
      const a = this.pts[i - 1] as Pt;
      const b = this.pts[i] as Pt;
      d = Math.min(d, segDist(x, y, a.x, a.y, b.x, b.y).d);
    }
    if (d <= this.cell) return d;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1] as Pt;
      const b = this.pts[i] as Pt;
      d = Math.min(d, segDist(x, y, a.x, a.y, b.x, b.y).d);
    }
    return d;
  }

  /** Every crossing of segment ab with the polyline (`seg` = index of its segment end point). */
  crossings(a: Pt, b: Pt): { x: number; y: number; t: number; seg: number }[] {
    const l = dist(a, b);
    const steps = Math.max(1, Math.ceil(l / this.cell));
    const segs = new Set<number>();
    for (let k = 0; k <= steps; k++)
      for (const s of this.near(
        a.x + ((b.x - a.x) * k) / steps,
        a.y + ((b.y - a.y) * k) / steps,
        1,
      ))
        segs.add(s);
    const out: { x: number; y: number; t: number; seg: number }[] = [];
    for (const s of [...segs].sort((p, q) => p - q)) {
      const h = segCross(a, b, this.pts[s - 1] as Pt, this.pts[s] as Pt);
      if (h) out.push({ x: h.x, y: h.y, t: h.t, seg: s });
    }
    return out.sort((p, q) => p.t - q.t);
  }
}
