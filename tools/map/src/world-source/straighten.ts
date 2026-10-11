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
}

export function rotation(deg: number, pivot: { x: number; y: number } = OSM_PIVOT): Rotation {
  const a = (deg * Math.PI) / 180;
  return { cos: Math.cos(a), sin: Math.sin(a), cx: pivot.x, cy: pivot.y };
}

/** Rotates a point (tiles). */
export function rotatePt(r: Rotation, x: number, y: number): { x: number; y: number } {
  const dx = x - r.cx;
  const dy = y - r.cy;
  return { x: r.cx + dx * r.cos - dy * r.sin, y: r.cy + dx * r.sin + dy * r.cos };
}

/** Inverse rotation of a point (tiles). */
export function unrotatePt(r: Rotation, x: number, y: number): { x: number; y: number } {
  return rotatePt({ ...r, sin: -r.sin }, x, y);
}

/** Rotates a flat decimetre array (pivot in tiles). */
function rotFlat(r: Rotation, f: readonly number[]): number[] {
  const out = new Array<number>(f.length);
  const cx = r.cx * 10;
  const cy = r.cy * 10;
  for (let i = 0; i + 1 < f.length; i += 2) {
    const dx = f[i]! - cx;
    const dy = f[i + 1]! - cy;
    out[i] = Math.round(cx + dx * r.cos - dy * r.sin);
    out[i + 1] = Math.round(cy + dx * r.sin + dy * r.cos);
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
  const at = runs.map((r) => r.s / r.w);
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

/** Squared rings of a building / area, or the original when it is not near-rectilinear. */
function squareRings(rings: readonly (readonly number[])[]): number[][] | undefined {
  const outer = rings[0];
  if (!outer || outer.length < 10) return undefined;
  const o = ringOrientation(outer);
  if (Math.abs(o.deg) > SQUARE_TOLERANCE_DEG || o.share < RECTILINEAR_SHARE) return undefined;
  let cx = 0;
  let cy = 0;
  const n = (outer.length >> 1) - 1;
  for (let i = 0; i < n; i++) {
    cx += outer[2 * i]!;
    cy += outer[2 * i + 1]!;
  }
  const c = { x: cx / n, y: cy / n };
  const out: number[][] = [];
  for (const r of rings) {
    const s = squareRing(r, o.deg, c);
    if (!s) return undefined;
    out.push(s);
  }
  const a0 = Math.abs(ringArea(outer));
  const a1 = Math.abs(ringArea(out[0]!));
  if (!a0 || Math.abs(a1 - a0) / a0 > 0.25) return undefined;
  return out;
}

/** Counts of a straightening pass (report / tests). */
export interface StraightenStats {
  buildings: number;
  buildingsSquared: number;
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
  const sq = (rings: readonly number[][]) => {
    const rot = rings.map((g) => rotFlat(r, g));
    return { rot, squared: squareRings(rot) };
  };
  let bs = 0;
  let as = 0;
  const buildings = map.buildings.map((b) => {
    const { rot, squared } = sq(b.rings);
    if (squared) bs++;
    return { ...b, rings: squared ?? rot };
  });
  const areas = map.areas.map((a) => {
    const { rot, squared } = sq(a.rings);
    if (squared) as++;
    return { ...a, rings: squared ?? rot };
  });
  if (stats) {
    stats.buildings = buildings.length;
    stats.buildingsSquared = bs;
    stats.areas = areas.length;
    stats.areasSquared = as;
  }
  return {
    ...map,
    roads: map.roads.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })),
    rails: map.rails.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })),
    waterways: map.waterways.map((x) => ({ ...x, pts: rotFlat(r, x.pts) })),
    areas,
    buildings,
    trees: rotFlat(r, map.trees),
    treeRows: map.treeRows.map((x) => rotFlat(r, x)),
    pois: map.pois.map((p) => ({ ...p, ...rp(p.x, p.y) })),
    places: map.places.map((p) => ({ ...p, ...rp(p.x, p.y) })),
  };
}
