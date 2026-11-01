/**
 * Stage 3: buildings 1:1 with OSM in the map2 frame (`project.ts`, no rotation). Outlines keep
 * every OSM vertex (no squaring, no grid alignment, no simplification); multipolygon inner rings
 * stay as courtyards; walls shared by neighbours are marked; heights come from `height`,
 * `building:levels` / `levels` (+ `roof:levels`) and `building:part`.
 */
import type { Projection } from './project.js';

export type LonLat = [number, number];
export type Pt = [number, number];

/** `deadzone-osm-bld-raw-2` (scripts/extract_buildings.py). */
export interface RawBuilding {
  id: number;
  /** Closed way (true) or multipolygon relation. */
  way: boolean;
  /** `building:part` without `building`. */
  part: boolean;
  t: Record<string, string>;
  rings: { outer: LonLat[]; inner: LonLat[][] }[];
}
export interface RawBuildings2 {
  format: 'deadzone-osm-bld-raw-2';
  bbox: [number, number, number, number];
  source: string;
  license: string;
  buildings: RawBuilding[];
}

export type HeightFrom = 'height' | 'levels' | 'parts' | 'default';

export interface BuildingPart {
  id: number;
  outer: Pt[];
  inner: Pt[][];
  /** Levels above ground of the part's top / bottom (`building:min_level`). */
  levels: number;
  minLevel: number;
  /** Metres (`height` / `min_height`, else from levels). */
  height: number;
  minHeight: number;
}

export interface Building2 {
  /** OSM id; `rel` = from a multipolygon relation; `ring` = index of its outer ring. */
  id: number;
  rel: boolean;
  ring: number;
  /** `building=*` value. */
  type: string;
  name?: string;
  /** Outer ring (positive shoelace area in the y-south frame), not closed (last ≠ first). */
  outer: Pt[];
  /** Courtyards (negative area), not closed. */
  inner: Pt[][];
  /** Edge k of `outer` (outer[k] → outer[k+1]) is shared with another building. */
  shared: number[];
  levels: number;
  roofLevels: number;
  height: number;
  heightFrom: HeightFrom;
  roof?: string;
  colour?: string;
  parts: BuildingPart[];
  /** Footprint area (m², outer minus courtyards). */
  area: number;
}

/** Storey height (m). */
export const LEVEL_M = 3;

/** Default levels by `building=*` when OSM has neither height nor levels. */
const DEFAULT_LEVELS: Record<string, number> = {
  apartments: 4,
  residential: 3,
  house: 2,
  detached: 2,
  semidetached_house: 2,
  terrace: 2,
  commercial: 2,
  retail: 1,
  office: 3,
  school: 3,
  hospital: 4,
  church: 2,
  industrial: 1,
  warehouse: 1,
  garage: 1,
  garages: 1,
  shed: 1,
  roof: 1,
  hut: 1,
};

/** Number from an OSM value (`12`, `12.5 m`, `12,5`); undefined when not a positive number. */
export function osmNumber(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(m|ft)?\s*$/.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(',', '.')) * (m[2] === 'ft' ? 0.3048 : 1);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function signedArea(r: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Projected ring: consecutive duplicates and the closing vertex dropped, orientation `sign`. */
export function cleanRing(r: readonly LonLat[], proj: Projection, sign: 1 | -1): Pt[] {
  const out: Pt[] = [];
  for (const [lon, lat] of r) {
    const p = proj.toLocal(lon, lat);
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p);
  }
  while (
    out.length > 1 &&
    out[0]![0] === out[out.length - 1]![0] &&
    out[0]![1] === out[out.length - 1]![1]
  )
    out.pop();
  if (Math.sign(signedArea(out)) === -sign) out.reverse();
  return out;
}

export function pointInRing(x: number, y: number, r: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(r: readonly Pt[]): Pt {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % r.length]!;
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  return a ? [cx / (3 * a), cy / (3 * a)] : r[0]!;
}

interface Heights {
  levels: number;
  roofLevels: number;
  minLevel: number;
  height: number;
  minHeight: number;
  from: HeightFrom;
}

/** Heights from tags: `height` wins, then `building:levels` / `levels` (+ roof), else default. */
export function heightsOf(t: Record<string, string>, fallbackLevels?: number): Heights {
  const h = osmNumber(t.height);
  const lv = osmNumber(t['building:levels']) ?? osmNumber(t.levels);
  const roofLevels = osmNumber(t['roof:levels']) ?? 0;
  const minLevel = osmNumber(t['building:min_level']) ?? 0;
  const minHeight = osmNumber(t.min_height) ?? minLevel * LEVEL_M;
  if (h !== undefined && h > 0) {
    const levels = lv ?? Math.max(1, Math.round((h - minHeight) / LEVEL_M) + minLevel);
    return { levels, roofLevels, minLevel, height: h, minHeight, from: 'height' };
  }
  if (lv !== undefined && lv > 0)
    return {
      levels: lv,
      roofLevels,
      minLevel,
      height: (lv + roofLevels) * LEVEL_M,
      minHeight,
      from: 'levels',
    };
  const d = fallbackLevels ?? DEFAULT_LEVELS[t.building ?? ''] ?? 1;
  return {
    levels: d,
    roofLevels,
    minLevel,
    height: (d + roofLevels) * LEVEL_M,
    minHeight,
    from: 'default',
  };
}

/** Max distance (m) of a neighbour's edge from an edge's line for the wall to count as shared. */
export const SHARED_TOL = 0.05;
/** Least overlap (m) along the edge for a shared wall. */
export const SHARED_MIN = 0.5;
const CELL = 16;

/** Marks outer edges lying on a neighbour's outer edge (collinear within `SHARED_TOL`). */
export function markSharedWalls(bs: Building2[]): void {
  const grid = new Map<string, [number, number][]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const cellsOf = (a: Pt, b: Pt) => {
    const out: string[] = [];
    for (
      let x = Math.floor(Math.min(a[0], b[0]) / CELL);
      x <= Math.floor(Math.max(a[0], b[0]) / CELL);
      x++
    )
      for (
        let y = Math.floor(Math.min(a[1], b[1]) / CELL);
        y <= Math.floor(Math.max(a[1], b[1]) / CELL);
        y++
      )
        out.push(key(x, y));
    return out;
  };
  bs.forEach((b, i) =>
    b.outer.forEach((p, k) => {
      for (const c of cellsOf(p, b.outer[(k + 1) % b.outer.length]!)) {
        const l = grid.get(c) ?? [];
        l.push([i, k]);
        grid.set(c, l);
      }
    }),
  );
  bs.forEach((b, i) => {
    const shared = new Set<number>();
    b.outer.forEach((a, k) => {
      const c = b.outer[(k + 1) % b.outer.length]!;
      const dx = c[0] - a[0];
      const dy = c[1] - a[1];
      const L = Math.hypot(dx, dy);
      if (L < SHARED_MIN) return;
      const seen = new Set<string>();
      for (const cell of cellsOf(a, c))
        for (const [j, m] of grid.get(cell) ?? []) {
          if (j === i || shared.has(k)) continue;
          const id = `${j}:${m}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const o = bs[j]!.outer;
          const p = o[m]!;
          const q = o[(m + 1) % o.length]!;
          const dist = (r: Pt) => Math.abs((r[0] - a[0]) * dy - (r[1] - a[1]) * dx) / L;
          if (dist(p) > SHARED_TOL || dist(q) > SHARED_TOL) continue;
          const t = (r: Pt) => ((r[0] - a[0]) * dx + (r[1] - a[1]) * dy) / L;
          const lo = Math.max(0, Math.min(t(p), t(q)));
          const hi = Math.min(L, Math.max(t(p), t(q)));
          if (hi - lo >= SHARED_MIN) shared.add(k);
        }
    });
    b.shared = [...shared].sort((x, y) => x - y);
  });
}

/** Raw buildings (WGS84) → map2 buildings (local metres), parts attached, shared walls marked. */
export function buildBuildings(raw: RawBuildings2, proj: Projection): Building2[] {
  const out: Building2[] = [];
  const parts: (BuildingPart & { c: Pt })[] = [];
  for (const rb of raw.buildings) {
    if (rb.t.location === 'underground') continue;
    rb.rings.forEach((rr, ring) => {
      const outer = cleanRing(rr.outer, proj, 1);
      if (outer.length < 3) return;
      const inner = rr.inner.map((r) => cleanRing(r, proj, -1)).filter((r) => r.length >= 3);
      const area = signedArea(outer) + inner.reduce((s, r) => s + signedArea(r), 0);
      if (area <= 0) return;
      if (rb.part) {
        const h = heightsOf(rb.t);
        parts.push({
          id: rb.id,
          outer,
          inner,
          levels: h.levels,
          minLevel: h.minLevel,
          height: h.height,
          minHeight: h.minHeight,
          c: centroid(outer),
        });
        return;
      }
      const h = heightsOf(rb.t);
      out.push({
        id: rb.id,
        rel: !rb.way,
        ring,
        type: rb.t.building ?? 'yes',
        ...(rb.t.name ? { name: rb.t.name } : {}),
        outer,
        inner,
        shared: [],
        levels: h.levels,
        roofLevels: h.roofLevels,
        height: h.height,
        heightFrom: h.from,
        ...(rb.t['roof:shape'] ? { roof: rb.t['roof:shape'] } : {}),
        ...(rb.t['building:colour'] ? { colour: rb.t['building:colour'] } : {}),
        parts: [],
        area,
      });
    });
  }
  // Parts go to the smallest building containing their centroid.
  for (const p of parts) {
    let best: Building2 | undefined;
    for (const b of out)
      if (
        (!best || b.area < best.area) &&
        pointInRing(p.c[0], p.c[1], b.outer) &&
        !b.inner.some((r) => pointInRing(p.c[0], p.c[1], r))
      )
        best = b;
    if (!best) continue;
    const part: BuildingPart = { ...p };
    delete (part as { c?: unknown }).c;
    best.parts.push(part);
  }
  for (const b of out) {
    if (!b.parts.length) continue;
    const top = b.parts.reduce((m, p) => (p.height > m.height ? p : m));
    if (b.heightFrom === 'default' || top.height > b.height) {
      b.height = top.height;
      b.levels = Math.max(b.levels, top.levels);
      b.heightFrom = 'parts';
    }
  }
  markSharedWalls(out);
  return out;
}
