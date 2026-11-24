import type { OsmMap } from '../osm/types.js';

/**
 * Grid alignment of an OSM map for the tile world (no zigzag edges): one global rotation of the
 * whole square so the main streets run along the tile axes, then building and area outlines
 * squared to right angles on the axes (like Project Zomboid) when they are within a few degrees
 * of them. Coordinates stay integer decimetres (`deadzone-osm-1`).
 */

/** Pivot of the global rotation: centre of the 16 384 m square (tiles). */
export const OSM_PIVOT = { x: 8192, y: 8192 } as const;

/**
 * Edge of the world square that holds the whole rotated 16 384 m square (tiles): 704 chunks.
 * 16 384 × (cos 27° + sin 27°) ≈ 22 036 m, rounded up to whole 512 m blocks.
 */
export const OSM_WORLD_SIZE = 22528;
/** Shift after the rotation: the rotated square's centre lands on the world square's centre. */
export const OSM_SHIFT = (OSM_WORLD_SIZE - 16384) / 2;

/**
 * Global rotation of the Stalowa Wola square (degrees, x east / y south, counter-clockwise on
 * the map = positive): the street grid by ul. Okulickiego / KEN runs at ≈ 63° (mod 90°) in
 * the UTM frame (`dominantRoadAngle`), +27° brings it onto the axes.
 */
export const OSM_ROTATION_DEG = 27;

/** Snap tolerance: outlines within this many degrees of the axes become axis-aligned. */
export const SQUARE_TOLERANCE_DEG = 12;

/** Share of an outline's perimeter that must run near the axes to be squared (rest: curves). */
const RECTILINEAR_SHARE = 0.75;
/** Per-edge tolerance of the rectilinearity check (degrees). */
const EDGE_TOLERANCE_DEG = 20;

export interface Rotation {
  cos: number;
  sin: number;
  cx: number;
  cy: number;
  /** Shift added after the rotation (tiles, both axes). */
  shift: number;
}

export function rotation(
  deg: number,
  pivot: { x: number; y: number } = OSM_PIVOT,
  shift = OSM_SHIFT,
): Rotation {
  const a = (deg * Math.PI) / 180;
  return { cos: Math.cos(a), sin: Math.sin(a), cx: pivot.x, cy: pivot.y, shift };
}

/** Rotates a point (tiles) from the raw OSM frame into the world frame. */
export function rotatePt(r: Rotation, x: number, y: number): { x: number; y: number } {
  const dx = x - r.cx;
  const dy = y - r.cy;
  return {
    x: r.cx + r.shift + dx * r.cos - dy * r.sin,
    y: r.cy + r.shift + dx * r.sin + dy * r.cos,
  };
}

/** Inverse of `rotatePt` (world frame → raw OSM frame, tiles). */
export function unrotatePt(r: Rotation, x: number, y: number): { x: number; y: number } {
  const dx = x - r.shift - r.cx;
  const dy = y - r.shift - r.cy;
  return { x: r.cx + dx * r.cos + dy * r.sin, y: r.cy - dx * r.sin + dy * r.cos };
}

/** Rotates a flat decimetre array (pivot in tiles). */
function rotFlat(r: Rotation, f: readonly number[]): number[] {
  const out = new Array<number>(f.length);
  const cx = r.cx * 10;
  const cy = r.cy * 10;
  const sh = r.shift * 10;
  for (let i = 0; i + 1 < f.length; i += 2) {
    const dx = f[i]! - cx;
    const dy = f[i + 1]! - cy;
    out[i] = Math.round(cx + sh + dx * r.cos - dy * r.sin);
    out[i + 1] = Math.round(cy + sh + dx * r.sin + dy * r.cos);
  }
  return out;
}

/** Direction of an edge folded into (-45°, 45°] (degrees). */
function fold(dx: number, dy: number): number {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  a = ((a % 90) + 90) % 90;
  return a > 45 ? a - 90 : a;
}

/**
 * Dominant direction (degrees in [0, 90)) of the roads of `kinds` inside a tile box: the peak
 * of a length-weighted, ±2° smoothed histogram of segment directions folded mod 90°.
 */
export function dominantRoadAngle(
  map: Pick<OsmMap, 'roads'>,
  box: { x0: number; y0: number; x1: number; y1: number },
  weights: Partial<Record<string, number>> = {
    trunk: 4,
    primary: 4,
    secondary: 3,
    tertiary: 2,
    residential: 1,
  },
): number {
  const h = new Float64Array(90);
  for (const r of map.roads) {
    const w = weights[r.kind];
    if (!w) continue;
    const p = r.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const mx = (p[i]! + p[i + 2]!) / 20;
      const my = (p[i + 1]! + p[i + 3]!) / 20;
      if (mx < box.x0 || mx > box.x1 || my < box.y0 || my > box.y1) continue;
      const dx = p[i + 2]! - p[i]!;
      const dy = p[i + 3]! - p[i + 1]!;
      const a = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 90) + 90) % 90;
      h[Math.floor(a) % 90]! += Math.hypot(dx, dy) * w;
    }
  }
  let best = 0;
  let bestV = -1;
  for (let a = 0; a < 90; a++) {
    let v = 0;
    for (let d = -2; d <= 2; d++) v += h[(a + d + 90) % 90]! * (3 - Math.abs(d));
    if (v > bestV) {
      bestV = v;
      best = a;
    }
  }
  return best + 0.5;
}

/** Signed area of a flat ring (closed or not; tiles² or dm², same unit²). */
function ringArea(p: readonly number[]): number {
  let s = 0;
  const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++)
    s += p[2 * j]! * p[2 * i + 1]! - p[2 * i]! * p[2 * j + 1]!;
  return s / 2;
}

/** Length-weighted orientation (degrees, (-45, 45]) of a ring, by averaging 4θ. */
export function ringOrientation(p: readonly number[]): { deg: number; share: number } {
  let sx = 0;
  let sy = 0;
  let total = 0;
  const edges: [number, number][] = [];
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2]! - p[i]!;
    const dy = p[i + 3]! - p[i + 1]!;
    const l = Math.hypot(dx, dy);
    if (l === 0) continue;
    const t = (fold(dx, dy) * Math.PI) / 45; // 4θ in radians
    sx += Math.cos(t) * l;
    sy += Math.sin(t) * l;
    total += l;
    edges.push([fold(dx, dy), l]);
  }
  const deg = (Math.atan2(sy, sx) * 45) / Math.PI;
  let near = 0;
  for (const [a, l] of edges) {
    let d = Math.abs(a - deg);
    if (d > 45) d = 90 - d;
    if (d <= EDGE_TOLERANCE_DEG) near += l;
  }
  return { deg, share: total ? near / total : 0 };
}

/**
 * Squares a closed flat ring (decimetres) onto the axes: rotate by −`deg` about `c`, classify
 * every edge as horizontal / vertical, merge runs, put each run on its length-weighted mean
 * line and rebuild the corners. Undefined when the result degenerates.
 */
function squareRing(
  p: readonly number[],
  deg: number,
  c: { x: number; y: number },
  jogs = true,
): number[] | undefined {
  const a = (-deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const n = (p.length >> 1) - 1; // closed ring: last = first
  if (n < 4) return undefined;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = p[2 * i]! - c.x;
    const dy = p[2 * i + 1]! - c.y;
    xs.push(c.x + dx * cos - dy * sin);
    ys.push(c.y + dx * sin + dy * cos);
  }
  type Run = { h: boolean; w: number; s: number };
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = xs[j]! - xs[i]!;
    const dy = ys[j]! - ys[i]!;
    const l = Math.hypot(dx, dy);
    if (l === 0) continue;
    const h = Math.abs(dx) >= Math.abs(dy);
    const v = h ? (ys[i]! + ys[j]!) / 2 : (xs[i]! + xs[j]!) / 2;
    const last = runs[runs.length - 1];
    if (last && last.h === h) {
      last.s += v * l;
      last.w += l;
    } else runs.push({ h, w: l, s: v * l });
  }
  // Cyclic merge of the first and last run.
  if (runs.length > 1 && runs[0]!.h === runs[runs.length - 1]!.h) {
    const last = runs.pop()!;
    runs[0]!.s += last.s;
    runs[0]!.w += last.w;
  }
  if (runs.length < 4 || runs.length % 2) return undefined;
  const h0 = runs.map((r) => r.h);
  const v0 = runs.map((r) => r.s / r.w);
  const w0 = runs.map((r) => r.w);
  const at = jogs ? dropJogs(h0, v0, w0) : { h: h0, v: v0, w: w0 };
  runs.length = at.h.length;
  for (let k = 0; k < runs.length; k++) runs[k] = { h: at.h[k]!, w: at.w[k]!, s: 0 };
  return cornersOf(runs, at.v);
}

/** Smallest wall run kept (decimetres): shorter jogs / notches are merged away. */
export const JOG_MIN_DM = 15;
/** Footprint change allowed by dropping jogs (share of the raw area). */
const JOG_AREA = 0.15;

/**
 * Removes wall runs shorter than `JOG_MIN_DM` (squared frame, alternating h / v): the shortest
 * goes first, its two neighbours (parallel) merge onto their length-weighted mean line. Keeps
 * at least 4 runs (a rectangle).
 */
export function dropJogs(
  h0: readonly boolean[],
  v0: readonly number[],
  w0: readonly number[],
): { h: boolean[]; v: number[]; w: number[] } {
  const h = [...h0];
  const v = [...v0];
  const w = [...w0];
  for (;;) {
    const n = v.length;
    if (n <= 4) break;
    let best = -1;
    let bestL = JOG_MIN_DM;
    for (let k = 0; k < n; k++) {
      const l = Math.abs(v[(k + 1) % n]! - v[(k + n - 1) % n]!);
      if (l < bestL) {
        bestL = l;
        best = k;
      }
    }
    if (best < 0) break;
    const a = (best + n - 1) % n;
    const b = (best + 1) % n;
    const wa = w[a]! || 1;
    const wb = w[b]! || 1;
    v[a] = (v[a]! * wa + v[b]! * wb) / (wa + wb);
    w[a] = wa + wb + w[best]!;
    // Remove `best` and `b` (higher index first).
    for (const k of [best, b].sort((x, y) => y - x)) {
      h.splice(k, 1);
      v.splice(k, 1);
      w.splice(k, 1);
    }
  }
  return { h, v, w };
}

/** Corners of alternating h / v runs on lines `at`; closed flat ring (rounded), or undefined. */
function cornersOf(runs: readonly { h: boolean }[], at: readonly number[]): number[] | undefined {
  if (runs.length < 4 || runs.length % 2) return undefined;
  const out: number[] = [];
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k]!;
    const nx = runs[(k + 1) % runs.length]!;
    const v = at[k]!;
    const w = at[(k + 1) % runs.length]!;
    // Corner between run k and run k+1 (one horizontal, one vertical).
    const x = r.h ? w : v;
    const y = r.h ? v : w;
    if (nx.h === r.h) return undefined;
    out.push(Math.round(x), Math.round(y));
  }
  // Corner k ends run k: the corners in order trace the runs; close the ring.
  out.push(out[0]!, out[1]!);
  return out;
}

/** Squared outline close to the original: area within 6 %, centroid within 0.5 m. */
export function sameFootprint(a: readonly number[], b: readonly number[]): boolean {
  const A = Math.abs(ringArea(a));
  const B = Math.abs(ringArea(b));
  if (!B || Math.abs(A - B) > B * 0.06) return false;
  // Area centroid (vertex counts differ after squaring).
  const c = (g: readonly number[]) => {
    let x = 0;
    let y = 0;
    let k = 0;
    for (let i = 0; i + 3 < g.length; i += 2) {
      const cr = g[i]! * g[i + 3]! - g[i + 2]! * g[i + 1]!;
      x += (g[i]! + g[i + 2]!) * cr;
      y += (g[i + 1]! + g[i + 3]!) * cr;
      k += cr;
    }
    return [x / (3 * k), y / (3 * k)] as const;
  };
  const [ax, ay] = c(a);
  const [bx, by] = c(b);
  return Math.hypot(ax - bx, ay - by) <= 5;
}

/** A flat ring turned by `deg` about `c` (decimetres, rounded). */
function turnFlat(p: readonly number[], deg: number, c: { x: number; y: number }): number[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out: number[] = [];
  for (let i = 0; i + 1 < p.length; i += 2) {
    const dx = p[i]! - c.x;
    const dy = p[i + 1]! - c.y;
    out.push(Math.round(c.x + dx * cos - dy * sin), Math.round(c.y + dx * sin + dy * cos));
  }
  return out;
}

/**
 * Squared rings of a building / area, or undefined when it is not near-rectilinear. Within
 * `SQUARE_TOLERANCE_DEG` of the axes the outline goes onto the axes; with `local` (buildings)
 * one further off the grid is squared to its own axis (straight walls, its angle kept).
 */
function squareRings(rings: readonly (readonly number[])[], local = false): number[][] | undefined {
  const outer = rings[0];
  if (!outer || outer.length < 10) return undefined;
  const o = ringOrientation(outer);
  if (o.share < RECTILINEAR_SHARE) return undefined;
  const off = Math.abs(o.deg) > SQUARE_TOLERANCE_DEG;
  if (off && !local) return undefined;
  let cx = 0;
  let cy = 0;
  const n = (outer.length >> 1) - 1;
  for (let i = 0; i < n; i++) {
    cx += outer[2 * i]!;
    cy += outer[2 * i + 1]!;
  }
  const c = { x: cx / n, y: cy / n };
  const a0 = Math.abs(ringArea(outer));
  if (!a0) return undefined;
  // Jogs dropped while the footprint stays within ±JOG_AREA; else every run kept (±25 %).
  for (const [jogs, tol] of [
    [true, JOG_AREA],
    [false, 0.25],
  ] as const) {
    const out: number[][] = [];
    for (const r of rings) {
      const s = squareRing(r, o.deg, c, jogs);
      if (!s) break;
      // Off the street grid: square to the building's own axis (rotate the result back).
      out.push(off ? turnFlat(s, o.deg, c) : s);
    }
    if (out.length !== rings.length) continue;
    const a1 = Math.abs(ringArea(out[0]!));
    if (Math.abs(a1 - a0) / a0 <= tol) return out;
  }
  return undefined;
}

/** Douglas–Peucker tolerance (decimetres) of outlines that are not squared (curves). */
export const SIMPLIFY_DM = 7;
/** A non-rectilinear outline becomes its oriented bounding box when that adds at most this share. */
const RECT_FILL = 0.87;

/** Douglas–Peucker of a closed flat ring (keeps the first vertex; result closed). */
export function simplifyRing(p: readonly number[], tol = SIMPLIFY_DM): number[] {
  const n = (p.length >> 1) - 1;
  if (n <= 4) return [...p];
  const keep = new Uint8Array(n + 1);
  keep[0] = 1;
  keep[n] = 1;
  // Split at the vertex farthest from the first one, so the closed ring has two halves.
  let far = 1;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(p[2 * i]! - p[0]!, p[2 * i + 1]! - p[1]!);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, n],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = p[2 * a]!;
    const ay = p[2 * a + 1]!;
    const dx = p[2 * b]! - ax;
    const dy = p[2 * b + 1]! - ay;
    const L = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[2 * i]! - ax) * dy - (p[2 * i + 1]! - ay) * dx) / L;
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i <= n; i++) if (keep[i]) out.push(p[2 * i]!, p[2 * i + 1]!);
  return out.length >= 8 ? out : [...p];
}

/** Oriented bounding box (closed flat ring) of a ring, along its dominant edge direction. */
function orientedBox(p: readonly number[]): number[] {
  const deg = ringOrientation(p).deg;
  const a = (-deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]! * cos - p[i + 1]! * sin;
    const y = p[i]! * sin + p[i + 1]! * cos;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const out: number[] = [];
  for (const [x, y] of [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ] as const)
    out.push(Math.round(x * cos + y * sin), Math.round(-x * sin + y * cos));
  return out;
}

/** Corners above which a squared outline becomes its box (when the box fits, `boxIfFits`). */
export const MAX_CORNERS = 8;

/** Oriented box of a ring when it changes the area by at most `JOG_AREA`. */
function boxIfFits(ring: readonly number[]): number[] | undefined {
  const box = orientedBox(ring);
  const a0 = Math.abs(ringArea(ring));
  const a1 = Math.abs(ringArea(box));
  return a1 > 0 && a0 / a1 >= RECT_FILL ? box : undefined;
}

/**
 * Outline that could not be squared (curves, odd shapes): its oriented box when the box fills it
 * well (≥ `RECT_FILL`, no courtyard), else the rings simplified (`SIMPLIFY_DM`).
 */
export function tidyIrregular(rings: readonly (readonly number[])[]): number[][] {
  const outer = rings[0];
  if (!outer) return rings.map((r) => [...r]);
  if (rings.length === 1) {
    const box = boxIfFits(outer);
    if (box) return [box];
  }
  const out = rings.map((r) => simplifyRing(r));
  const a0 = Math.abs(ringArea(outer));
  const a1 = Math.abs(ringArea(out[0]!));
  return a0 && Math.abs(a1 - a0) / a0 <= JOG_AREA ? out : rings.map((r) => [...r]);
}

/** Whether a ring has a spike (corner < `SPIKE_DEG`) or crosses / touches itself. */
export function badRing(p: readonly number[]): boolean {
  const pts: [number, number][] = [];
  for (let k = 0; k + 1 < p.length; k += 2) pts.push([p[k]!, p[k + 1]!]);
  const f = pts[0];
  const l = pts[pts.length - 1];
  if (pts.length > 1 && f && l && f[0] === l[0] && f[1] === l[1]) pts.pop();
  const n = pts.length;
  if (n < 3) return true;
  const cr = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const c = pts[(i + 2) % n]!;
    const ux = a[0] - b[0];
    const uy = a[1] - b[1];
    const vx = c[0] - b[0];
    const vy = c[1] - b[1];
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (!lu || !lv) return true;
    const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
    if ((Math.acos(cos) * 180) / Math.PI < SPIKE_DEG) return true;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const r = pts[j]!;
      const s = pts[(j + 1) % n]!;
      const d1 = cr(b[0] - a[0], b[1] - a[1], r[0] - a[0], r[1] - a[1]);
      const d2 = cr(b[0] - a[0], b[1] - a[1], s[0] - a[0], s[1] - a[1]);
      const d3 = cr(s[0] - r[0], s[1] - r[1], a[0] - r[0], a[1] - r[1]);
      const d4 = cr(s[0] - r[0], s[1] - r[1], b[0] - r[0], b[1] - r[1]);
      if (d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0))
        return true;
    }
  }
  return false;
}

/** Corners sharper than this are spikes (same as the shape test, `building-check.ts`). */
const SPIKE_DEG = 30;

/** Convex hull (closed flat ring) of a ring's vertices. */
function hullRing(p: readonly number[]): number[] {
  const pts: [number, number][] = [];
  for (let k = 0; k + 1 < p.length; k += 2) pts.push([p[k]!, p[k + 1]!]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: number[], a: number[], b: number[]) =>
    (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const half = (list: [number, number][]) => {
    const h: [number, number][] = [];
    for (const q of list) {
      while (h.length >= 2 && cr(h[h.length - 2]!, h[h.length - 1]!, q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const h = [...half(pts), ...half([...pts].reverse())];
  const out: number[] = [];
  for (const q of [...h, h[0]!]) out.push(q[0], q[1]);
  return out;
}

/**
 * Outline kept when every ring is clean (no spike, no self-crossing). Else, for a plain outline,
 * the first clean of: its box when it fits, a coarser simplification, its convex hull, its box.
 * A courtyard outline with a bad ring drops the courtyards first.
 */
export function cleanOrFallback(rings: number[][], rot: readonly number[][]): number[][] {
  if (rings.every((r) => !badRing(r))) return rings;
  const outer = rings[0] && !badRing(rings[0]) ? rings[0] : undefined;
  if (outer) return [outer];
  const src = rot[0]!;
  const tries = [boxIfFits(src), simplifyRing(src, 3 * SIMPLIFY_DM), hullRing(src)];
  for (const t of tries) if (t && !badRing(t)) return [t];
  return [orientedBox(src)];
}

/** Counts of a straightening pass (report / tests). */
export interface StraightenStats {
  buildings: number;
  buildingsSquared: number;
  /** Of those, squared to their own axis (off the street grid). */
  buildingsLocal: number;
  areas: number;
  areasSquared: number;
}

/**
 * The map rotated by `deg` about the square's centre, with building and area outlines squared
 * onto the axes (`SQUARE_TOLERANCE_DEG`). Pure; features keep their ids and order.
 */
export function straightenOsmMap(
  map: OsmMap,
  deg = OSM_ROTATION_DEG,
  stats?: StraightenStats,
): OsmMap {
  const r = rotation(deg);
  const rp = (x: number, y: number) => {
    const q = rotatePt(r, x / 10, y / 10);
    return { x: Math.round(q.x * 10), y: Math.round(q.y * 10) };
  };
  const sq = (rings: readonly number[][], local = false) => {
    const rot = rings.map((g) => rotFlat(r, g));
    return { rot, squared: squareRings(rot, local) };
  };
  let bs = 0;
  let bl = 0;
  let as = 0;
  const shaped = (rot: number[][], squared: number[][] | undefined): number[][] => {
    if (!squared) return tidyIrregular(rot);
    if ((squared[0]!.length >> 1) - 1 > MAX_CORNERS && squared.length === 1) {
      const box = boxIfFits(squared[0]!);
      if (box) return [box];
    }
    if (Math.abs(ringOrientation(rot[0]!).deg) > SQUARE_TOLERANCE_DEG) bl++;
    return squared;
  };
  // Corners shared by two buildings (terraced houses, shared walls): those keep their line.
  const corners = new Map<string, number>();
  for (const b of map.buildings) {
    if (!b.exact) continue;
    const g = b.rings[0] ?? [];
    for (let i = 0; i + 3 < g.length; i += 2) {
      const k = `${Math.round(g[i]! / 3)},${Math.round(g[i + 1]! / 3)}`;
      corners.set(k, (corners.get(k) ?? 0) + 1);
    }
  }
  const touches = (g: readonly number[]): boolean => {
    for (let i = 0; i + 3 < g.length; i += 2)
      if ((corners.get(`${Math.round(g[i]! / 3)},${Math.round(g[i + 1]! / 3)}`) ?? 0) > 1)
        return true;
    return false;
  };
  const buildings = map.buildings.map((b) => {
    // map2 outlines (`exact`): the frame rotation, and right angles on the building's own axis
    // when the outline is near-rectilinear (Paweł 24.11: walls straight, corners square, same
    // shape and place). Buildings sharing a wall keep their OSM line.
    if (b.exact) {
      const rot = b.rings.map((g) => rotFlat(r, g));
      if (!b.noWall && !touches(b.rings[0] ?? [])) {
        const sqr = squareRings(rot, true);
        if (sqr && sameFootprint(sqr[0]!, rot[0]!)) {
          bs++;
          return { ...b, rings: sqr };
        }
      }
      return { ...b, rings: rot };
    }
    const { rot, squared } = sq(b.rings, true);
    if (squared) bs++;
    return { ...b, rings: cleanOrFallback(shaped(rot, squared), rot) };
  });
  const areas = map.areas.map((a) => {
    // A clipped piece is not squared (its cut edges are on the axes; the whole is not).
    if (a.part !== undefined) return { ...a, rings: a.rings.map((g) => rotFlat(r, g)) };
    const { rot, squared } = sq(a.rings);
    if (squared) as++;
    return { ...a, rings: squared ?? rot };
  });
  if (stats) {
    stats.buildings = buildings.length;
    stats.buildingsSquared = bs;
    stats.buildingsLocal = bl;
    stats.areas = areas.length;
    stats.areasSquared = as;
  }
  return {
    ...map,
    roads: map.roads.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })),
    rails: map.rails.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })),
    ...(map.power ? { power: map.power.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })) } : {}),
    ...(map.railNodes ? { railNodes: map.railNodes.map((p) => ({ ...p, ...rp(p.x, p.y) })) } : {}),
    waterways: map.waterways.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })),
    areas,
    buildings,
    trees: rotFlat(r, map.trees),
    treeRows: map.treeRows.map((x) => rotFlat(r, x)),
    pois: map.pois.map((p) => ({ ...p, ...rp(p.x, p.y) })),
    places: map.places.map((p) => ({ ...p, ...rp(p.x, p.y) })),
  };
}
