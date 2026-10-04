import { CHUNK_SIZE } from '@deadzone/content';
import {
  dist,
  inORect,
  meander,
  oRectBounds,
  pointAt,
  polyLength,
  segDist,
  type ORect,
  type Pt,
} from './geom.js';
import { fbm, hash3, rand3, rng, valueNoise } from './rng.js';

/**
 * World macro plan (Silnik 2 generator, step 1): from (seed, size) the whole map's layout —
 * river and lakes, cities / towns / villages, the road hierarchy, complexes (hospital, police,
 * military base), farms, roadside stops, forest paths and glades — as cheap vector data.
 * Chunk filling (tiles, walls, furniture) reads this plan later; nothing here is game data yet.
 *
 * Pure: depends only on (seed, size, WORLD_PLAN_VERSION).
 */
export const WORLD_PLAN_VERSION = 'plan-1';
/** Target world: 16 384 m = 512 × 512 chunks. */
export const DEFAULT_WORLD_SIZE = 16384;
/** Fallback when the sim's save can't hold the big world. */
export const FALLBACK_WORLD_SIZE = 8192;

export type SettlementKind = 'city' | 'town' | 'village';
export interface Settlement {
  id: number;
  kind: SettlementKind;
  x: number;
  y: number;
  /** Built-up radius (m). */
  r: number;
  /** Street grid angle (rad). */
  angle: number;
}

/** Road hierarchy, widest first. `street` = inside settlements, `rail` = railway. */
export type RoadClass = 'highway' | 'main' | 'local' | 'street' | 'track' | 'path' | 'rail';
export const ROAD_WIDTH: Record<RoadClass, number> = {
  highway: 22,
  main: 12,
  local: 7,
  street: 8,
  track: 4,
  path: 2,
  rail: 5,
};
export interface Road {
  cls: RoadClass;
  pts: Pt[];
}

export type BuildingKind =
  | 'house'
  | 'tenement'
  | 'apartment'
  | 'shop'
  | 'office'
  | 'farmhouse'
  | 'barn'
  | 'shed'
  | 'gas'
  | 'canopy'
  | 'hospital'
  | 'police'
  | 'fire'
  | 'barracks'
  | 'hangar'
  | 'military'
  | 'industrial'
  | 'warehouse'
  | 'church'
  | 'school'
  | 'bar'
  | 'garage'
  | 'station'
  | 'hut';
export interface Footprint extends ORect {
  kind: BuildingKind;
  floors: number;
}

export type AreaKind =
  | 'yard'
  | 'farmyard'
  | 'park'
  | 'plaza'
  | 'parking'
  | 'base'
  | 'cemetery'
  | 'glade'
  | 'orchard'
  | 'lake'
  | 'sports'
  | 'industrial'
  | 'block';
export interface Area extends ORect {
  kind: AreaKind;
  /** Ellipse instead of a rectangle. */
  round?: boolean;
}

export type ComplexKind = 'hospital' | 'police' | 'military' | 'industrial' | 'gas' | 'station';
export interface Complex {
  kind: ComplexKind;
  x: number;
  y: number;
  /** Settlement it belongs to (−1 = open country). */
  settlement: number;
}

export interface WorldPlan {
  version: string;
  seed: number;
  size: number;
  chunks: number;
  river: Pt[];
  riverWidth: number;
  settlements: Settlement[];
  roads: Road[];
  buildings: Footprint[];
  areas: Area[];
  complexes: Complex[];
  /** Forest noise threshold (forest where `forestNoise > forestThreshold`). */
  forestThreshold: number;
}

/** Forest density noise (0..1) at a point; forest where it exceeds the plan threshold. */
export function forestNoise(seed: number, x: number, y: number): number {
  return (
    fbm(seed + 7, x / 2600, y / 2600, 5) * 0.92 + valueNoise(seed + 9, x / 260, y / 260) * 0.08
  );
}

// ---------- spatial helpers ----------

/** Segment index over road polylines (nearest-road queries). */
export class RoadIndex {
  private readonly cell = 128;
  private readonly cells = new Map<number, number[]>();
  private readonly segs: number[] = []; // ax ay bx by roadIdx per seg
  constructor(
    private readonly size: number,
    readonly roads: Road[],
  ) {}

  add(roadIdx: number): void {
    const r = this.roads[roadIdx];
    if (!r) return;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1] as Pt;
      const b = r.pts[i] as Pt;
      const s = this.segs.length / 5;
      this.segs.push(a.x, a.y, b.x, b.y, roadIdx);
      const c0 = Math.floor(Math.min(a.x, b.x) / this.cell);
      const c1 = Math.floor(Math.max(a.x, b.x) / this.cell);
      const r0 = Math.floor(Math.min(a.y, b.y) / this.cell);
      const r1 = Math.floor(Math.max(a.y, b.y) / this.cell);
      for (let cy = r0; cy <= r1; cy++)
        for (let cx = c0; cx <= c1; cx++) {
          const k = cy * 65536 + cx;
          const l = this.cells.get(k);
          if (l) l.push(s);
          else this.cells.set(k, [s]);
        }
    }
  }

  /** Nearest road point within `maxR` (optionally only some classes). */
  nearest(
    x: number,
    y: number,
    maxR: number,
    accept?: (cls: RoadClass) => boolean,
  ): { d: number; x: number; y: number; road: number } | undefined {
    let best: { d: number; x: number; y: number; road: number } | undefined;
    const c0 = Math.floor((x - maxR) / this.cell);
    const c1 = Math.floor((x + maxR) / this.cell);
    const r0 = Math.floor((y - maxR) / this.cell);
    const r1 = Math.floor((y + maxR) / this.cell);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++) {
        const l = this.cells.get(cy * 65536 + cx);
        if (!l) continue;
        for (const s of l) {
          const o = s * 5;
          const road = this.segs[o + 4] ?? 0;
          if (accept && !accept(this.roads[road]?.cls ?? 'path')) continue;
          const h = segDist(
            x,
            y,
            this.segs[o] ?? 0,
            this.segs[o + 1] ?? 0,
            this.segs[o + 2] ?? 0,
            this.segs[o + 3] ?? 0,
          );
          if (h.d <= maxR && (!best || h.d < best.d)) best = { d: h.d, x: h.x, y: h.y, road };
        }
      }
    return best;
  }

  get worldSize(): number {
    return this.size;
  }
}

/** 4 m occupancy grid: keeps buildings off roads, water and each other. */
class Occupancy {
  static readonly CELL = 4;
  readonly n: number;
  readonly bits: Uint8Array;
  constructor(size: number) {
    this.n = Math.ceil(size / Occupancy.CELL);
    this.bits = new Uint8Array(this.n * this.n);
  }
  private each(r: ORect, margin: number, fn: (i: number) => boolean | void): boolean {
    const b = oRectBounds(r, margin);
    const C = Occupancy.CELL;
    const x0 = Math.max(0, Math.floor(b.x0 / C));
    const x1 = Math.min(this.n - 1, Math.floor(b.x1 / C));
    const y0 = Math.max(0, Math.floor(b.y0 / C));
    const y1 = Math.min(this.n - 1, Math.floor(b.y1 / C));
    if (b.x0 < 0 || b.y0 < 0 || b.x1 >= this.n * C || b.y1 >= this.n * C) return false;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (inORect(r, (x + 0.5) * C, (y + 0.5) * C, margin + C * 0.5))
          if (fn(y * this.n + x) === false) return false;
    return true;
  }
  free(r: ORect, margin = 1): boolean {
    return this.each(r, margin, (i) => this.bits[i] === 0);
  }
  mark(r: ORect, margin = 0): void {
    this.each(r, margin, (i) => {
      this.bits[i] = 1;
    });
  }
  markSegment(a: Pt, b: Pt, width: number): void {
    const l = dist(a, b);
    if (l < 1e-6) return;
    this.mark({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      w: l + width,
      h: width,
      a: Math.atan2(b.y - a.y, b.x - a.x),
    });
  }
}

// ---------- the plan ----------

export interface WorldPlanOptions {
  seed: number;
  /** World edge in metres (multiple of the chunk size). Default 16 384. */
  size?: number;
}

export function planWorld(opts: WorldPlanOptions): WorldPlan {
  const size = opts.size ?? DEFAULT_WORLD_SIZE;
  if (size % CHUNK_SIZE !== 0 || size < 2048) {
    throw new Error(`world size ${size} must be a multiple of ${CHUNK_SIZE} and ≥ 2048`);
  }
  const seed = opts.seed >>> 0;
  const rand = rng(hash3(seed, 1, 0));
  const A = (size / DEFAULT_WORLD_SIZE) ** 2;
  const occ = new Occupancy(size);
  const roads: Road[] = [];
  const index = new RoadIndex(size, roads);
  const buildings: Footprint[] = [];
  const areas: Area[] = [];
  const complexes: Complex[] = [];
  const addRoad = (cls: RoadClass, pts: Pt[]): number => {
    roads.push({ cls, pts });
    const i = roads.length - 1;
    index.add(i);
    for (let k = 1; k < pts.length; k++)
      occ.markSegment(pts[k - 1] as Pt, pts[k] as Pt, ROAD_WIDTH[cls] + 2);
    return i;
  };
  const place = (f: Footprint, margin = 1.5): boolean => {
    if (!occ.free(f, margin)) return false;
    occ.mark(f);
    buildings.push(f);
    return true;
  };

  /** True when a new lane (after its first `skip` metres) crosses no building or water. */
  const laneFree = (pts: readonly Pt[], skip: number): boolean => {
    const L = polyLength(pts);
    for (let t = skip; t < L; t += 6) {
      const { p } = pointAt(pts, t);
      if (!occ.free({ x: p.x, y: p.y, w: 6, h: 6, a: 0 }, 0) && !onRoad(p)) return false;
    }
    return true;
  };
  const onRoad = (p: Pt): boolean => (index.nearest(p.x, p.y, 14)?.d ?? 99) < 12;

  // Forest threshold: ~32 % of the map (Polish lowland average ~30 %).
  const samples: number[] = [];
  for (let i = 0; i < 4096; i++) samples.push(forestNoise(seed, rand() * size, rand() * size));
  samples.sort((a, b) => a - b);
  const forestThreshold = samples[Math.floor(samples.length * 0.68)] ?? 0.5;
  const isForest = (x: number, y: number, bias = 0) =>
    forestNoise(seed, x, y) > forestThreshold + bias;

  // River: west edge → east edge, meandering.
  const riverWidth = 34;
  const river = meander(
    { x: -50, y: size * (0.3 + rand() * 0.4) },
    { x: size + 50, y: size * (0.3 + rand() * 0.4) },
    0.16,
    60,
    rand,
  );
  for (let k = 1; k < river.length; k++)
    occ.markSegment(river[k - 1] as Pt, river[k] as Pt, riverWidth + 16);
  const riverDist = (x: number, y: number): number => {
    let d = Infinity;
    for (let k = 1; k < river.length; k++) {
      const a = river[k - 1] as Pt;
      const b = river[k] as Pt;
      d = Math.min(d, segDist(x, y, a.x, a.y, b.x, b.y).d);
    }
    return d;
  };

  // Settlements.
  const settlements: Settlement[] = [];
  const counts: [SettlementKind, number, number, number][] = [
    // kind, count, radius min, radius max
    ['city', Math.max(1, Math.round(2 * A)), 760, 980],
    ['town', Math.max(2, Math.round(5 * A)), 300, 430],
    ['village', Math.max(6, Math.round(40 * A)), 120, 190],
  ];
  const gapTo: Record<SettlementKind, number> = { city: 2400, town: 1400, village: 900 };
  for (const [kind, n, r0, r1] of counts) {
    let placed = 0;
    for (let tries = 0; placed < n && tries < 6000; tries++) {
      const r = r0 + rand() * (r1 - r0);
      const margin = kind === 'village' ? 500 : r + 900;
      const x = margin + rand() * (size - 2 * margin);
      const y = margin + rand() * (size - 2 * margin);
      if (kind !== 'village' && isForest(x, y, -0.03)) continue;
      if (kind === 'village' && isForest(x, y, 0.02)) continue;
      const rd = riverDist(x, y);
      // Cities sit on the river (bridges), towns and villages near it or away from it.
      if (kind === 'city' && settlements.length === 0 && rd > 1200) continue;
      if (kind !== 'city' && rd < r + 60) continue;
      const ok = settlements.every(
        (s) => dist(s, { x, y }) > s.r + r + Math.max(gapTo[s.kind], gapTo[kind]),
      );
      if (!ok) continue;
      settlements.push({
        id: settlements.length,
        kind,
        x,
        y,
        r,
        angle: (rand() - 0.5) * 0.5 + (rand() < 0.5 ? 0 : Math.PI / 2),
      });
      placed++;
    }
  }

  let baseRect: ORect | undefined;
  const hitsBase = (pts: readonly Pt[]) =>
    baseRect !== undefined && pts.some((q) => inORect(baseRect as ORect, q.x, q.y, 30));
  // Military base: deep in the biggest forest, away from towns.
  let base: { x: number; y: number; score: number } | undefined;
  for (const relax of [1, 0.5, 0.3]) {
    if (base) break;
    for (let y = 1000; y < size - 1000; y += 250)
      for (let x = 1000; x < size - 1000; x += 250) {
        const far = settlements.every(
          (s) => dist(s, { x, y }) > s.r + (s.kind === 'village' ? 1100 : 2400) * relax,
        );
        if (!far || riverDist(x, y) < 700) continue;
        const score = forestNoise(seed, x, y);
        if (!base || score > base.score) base = { x, y, score };
      }
  }

  // ---- urban layout: blocks inside a noisy outline, streets along the block edges ----
  interface Block {
    u: number;
    v: number;
    d: number;
    i: number;
    j: number;
    rect: ORect;
  }
  const blocksOf = new Map<number, Block[]>();
  /** Outer street corners of each city / town: country roads join the grid there. */
  const cornersOf = new Map<number, Pt[]>();
  const outline = (s: Settlement, ang: number): number =>
    s.r *
    (0.72 +
      0.4 * valueNoise(seed + s.id * 7 + 101, 3 + Math.cos(ang) * 1.6, 3 + Math.sin(ang) * 1.6));
  const urbanSet = settlements.filter((s) => s.kind !== 'village');
  for (const s of urbanSet) {
    const bs = blockSize(s);
    const c = Math.cos(s.angle);
    const sn = Math.sin(s.angle);
    const toW = (u: number, v: number): Pt => ({
      x: s.x + u * c - v * sn,
      y: s.y + u * sn + v * c,
    });
    const inside = (u: number, v: number) => {
      const p = toW(u, v);
      return Math.hypot(p.x - s.x, p.y - s.y) <= outline(s, Math.atan2(p.y - s.y, p.x - s.x));
    };
    const n = Math.ceil((s.r * 1.15) / bs) + 1;
    const blocks: Block[] = [];
    const used = new Set<string>();
    const cornerUse = new Map<string, number>();
    for (let j = -n; j < n; j++)
      for (let i = -n; i < n; i++) {
        const u0 = i * bs;
        const v0 = j * bs;
        if (
          !inside(u0, v0) ||
          !inside(u0 + bs, v0) ||
          !inside(u0, v0 + bs) ||
          !inside(u0 + bs, v0 + bs)
        )
          continue;
        const u = u0 + bs / 2;
        const v = v0 + bs / 2;
        const inner = bs - ROAD_WIDTH.street - 10;
        blocks.push({
          u,
          v,
          i,
          j,
          d: Math.hypot(u, v) / s.r,
          rect: { ...toW(u, v), w: inner, h: inner, a: s.angle },
        });
        used
          .add(`h${i},${j}`)
          .add(`h${i},${j + 1}`)
          .add(`v${i},${j}`)
          .add(`v${i + 1},${j}`);
        for (const [ci, cj] of [
          [i, j],
          [i + 1, j],
          [i, j + 1],
          [i + 1, j + 1],
        ] as const)
          cornerUse.set(`${ci},${cj}`, (cornerUse.get(`${ci},${cj}`) ?? 0) + 1);
      }
    blocksOf.set(s.id, blocks);
    const corners: Pt[] = [];
    for (const [k, nUse] of cornerUse)
      if (nUse < 4) {
        const [ci, cj] = k.split(',').map(Number) as [number, number];
        corners.push(toW(ci * bs, cj * bs));
      }
    cornersOf.set(s.id, corners);
    // Merge unit edges into straight streets; every 4th line is an avenue in cities.
    for (const horiz of [true, false])
      for (let line = -n; line <= n + 1; line++) {
        let run: number | undefined;
        for (let k = -n; k <= n + 1; k++) {
          const has = used.has(horiz ? `h${k},${line}` : `v${line},${k}`);
          if (has && run === undefined) run = k;
          if (!has && run !== undefined) {
            const a = horiz ? toW(run * bs, line * bs) : toW(line * bs, run * bs);
            const b = horiz ? toW(k * bs, line * bs) : toW(line * bs, k * bs);
            addRoad(s.kind === 'city' && line % 4 === 0 ? 'main' : 'street', [a, b]);
            run = undefined;
          }
        }
      }
  }

  // ---- country roads: routed around cities, towns and the base ----
  interface Circle {
    x: number;
    y: number;
    R: number;
    id: number;
  }
  const obstacles: Circle[] = urbanSet.map((s) => ({
    x: s.x,
    y: s.y,
    R: s.r * 1.14 + 90,
    id: s.id,
  }));
  if (base) obstacles.push({ x: base.x, y: base.y, R: 450, id: -2 });
  const avoid = (a: Pt, b: Pt, skip: ReadonlySet<number>, depth = 0): Pt[] => {
    if (depth > 5) return [a, b];
    for (const o of obstacles) {
      if (skip.has(o.id)) continue;
      const h = segDist(o.x, o.y, a.x, a.y, b.x, b.y);
      if (h.d >= o.R || h.t <= 0.001 || h.t >= 0.999) continue;
      let nx = h.x - o.x;
      let ny = h.y - o.y;
      let l = Math.hypot(nx, ny);
      if (l < 1) {
        nx = -(b.y - a.y);
        ny = b.x - a.x;
        l = Math.hypot(nx, ny);
      }
      const w = { x: o.x + (nx / l) * (o.R + 80), y: o.y + (ny / l) * (o.R + 80) };
      return [...avoid(a, w, skip, depth + 1), ...avoid(w, b, skip, depth + 1).slice(1)];
    }
    return [a, b];
  };
  const route = (a: Pt, b: Pt, amp: number, minSeg: number, skip: ReadonlySet<number>): Pt[] => {
    const way = avoid(a, b, skip);
    const pts: Pt[] = [a];
    for (let k = 1; k < way.length; k++)
      pts.push(...meander(way[k - 1] as Pt, way[k] as Pt, amp, minSeg, rand).slice(1));
    for (const p of pts.slice(1, -1))
      for (const o of obstacles) {
        if (skip.has(o.id)) continue;
        const d = Math.hypot(p.x - o.x, p.y - o.y);
        if (d < o.R && d > 0) {
          p.x = o.x + ((p.x - o.x) / d) * o.R;
          p.y = o.y + ((p.y - o.y) / d) * o.R;
        }
      }
    return pts;
  };
  /** Join point of a settlement toward `p`: outer grid corner (city / town) or the centre. */
  const joinPoint = (s: Settlement, p: Pt): Pt => {
    const cs = cornersOf.get(s.id);
    if (!cs || cs.length === 0) return { x: s.x, y: s.y };
    const d = dist(s, p) || 1;
    const t = { x: s.x + ((p.x - s.x) / d) * s.r * 1.2, y: s.y + ((p.y - s.y) / d) * s.r * 1.2 };
    let best = cs[0] as Pt;
    for (const c of cs) if (dist(c, t) < dist(best, t)) best = c;
    return { ...best };
  };
  const country = (cls: RoadClass, a: Settlement, b: Settlement | Pt, amp: number) => {
    const bs = 'kind' in b ? b : undefined;
    const pa = joinPoint(a, bs ?? b);
    const pb = bs ? joinPoint(bs, pa) : { x: b.x, y: b.y };
    const skip = new Set([a.id, ...(bs ? [bs.id] : [])]);
    return addRoad(cls, route(pa, pb, amp, cls === 'highway' ? 180 : 90, skip));
  };

  // Expressway west → east past the cities (bypasses), exits into each city.
  const cities = settlements.filter((s) => s.kind === 'city').sort((a, b) => a.x - b.x);
  const highwayChain: Pt[] = [{ x: 0, y: size * (0.2 + rand() * 0.6) }];
  const end = { x: size, y: size * (0.2 + rand() * 0.6) };
  for (const c of cities) {
    const prev = highwayChain[highwayChain.length - 1] as Pt;
    const h = segDist(c.x, c.y, prev.x, prev.y, end.x, end.y);
    const l = Math.hypot(h.x - c.x, h.y - c.y) || 1;
    const R = c.r * 1.14 + 260;
    highwayChain.push({ x: c.x + ((h.x - c.x) / l) * R, y: c.y + ((h.y - c.y) / l) * R });
  }
  highwayChain.push(end);
  {
    const pts: Pt[] = [highwayChain[0] as Pt];
    for (let k = 1; k < highwayChain.length; k++)
      pts.push(
        ...route(highwayChain[k - 1] as Pt, highwayChain[k] as Pt, 0.03, 180, new Set()).slice(1),
      );
    addRoad('highway', pts);
  }
  // Railway on the other side of the cities, with a station at each.
  const stations: { s: Settlement; p: Pt }[] = [];
  {
    const chain: Pt[] = [{ x: 0, y: size * (0.2 + rand() * 0.6) }];
    const rEnd = { x: size, y: size * (0.2 + rand() * 0.6) };
    for (const c of cities) {
      const hw = highwayChain[cities.indexOf(c) + 1] as Pt;
      const l = Math.hypot(hw.x - c.x, hw.y - c.y) || 1;
      const R = c.r * 1.14 + 40;
      const p = { x: c.x - ((hw.x - c.x) / l) * R, y: c.y - ((hw.y - c.y) / l) * R };
      chain.push(p);
      stations.push({ s: c, p });
    }
    chain.push(rEnd);
    const pts: Pt[] = [chain[0] as Pt];
    for (let k = 1; k < chain.length; k++)
      pts.push(...route(chain[k - 1] as Pt, chain[k] as Pt, 0.015, 200, new Set()).slice(1));
    addRoad('rail', pts);
  }
  for (const c of cities) {
    const hit = index.nearest(c.x, c.y, c.r * 3, (k) => k === 'highway');
    if (hit) country('main', c, { x: hit.x, y: hit.y }, 0.04);
  }
  for (const st of stations) {
    const ang = Math.atan2(st.p.y - st.s.y, st.p.x - st.s.x);
    const p = { x: st.p.x - Math.cos(ang) * 26, y: st.p.y - Math.sin(ang) * 26 };
    buildings.push({ ...p, w: 46, h: 14, a: ang + Math.PI / 2, kind: 'station', floors: 2 });
    const lot = {
      x: p.x - Math.cos(ang) * 30,
      y: p.y - Math.sin(ang) * 30,
      w: 60,
      h: 34,
      a: ang + Math.PI / 2,
    };
    areas.push({ ...lot, kind: 'parking' });
    occ.mark(lot);
    occ.mark({ ...p, w: 46, h: 14, a: ang + Math.PI / 2 });
    complexes.push({ kind: 'station', x: p.x, y: p.y, settlement: st.s.id });
    addRoad('street', [{ x: lot.x, y: lot.y }, joinPoint(st.s, lot)]);
  }

  // Gabriel graph over all settlements: a dense, planar country network. Edges between
  // cities / towns and the MST over them are main roads (wojewódzkie), the rest local.
  const tier1 = settlements.filter((s) => s.kind !== 'village');
  const mst = new Set<string>();
  {
    const inTree = new Set<number>([tier1[0]?.id ?? 0]);
    while (inTree.size < tier1.length) {
      let best: [number, number, number] | undefined;
      for (const i of inTree)
        for (const t of tier1) {
          if (inTree.has(t.id)) continue;
          const d = dist(settlements[i] as Settlement, t);
          if (!best || d < best[2]) best = [i, t.id, d];
        }
      if (!best) break;
      inTree.add(best[1]);
      mst.add(`${Math.min(best[0], best[1])}-${Math.max(best[0], best[1])}`);
    }
  }
  for (let i = 0; i < settlements.length; i++)
    for (let j = i + 1; j < settlements.length; j++) {
      const a = settlements[i] as Settlement;
      const b = settlements[j] as Settlement;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r2 = (dist(a, b) / 2) ** 2;
      const key = `${i}-${j}`;
      const blocked = settlements.some(
        (c, k) => k !== i && k !== j && (c.x - m.x) ** 2 + (c.y - m.y) ** 2 < r2,
      );
      if ((blocked || dist(a, b) > 5200) && !mst.has(key)) continue;
      const main = mst.has(key) || (a.kind !== 'village' && b.kind !== 'village');
      country(main ? 'main' : 'local', a, b, main ? 0.05 : 0.1);
    }
  // Gated road to the military base from the nearest settlement (gate on the long side facing it).
  const baseAngle = rand() * 0.4;
  let gateSign = 1;
  if (base) {
    let near = settlements[0] as Settlement;
    for (const s of settlements) if (dist(s, base) < dist(near, base)) near = s;
    const ux = -Math.sin(baseAngle);
    const uy = Math.cos(baseAngle);
    gateSign = (near.x - base.x) * ux + (near.y - base.y) * uy >= 0 ? 1 : -1;
    const gate = { x: base.x + ux * 262 * gateSign, y: base.y + uy * 262 * gateSign };
    const pa = joinPoint(near, gate);
    addRoad('local', route(pa, gate, 0.06, 90, new Set([near.id, -2])));
  }
  // ---- military base (fenced, barracks, hangars, parade ground) ----
  if (base) {
    const a = baseAngle;
    const W = 640;
    const H = 420;
    // Cleared strip around the fence, then the fenced ground.
    areas.push({ x: base.x, y: base.y, w: W + 70, h: H + 70, a, kind: 'glade' });
    areas.push({ x: base.x, y: base.y, w: W, h: H, a, kind: 'base' });
    baseRect = { x: base.x, y: base.y, w: W + 70, h: H + 70, a };
    complexes.push({ kind: 'military', x: base.x, y: base.y, settlement: -1 });
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (u: number, v: number) => ({ x: base.x + u * c - v * s, y: base.y + u * s + v * c });
    for (const [u0, v0, u1, v1] of [
      [-300, -60, 300, -60],
      [0, gateSign < 0 ? -262 : -190, 0, gateSign > 0 ? 262 : 200],
      [-300, 80, 300, 80],
    ] as const)
      addRoad('street', [at(u0, v0), at(u1, v1)]);
    // Buildings skip any spot a country road already took.
    const put = (u: number, v: number, w: number, h: number, kind: BuildingKind, floors = 1) => {
      const p = at(u, v);
      place({ x: p.x, y: p.y, w, h, a, kind, floors }, 0.5);
    };
    for (let k = 0; k < 6; k++) put(-250 + k * 42, -150, 30, 14, 'barracks', 2);
    for (let k = 0; k < 6; k++) put(-250 + k * 42, -100, 30, 14, 'barracks', 2);
    put(60, -150, 60, 22, 'military', 3); // HQ
    {
      const p = at(-120, 20);
      areas.push({ x: p.x, y: p.y, w: 160, h: 90, a, kind: 'plaza' }); // parade ground
    }
    for (let k = 0; k < 4; k++)
      put(140 + (k % 2) * 90, -110 + Math.floor(k / 2) * 90, 70, 48, 'hangar');
    for (let k = 0; k < 5; k++) put(-230 + k * 40, 140, 26, 18, 'warehouse');
    put(260, 160, 24, 14, 'garage');
    put(14, 196 * gateSign, 10, 8, 'shed'); // gate house
    {
      const p = at(60, 110);
      areas.push({ x: p.x, y: p.y, w: 180, h: 70, a, kind: 'parking' }); // vehicle park
    }
    occ.mark(baseRect);
  }

  // Roads leaving the map (traffic doesn't end at the border).
  for (const s of settlements) {
    const edgeD = Math.min(s.x, s.y, size - s.x, size - s.y);
    if (edgeD > (s.kind === 'village' ? 1400 : 2800)) continue;
    const target =
      edgeD === s.x
        ? { x: 0, y: s.y }
        : edgeD === s.y
          ? { x: s.x, y: 0 }
          : edgeD === size - s.x
            ? { x: size, y: s.y }
            : { x: s.x, y: size };
    country(s.kind === 'village' ? 'local' : 'main', s, target, 0.08);
  }

  // ---- settlements: blocks, houses, complexes ----
  for (const s of settlements) {
    if (s.kind === 'village') village(s);
    else urban(s);
  }
  // Ribbon development: houses along the country roads leaving each city / town.
  for (const s of urbanSet) {
    const r = rng(hash3(seed, s.id, 55));
    for (const rd of [...roads]) {
      if (rd.cls !== 'main' && rd.cls !== 'local') continue;
      const a = rd.pts[0] as Pt;
      const z = rd.pts[rd.pts.length - 1] as Pt;
      const ends = (cornersOf.get(s.id) ?? []).some((c) => dist(c, a) < 1 || dist(c, z) < 1);
      if (!ends) continue;
      const pts = (cornersOf.get(s.id) ?? []).some((c) => dist(c, a) < 1)
        ? rd.pts
        : [...rd.pts].reverse();
      plotsAlong(pts, 30, 200 + r() * 450, rd.cls, r, false);
    }
  }

  function urban(s: Settlement): void {
    const blocks = blocksOf.get(s.id) ?? [];
    const indDir = rand() * Math.PI * 2;
    const special = new Map<number, string>();
    const byD = blocks.map((b, k) => ({ b, k }));
    const pick = (lo: number, hi: number, what: string) => {
      const cand = byD.filter((p) => p.b.d >= lo && p.b.d <= hi && !special.has(p.k));
      const p = cand[Math.floor(rand() * cand.length)];
      if (p) special.set(p.k, what);
    };
    if (s.kind === 'city') {
      pick(0, 0.12, 'plaza');
      pick(0.0, 0.3, 'church');
      pick(0.3, 0.7, 'church');
      pick(0.25, 0.55, 'hospital');
      pick(0.1, 0.4, 'police');
      pick(0.4, 0.8, 'police');
      pick(0.3, 0.6, 'school');
      pick(0.3, 0.7, 'school');
      pick(0.2, 0.6, 'park');
      pick(0.2, 0.6, 'park');
      pick(0.3, 0.7, 'park');
      pick(0.4, 0.8, 'sports');
      pick(0.6, 1, 'cemetery');
      pick(0.5, 0.9, 'fire');
      pick(0.55, 0.95, 'gasblock');
      pick(0.55, 0.95, 'gasblock');
      pick(0.3, 0.8, 'shops');
      pick(0.3, 0.8, 'shops');
    } else {
      pick(0, 0.2, 'plaza');
      pick(0, 0.4, 'church');
      pick(0.1, 0.5, 'police');
      pick(0.2, 0.6, 'school');
      pick(0.2, 0.7, 'clinic');
      pick(0.3, 0.8, 'park');
      pick(0.5, 1, 'cemetery');
      pick(0.4, 0.9, 'fire');
      pick(0.5, 0.95, 'gasblock');
      pick(0.3, 0.8, 'shops');
    }
    let industrial = false;
    for (const [k, b] of blocks.entries()) {
      const what = special.get(k);
      const angTo = Math.atan2(b.v, b.u);
      const inInd =
        b.d > 0.55 &&
        Math.abs(Math.atan2(Math.sin(angTo - indDir), Math.cos(angTo - indDir))) < 0.6;
      const seedB = hash3(seed, s.id * 4096 + b.i + 2048, b.j + 2048);
      const kind = what ?? (inInd ? 'industrial' : zoneOf(s, b.d, seedB));
      if (kind === 'industrial') industrial = true;
      areas.push({ ...b.rect, w: b.rect.w + 6, h: b.rect.h + 6, kind: 'block' });
      fillBlock(s, b.rect, kind, seedB);
      occ.mark(b.rect, 2);
      if (what === 'hospital' || what === 'police' || what === 'gasblock' || what === 'clinic')
        complexes.push({
          kind: what === 'clinic' ? 'hospital' : what === 'gasblock' ? 'gas' : what,
          x: b.rect.x,
          y: b.rect.y,
          settlement: s.id,
        });
    }
    if (industrial)
      complexes.push({
        kind: 'industrial',
        x: s.x + Math.cos(indDir + s.angle) * s.r * 0.75,
        y: s.y + Math.sin(indDir + s.angle) * s.r * 0.75,
        settlement: s.id,
      });
  }

  function zoneOf(s: Settlement, d: number, h: number): string {
    const r = (h % 1000) / 1000;
    if (s.kind === 'city') {
      if (d < 0.3) return r < 0.85 ? 'tenement' : 'office';
      if (d < 0.62)
        return r < 0.55 ? 'apartment' : r < 0.75 ? 'tenement' : r < 0.9 ? 'houses' : 'shops';
      return r < 0.8 ? 'houses' : r < 0.9 ? 'apartment' : 'shops';
    }
    if (d < 0.25) return r < 0.7 ? 'tenement' : 'shops';
    if (d < 0.5) return r < 0.3 ? 'apartment' : 'houses';
    return 'houses';
  }

  /** Buildings and areas of one city block (rect in the settlement's grid frame). */
  function fillBlock(s: Settlement, b: ORect, what: string, h: number): void {
    const r = rng(h);
    const c = Math.cos(b.a);
    const sn = Math.sin(b.a);
    const at = (u: number, v: number) => ({ x: b.x + u * c - v * sn, y: b.y + u * sn + v * c });
    const fp = (
      u: number,
      v: number,
      w: number,
      hh: number,
      kind: BuildingKind,
      floors: number,
      a = 0,
    ) => {
      const p = at(u, v);
      buildings.push({ x: p.x, y: p.y, w, h: hh, a: b.a + a, kind, floors });
      return true;
    };
    const area = (u: number, v: number, w: number, hh: number, kind: AreaKind, round = false) => {
      const p = at(u, v);
      areas.push({ x: p.x, y: p.y, w, h: hh, a: b.a, kind, ...(round ? { round } : {}) });
    };
    const W = b.w;
    const half = W / 2;
    // Perimeter row of buildings of depth `dep` along the 4 sides, split into lots.
    const perimeter = (dep: number, kind: BuildingKind, f0: number, f1: number, gap: number) => {
      for (let side = 0; side < 4; side++) {
        let t = -half + dep;
        while (t < half - dep) {
          const len = 14 + r() * 16;
          const l = Math.min(len, half - dep - t);
          if (l > 8 && r() > gap) {
            const mid = t + l / 2;
            const floors = f0 + Math.floor(r() * (f1 - f0 + 1));
            const [u, v, w, hh] =
              side === 0
                ? [mid, -half + dep / 2, l, dep]
                : side === 1
                  ? [half - dep / 2, mid, dep, l]
                  : side === 2
                    ? [-mid, half - dep / 2, l, dep]
                    : [-half + dep / 2, -mid, dep, l];
            fp(u, v, w - 0.5, hh, kind, floors);
          }
          t += l;
        }
        // Corner building.
        const cu = side === 0 || side === 1 ? half - dep / 2 : -half + dep / 2;
        const cv = side === 1 || side === 2 ? half - dep / 2 : -half + dep / 2;
        fp(cu, cv, dep, dep, kind, f0 + Math.floor(r() * (f1 - f0 + 1)));
      }
    };
    switch (what) {
      case 'plaza':
        area(0, 0, W, W, 'plaza');
        if (s.kind === 'town') {
          // Rynek: town hall in the middle, tenements around.
          fp(0, 0, 26, 18, 'office', 2);
          perimeter(12, 'tenement', 2, 3, 0.05);
        }
        break;
      case 'church':
        area(0, 0, W, W, 'park');
        fp(0, 0, 36, 18, 'church', 2, r() < 0.5 ? 0 : Math.PI / 2);
        fp(half - 12, half - 10, 14, 10, 'house', 2);
        break;
      case 'hospital':
        area(0, 0, W, W, 'park');
        fp(-6, -half + 22, W - 22, 18, 'hospital', 4);
        fp(-half + 16, 6, 16, 44, 'hospital', 3);
        fp(half - 16, 6, 16, 44, 'hospital', 3);
        area(6, half - 18, W - 30, 22, 'parking');
        fp(-half + 10, half - 10, 10, 8, 'shed', 1);
        break;
      case 'clinic':
        area(0, 0, W, W, 'yard');
        fp(-8, -10, 34, 16, 'hospital', 2);
        area(0, half - 14, W - 16, 18, 'parking');
        break;
      case 'police':
        fp(0, -half + 12, W - 16, 16, 'police', 3);
        fp(-half + 12, 10, 14, 26, 'garage', 1);
        area(8, 12, W - 34, W - 40, 'parking');
        perimeter(12, 'tenement', 2, 4, 0.5);
        break;
      case 'fire':
        fp(0, -8, 30, 20, 'fire', 2);
        area(0, half - 16, W - 12, 22, 'plaza');
        perimeter(10, 'house', 1, 2, 0.6);
        break;
      case 'school':
        area(0, 0, W, W, 'yard');
        fp(-half + 26, 0, 16, W - 30, 'school', 3);
        fp(6, -half + 14, 34, 14, 'school', 2);
        area(12, 14, W - 50, W - 50, 'sports');
        break;
      case 'park':
        area(0, 0, W, W, 'park');
        if (r() < 0.5) area(0, 0, W * 0.3, W * 0.3, 'lake', true);
        break;
      case 'sports':
        area(0, 0, W, W, 'sports');
        fp(-half + 10, -half + 8, 18, 10, 'shed', 1);
        break;
      case 'cemetery':
        area(0, 0, W, W, 'cemetery');
        fp(0, -half + 10, 10, 8, 'church', 1);
        break;
      case 'gasblock':
        fp(-8, -8, 26, 16, 'canopy', 1);
        fp(18, 16, 16, 10, 'gas', 1);
        area(0, 0, W - 4, W - 4, 'parking');
        perimeter(10, 'house', 1, 2, 0.5);
        break;
      case 'industrial':
        area(0, 0, W, W, 'industrial');
        fp(-8, -6, W * 0.55, W * 0.45, r() < 0.5 ? 'industrial' : 'warehouse', 1);
        fp(half - 16, half - 14, 22, 18, 'warehouse', 1);
        area(-half + 18, half - 14, 28, 20, 'parking');
        break;
      case 'tenement':
        area(0, 0, W - 28, W - 28, 'yard');
        perimeter(13, 'tenement', s.kind === 'city' ? 3 : 2, s.kind === 'city' ? 5 : 3, 0.06);
        break;
      case 'office':
        perimeter(15, 'office', 4, 8, 0.15);
        area(0, 0, W - 34, W - 34, 'parking');
        break;
      case 'shops':
        fp(0, -10, W * 0.6, W * 0.4, 'shop', 1);
        area(0, half - 16, W - 10, 26, 'parking');
        break;
      case 'apartment': {
        area(0, 0, W, W, 'park');
        // Bloki: 2–3 long slabs with green between.
        const rows = W > 80 ? 3 : 2;
        const along = r() < 0.5;
        for (let k = 0; k < rows; k++) {
          const off = -half + (k + 0.5) * (W / rows);
          const len = W - 16 - r() * 18;
          if (along) fp(0, off, len, 12, 'apartment', 4 + Math.floor(r() * 7));
          else fp(off, 0, 12, len, 'apartment', 4 + Math.floor(r() * 7));
        }
        break;
      }
      default: {
        // Detached houses: two rows of plots, house near the street, garden behind.
        const plotsPerRow = Math.max(2, Math.floor(W / (20 + r() * 6)));
        const pw = W / plotsPerRow;
        for (const row of [-1, 1]) {
          for (let k = 0; k < plotsPerRow; k++) {
            const u = -half + (k + 0.5) * pw;
            area(u, (row * half) / 2, pw - 1.5, half - 1, 'yard');
            if (r() < 0.06) continue; // empty lot
            const hw = 9 + r() * 4;
            const hd = 8 + r() * 3;
            fp(
              u + (r() - 0.5) * 2,
              row * (half - 6 - hd / 2),
              Math.min(hw, pw - 5),
              hd,
              'house',
              r() < 0.4 ? 2 : 1,
            );
            if (r() < 0.35) fp(u + pw / 2 - 4.5, row * (half - 9), 5, 6, 'garage', 1);
            else if (r() < 0.3) fp(u, row * (half - 28), 4, 4, 'shed', 1);
          }
        }
      }
    }
  }

  /**
   * Plots along a road from arc length t0 to t1 (both sides): house at the road, yard, barn or
   * shed behind, sometimes an orchard. `centre` puts a church (+ green) as the first building.
   */
  function plotsAlong(
    pts: readonly Pt[],
    t0: number,
    t1: number,
    cls: RoadClass,
    r: () => number,
    centre: boolean,
  ): number {
    let made = 0;
    let church = !centre;
    const L = Math.min(t1, polyLength(pts));
    for (let t = t0; t < L; t += 22 + r() * 12) {
      const { p, dx, dy } = pointAt(pts, t);
      const ang = Math.atan2(dy, dx);
      for (const side of [-1, 1]) {
        if (r() < 0.15) continue;
        const nx = -dy * side;
        const ny = dx * side;
        const off = ROAD_WIDTH[cls] / 2 + 6 + r() * 5;
        const hw = 10 + r() * 3;
        const hd = 8 + r() * 3;
        const hx = p.x + nx * (off + hd / 2);
        const hy = p.y + ny * (off + hd / 2);
        if (!church && t > 40) {
          if (
            place({
              x: hx + nx * 4,
              y: hy + ny * 4,
              w: 30,
              h: 16,
              a: ang,
              kind: 'church',
              floors: 2,
            })
          ) {
            church = true;
            areas.push({ x: hx + nx * 14, y: hy + ny * 14, w: 50, h: 44, a: ang, kind: 'park' });
            continue;
          }
        }
        const roll = r();
        const kind: BuildingKind =
          centre && roll < 0.06
            ? 'shop'
            : centre && roll < 0.09
              ? 'fire'
              : centre && roll < 0.11
                ? 'bar'
                : 'house';
        if (
          !place({
            x: hx,
            y: hy,
            w: kind === 'fire' ? 18 : hw,
            h: hd,
            a: ang,
            kind,
            floors: r() < 0.3 ? 2 : 1,
          })
        )
          continue;
        made++;
        areas.push({
          x: p.x + nx * (off + 22),
          y: p.y + ny * (off + 22),
          w: 22,
          h: 40,
          a: ang,
          kind: 'yard',
        });
        if (r() < 0.45)
          place({
            x: p.x + nx * (off + 32),
            y: p.y + ny * (off + 32),
            w: 18 + r() * 8,
            h: 10,
            a: ang,
            kind: 'barn',
            floors: 1,
          });
        else if (r() < 0.4)
          place({
            x: p.x + nx * (off + 24),
            y: p.y + ny * (off + 24),
            w: 6,
            h: 5,
            a: ang,
            kind: 'shed',
            floors: 1,
          });
        if (r() < 0.12)
          areas.push({
            x: p.x + nx * (off + 66),
            y: p.y + ny * (off + 66),
            w: 26,
            h: 40,
            a: ang,
            kind: 'orchard',
          });
      }
    }
    return made;
  }

  /** Linear village (ulicówka): plots along the roads through it, church, shop, fire station. */
  function village(s: Settlement): void {
    const r = rng(hash3(seed, s.id, 77));
    const reach = s.r * 1.7;
    const through: number[] = [];
    for (let i = 0; i < roads.length; i++) {
      const rd = roads[i] as Road;
      if (rd.cls !== 'main' && rd.cls !== 'local') continue;
      const a = rd.pts[0];
      const z = rd.pts[rd.pts.length - 1];
      if ((a && dist(a, s) < 2) || (z && dist(z, s) < 2)) through.push(i);
    }
    // Side lanes with plots (most villages have one or two).
    for (let k = 0; k < 2; k++) {
      if (r() > (k === 0 ? 0.8 : 0.35)) continue;
      const ang = s.angle + Math.PI / 2 + k * Math.PI + (r() - 0.5) * 0.6;
      const len = 160 + r() * 200;
      const end = { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len };
      const lane = meander({ x: s.x, y: s.y }, end, 0.08, 40, r);
      if (laneFree(lane, 20)) through.push(addRoad('local', lane));
    }
    let first = true;
    for (const ri of through) {
      const rd = roads[ri] as Road;
      const pts = dist(rd.pts[0] as Pt, s) < 2 ? rd.pts : [...rd.pts].reverse();
      plotsAlong(pts, 24, reach, rd.cls, r, first);
      first = false;
    }
  }

  // ---- open country: farms, roadside stops, field tracks ----
  const inSettlement = (x: number, y: number, pad: number) =>
    settlements.some((s) => dist(s, { x, y }) < s.r * (s.kind === 'village' ? 1.8 : 1) + pad);
  const countryRoads = roads
    .map((rd, i) => ({ rd, i }))
    .filter(({ rd }) => rd.cls === 'highway' || rd.cls === 'main' || rd.cls === 'local');
  const lastGas: Pt[] = [];
  for (const { rd } of countryRoads) {
    const L = polyLength(rd.pts);
    const fr = rng(hash3(seed, Math.floor(rd.pts[0]?.x ?? 0), Math.floor(rd.pts[0]?.y ?? 0)));
    // Farmsteads every 250–600 m along local / main roads.
    if (rd.cls !== 'highway') {
      for (let t = 150 + fr() * 300; t < L - 100; t += 190 + fr() * 260) {
        const { p, dx, dy } = pointAt(rd.pts, t);
        const side = fr() < 0.5 ? -1 : 1;
        const nx = -dy * side;
        const ny = dx * side;
        const off = ROAD_WIDTH[rd.cls] / 2 + 40 + fr() * 50;
        const fx = p.x + nx * off;
        const fy = p.y + ny * off;
        if (inSettlement(fx, fy, 120) || isForest(fx, fy) || riverDist(fx, fy) < 80) continue;
        farmstead(fx, fy, Math.atan2(dy, dx), p, fr);
      }
    }
    // Roadside: gas stations on highway / main roads, bars, workshops, motels between.
    if (rd.cls === 'highway' || rd.cls === 'main') {
      for (let t = 800 + fr() * 1200; t < L - 300; t += 1100 + fr() * 1400) {
        const { p, dx, dy } = pointAt(rd.pts, t);
        const side = fr() < 0.5 ? -1 : 1;
        const nx = -dy * side;
        const ny = dx * side;
        const off = ROAD_WIDTH[rd.cls] / 2 + 22;
        const x = p.x + nx * off;
        const y = p.y + ny * off;
        if (inSettlement(x, y, 150) || riverDist(x, y) < 60) continue;
        const ang = Math.atan2(dy, dx);
        const wantGas = lastGas.every((g) => dist(g, p) > 2600);
        if (wantGas) {
          if (roadsideGas(x, y, ang, nx, ny)) {
            lastGas.push(p);
            complexes.push({ kind: 'gas', x, y, settlement: -1 });
          }
        } else {
          const roll = fr();
          const kind: BuildingKind =
            roll < 0.35 ? 'bar' : roll < 0.7 ? 'garage' : roll < 0.85 ? 'warehouse' : 'house';
          const w = kind === 'warehouse' ? 40 : 18;
          const h = kind === 'warehouse' ? 24 : 12;
          const bx = x + nx * (h / 2 + 8);
          const by = y + ny * (h / 2 + 8);
          if (place({ x: bx, y: by, w, h, a: ang, kind, floors: kind === 'house' ? 2 : 1 }))
            areas.push({ x: x + nx * 4, y: y + ny * 4, w: w + 16, h: 10, a: ang, kind: 'parking' });
        }
      }
    }
  }

  function farmstead(fx: number, fy: number, ang: number, roadPt: Pt, r: () => number): void {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const yard: Area = {
      x: fx,
      y: fy,
      w: 60 + r() * 20,
      h: 50 + r() * 16,
      a: ang,
      kind: 'farmyard',
    };
    if (!occ.free(yard, 4)) return;
    const at = (u: number, v: number) => ({ x: fx + u * c - v * s, y: fy + u * s + v * c });
    const toRoad = Math.sign((roadPt.x - fx) * -s + (roadPt.y - fy) * c) || 1;
    const items: [number, number, number, number, BuildingKind][] = [
      [-14, toRoad * 14, 12, 9, 'farmhouse'],
      [12, -toRoad * 12, 30 + r() * 10, 14, 'barn'],
      [-18, -toRoad * 14, 10, 8, 'shed'],
    ];
    if (r() < 0.6) items.push([18, toRoad * 12, 14, 9, 'shed']);
    if (r() < 0.3) items.push([0, -toRoad * 30, 40, 12, 'barn']);
    areas.push(yard);
    for (const [u, v, w, h, kind] of items) {
      const p = at(u, v);
      place({ x: p.x, y: p.y, w, h, a: ang, kind, floors: kind === 'farmhouse' ? 2 : 1 });
    }
    occ.mark(yard);
    if (r() < 0.5) {
      const p = at(-40, 0);
      areas.push({ x: p.x, y: p.y, w: 30, h: 40, a: ang, kind: 'orchard' });
    }
    addRoad('track', [roadPt, { x: fx, y: fy }]);
    // Field track from the yard out across the fields.
    if (r() < 0.6) {
      const len = 300 + r() * 500;
      const away = { x: fx - (roadPt.x - fx), y: fy - (roadPt.y - fy) };
      const d = dist(away, { x: fx, y: fy }) || 1;
      const end = { x: fx + ((away.x - fx) / d) * len, y: fy + ((away.y - fy) / d) * len };
      const lane = meander({ x: fx, y: fy }, end, 0.05, 80, r);
      if (end.x > 0 && end.y > 0 && end.x < size && end.y < size && laneFree(lane, 45))
        addRoad('track', lane);
    }
  }

  function roadsideGas(x: number, y: number, ang: number, nx: number, ny: number): boolean {
    const lot: Area = { x: x + nx * 18, y: y + ny * 18, w: 70, h: 40, a: ang, kind: 'parking' };
    if (!occ.free(lot, 1)) return false;
    areas.push(lot);
    buildings.push({
      x: x + nx * 14,
      y: y + ny * 14,
      w: 28,
      h: 16,
      a: ang,
      kind: 'canopy',
      floors: 1,
    });
    buildings.push({
      x: x + nx * 32 + 0,
      y: y + ny * 32,
      w: 20,
      h: 11,
      a: ang,
      kind: 'gas',
      floors: 1,
    });
    occ.mark(lot);
    return true;
  }

  // ---- hamlets (przysiółki / kolonie): fill open country that is still empty ----
  {
    const C = 400;
    const nC = Math.ceil(size / C);
    const busy = new Uint8Array(nC * nC);
    for (const b of buildings) {
      const cx = Math.floor(b.x / C);
      const cy = Math.floor(b.y / C);
      if (cx >= 0 && cy >= 0 && cx < nC && cy < nC) busy[cy * nC + cx] = 1;
    }
    const hr = rng(hash3(seed, 31, 31));
    for (let cy = 1; cy < nC - 1; cy++)
      for (let cx = 1; cx < nC - 1; cx++) {
        if (busy[cy * nC + cx]) continue;
        const x = (cx + 0.25 + hr() * 0.5) * C;
        const y = (cy + 0.25 + hr() * 0.5) * C;
        if (isForest(x, y, -0.02) || inSettlement(x, y, 200) || riverDist(x, y) < 120) continue;
        if (hr() < 0.25) continue;
        const near = index.nearest(
          x,
          y,
          1100,
          (k) => k === 'main' || k === 'local' || k === 'highway',
        );
        if (!near) continue;
        const roll = hr();
        if (roll < 0.45) {
          // Lone farmstead on its own track.
          const ang = Math.atan2(y - near.y, x - near.x) + Math.PI / 2;
          farmstead(x, y, ang, { x: near.x, y: near.y }, hr);
        } else {
          // Hamlet: a lane with a few plots.
          const lane = route({ x: near.x, y: near.y }, { x, y }, 0.1, 50, new Set());
          if (!laneFree(lane, 16)) continue;
          const li = addRoad(near.d > 450 ? 'local' : 'track', lane);
          const L = polyLength(lane);
          plotsAlong(
            (roads[li] as Road).pts,
            Math.max(30, L - 120 - hr() * 120),
            L + 1,
            'local',
            hr,
            false,
          );
          if (hr() < 0.5)
            farmstead(x + 70, y + 40, Math.atan2(y - near.y, x - near.x), { x, y }, hr);
        }
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) busy[(cy + j) * nC + cx + i] = 1;
      }
  }

  // ---- forests: paths, forest roads, glades, hunters' huts, forester's lodges; lakes ----
  const fr = rng(hash3(seed, 9, 9));
  const step = 480;
  const grid = Math.floor(size / step);
  const fpts: (Pt | undefined)[] = [];
  for (let j = 0; j < grid; j++)
    for (let i = 0; i < grid; i++) {
      const x = (i + 0.2 + fr() * 0.6) * step;
      const y = (j + 0.2 + fr() * 0.6) * step;
      const ok = isForest(x, y, 0.015) && !inSettlement(x, y, 200) && riverDist(x, y) > 60;
      fpts.push(ok && !hitsBase([{ x, y }]) ? { x, y } : undefined);
    }
  for (let j = 0; j < grid; j++)
    for (let i = 0; i < grid; i++) {
      const p = fpts[j * grid + i];
      if (!p) continue;
      const near = index.nearest(p.x, p.y, 1500, (c) => c !== 'path' && c !== 'rail');
      const forestRoad = (cls: RoadClass, pts: Pt[]) => {
        if (!hitsBase(pts)) addRoad(cls, pts);
      };
      if (near && fr() < 0.55)
        forestRoad(
          near.d > 500 ? 'track' : 'path',
          meander(p, { x: near.x, y: near.y }, 0.18, 50, fr),
        );
      const e = i + 1 < grid ? fpts[j * grid + i + 1] : undefined;
      const sth = j + 1 < grid ? fpts[(j + 1) * grid + i] : undefined;
      if (e && fr() < 0.7) forestRoad('path', meander(p, e, 0.2, 50, fr));
      if (sth && fr() < 0.7) forestRoad('path', meander(p, sth, 0.2, 50, fr));
      const roll = fr();
      if (roll < 0.35) {
        const gr = 25 + fr() * 50;
        areas.push({
          x: p.x,
          y: p.y,
          w: gr * 2,
          h: gr * 1.6,
          a: fr() * 3,
          kind: 'glade',
          round: true,
        });
        if (fr() < 0.45)
          place({ x: p.x + gr * 0.3, y: p.y, w: 5, h: 4, a: fr() * 3, kind: 'hut', floors: 1 });
      } else if (roll < 0.4 && near && near.d < 900) {
        // Leśniczówka: forester's house with a barn on a clearing.
        areas.push({ x: p.x, y: p.y, w: 90, h: 70, a: 0, kind: 'glade', round: true });
        place({ x: p.x, y: p.y - 8, w: 12, h: 9, a: 0, kind: 'house', floors: 2 });
        place({ x: p.x + 16, y: p.y + 14, w: 16, h: 9, a: 0, kind: 'barn', floors: 1 });
      }
    }
  for (let k = 0, made = 0; k < 200 && made < Math.max(2, Math.round(5 * A)); k++) {
    const x = 800 + fr() * (size - 1600);
    const y = 800 + fr() * (size - 1600);
    const w = 160 + fr() * 380;
    const lake: Area = {
      x,
      y,
      w,
      h: w * (0.45 + fr() * 0.4),
      a: fr() * 3,
      kind: 'lake',
      round: true,
    };
    if (inSettlement(x, y, w) || !occ.free(lake, 20)) continue;
    areas.push(lake);
    occ.mark(lake);
    made++;
  }

  return {
    version: WORLD_PLAN_VERSION,
    seed,
    size,
    chunks: size / CHUNK_SIZE,
    river,
    riverWidth,
    settlements,
    roads,
    buildings,
    areas,
    complexes,
    forestThreshold,
  };
}

const blockSize = (s: Settlement): number => (s.kind === 'city' ? 96 : 84);

/** Re-export for tests and the renderer. */
export { rand3 };
