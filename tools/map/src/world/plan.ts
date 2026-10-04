import { CHUNK_SIZE } from '@deadzone/content';
import {
  dist,
  inORect,
  oRectCorners,
  oRectsOverlap,
  meander,
  PolylineIndex,
  oRectBounds,
  pointAt,
  polyLength,
  segCross,
  segDist,
  type ORect,
  type Pt,
} from './geom.js';
import { frontage, planOldTown, ringHit, squareEdges, type OldTown } from './oldtown.js';
import { fbm, hash3, rand3, rng, valueNoise } from './rng.js';
import { fieldRegion, GroundField, isFarmland } from './ground.js';
import { clearFeatures, farmlandMask, largestOpenSquare, OPEN_CELL } from './openland.js';
import { baseHeight, traceRiver } from './terrain.js';

/**
 * World macro plan (Silnik 2 generator, step 1): from (seed, size) the whole map's layout —
 * terrain (`terrain.ts`), a river traced downhill across the map with bridges wherever a road or
 * the railway crosses it, lakes in the basins (two with holiday resorts), named cities / towns /
 * villages (cities and towns: an irregular old town inside the street grid, `oldtown.ts`; the
 * main city on the river), zoned from the centre out (old town, tenement quarters, housing
 * estates, detached houses, allotment gardens, then fields), linear villages along the roads,
 * the road hierarchy, complexes (hospital, police, military base in the northern forests),
 * farms, roadside stops, forest paths and glades — as cheap vector data.
 * Chunk filling (tiles, walls, furniture) reads this plan later; nothing here is game data yet.
 *
 * Pure: depends only on (seed, size, WORLD_PLAN_VERSION).
 */
export const WORLD_PLAN_VERSION = 'plan-3';
/** Target world: 16 384 m = 512 × 512 chunks. */
export const DEFAULT_WORLD_SIZE = 16384;
/** Fallback when the sim's save can't hold the big world. */
export const FALLBACK_WORLD_SIZE = 8192;

export type SettlementKind = 'city' | 'town' | 'village';
export interface Settlement {
  id: number;
  kind: SettlementKind;
  /** Place name (designer's names first: Wolnogród, Lipowiec, Rudnik, …). */
  name: string;
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
  | 'block'
  /** Allotment gardens (ogródki działkowe, ROD) on a town's edge. */
  | 'allotment'
  /** Sand beach of a lake resort. */
  | 'beach'
  /** Copse (zagajnik) or clump of trees (kępa śródpolna) among the fields. */
  | 'copse';
export interface Area extends ORect {
  kind: AreaKind;
  /** Lakes: their name. */
  name?: string;
  /** Ellipse instead of a rectangle. */
  round?: boolean;
}

export type ComplexKind =
  'hospital' | 'police' | 'military' | 'industrial' | 'gas' | 'station' | 'resort' | 'farm';
export interface Complex {
  kind: ComplexKind;
  /** Proper name where it has one (Szpital powiatowy, JW 2417, PGR Borki, …). */
  name?: string;
  x: number;
  y: number;
  /** Settlement it belongs to (−1 = open country). */
  settlement: number;
}

/** A road or the railway over the river: deck centre, angle along the road, span and width. */
export interface Bridge extends ORect {
  cls: RoadClass;
  /** Index into `roads`. */
  road: number;
}

/** A row of trees along a road (aleja) or of shrubs on a field balk (miedza z krzakami). */
export interface TreeLine {
  kind: 'avenue' | 'balk';
  /** One point per tree / bush. */
  pts: Pt[];
}

export interface WorldPlan {
  version: string;
  seed: number;
  size: number;
  chunks: number;
  river: Pt[];
  riverWidth: number;
  riverName: string;
  /** Where the river leaves the map (terrain tilts toward it, `terrain.ts`). */
  riverMouth: Pt;
  bridges: Bridge[];
  /** Settlement the player starts in (Lipowiec). */
  start: number;
  settlements: Settlement[];
  roads: Road[];
  buildings: Footprint[];
  areas: Area[];
  complexes: Complex[];
  /** Avenues of trees and shrubby balks in the country. */
  treeLines: TreeLine[];
  /** Forest noise threshold (forest where `forestNoise > forestThreshold`). */
  forestThreshold: number;
}

/**
 * Forest density noise at a point; forest where it exceeds the plan threshold. Biased to the
 * north (big forests there, around the military base), fields to the south.
 */
export function forestNoise(seed: number, x: number, y: number, size: number): number {
  return (
    fbm(seed + 7, x / 2600, y / 2600, 5) * 0.92 +
    valueNoise(seed + 9, x / 260, y / 260) * 0.08 +
    0.16 * (0.5 - y / size)
  );
}

/** Designer's names first (world-map.json), then more of the same kind. */
const NAMES: Record<SettlementKind, string[]> = {
  city: ['Wolnogród', 'Borowiec'],
  town: [
    'Lipowiec',
    'Rudnik',
    'Sokolniki',
    'Stary Dwór',
    'Jabłonna',
    'Zbąszyce',
    'Krasnystaw Mały',
  ],
  village: [
    'Dębowa Wola',
    'Kamionka',
    'Olszynki',
    'Zagrodno',
    'Dąbrówka',
    'Zalesie',
    'Brzezinki',
    'Olszanka',
    'Kępa',
    'Podlesie',
    'Grabowiec',
    'Wierzbica',
    'Jeżów',
    'Sośnica',
    'Lipnik',
    'Modrzewie',
    'Łąki',
    'Topola',
    'Bukowiec',
    'Czarnocin',
    'Głęboczek',
    'Jaworze',
    'Kalinówka',
    'Łozina',
    'Mokre',
    'Nowa Wieś',
    'Osiny',
    'Piaski',
    'Rososz',
    'Strzyżów',
    'Trzciniec',
    'Wrzosowo',
    'Zbójno',
    'Żabno',
    'Kłodno',
    'Ostrówek',
    'Sitno',
    'Babice',
    'Chojno',
    'Dobra',
    'Gaj',
    'Kruszyn',
    'Lisów',
    'Pniewo',
    'Rudka',
    'Sadki',
    'Wilkowo',
    'Bór',
    'Krzywda',
    'Ruda',
  ],
};
const nameFor = (kind: SettlementKind, k: number): string =>
  NAMES[kind][k] ??
  `${NAMES[kind][k % NAMES[kind].length]} ${Math.floor(k / NAMES[kind].length) + 1}`;

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

  /** Re-routes road `roadIdx` (its old segments drop out of the index). */
  replace(roadIdx: number, pts: Pt[]): void {
    const r = this.roads[roadIdx];
    if (!r) return;
    for (let o = 4; o < this.segs.length; o += 5) if (this.segs[o] === roadIdx) this.segs[o] = -1;
    r.pts = pts;
    this.add(roadIdx);
  }

  /** Whether any road other than `self` passes within `r` of (x, y). */
  touches(x: number, y: number, r: number, self: number): boolean {
    const c0 = Math.floor((x - r) / this.cell);
    const c1 = Math.floor((x + r) / this.cell);
    const r0 = Math.floor((y - r) / this.cell);
    const r1 = Math.floor((y + r) / this.cell);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++)
        for (const sg of this.cells.get(cy * 65536 + cx) ?? []) {
          const o = sg * 5;
          const road = this.segs[o + 4] ?? -1;
          if (road === self || road < 0) continue;
          const h = segDist(
            x,
            y,
            this.segs[o] ?? 0,
            this.segs[o + 1] ?? 0,
            this.segs[o + 2] ?? 0,
            this.segs[o + 3] ?? 0,
          );
          if (h.d <= r) return true;
        }
    return false;
  }

  /** Nearest point on a road other than `self` within `maxR` (optionally only some classes). */
  nearestExcept(
    x: number,
    y: number,
    maxR: number,
    self: number,
    accept?: (cls: RoadClass) => boolean,
  ): { d: number; x: number; y: number; road: number } | undefined {
    let best: { d: number; x: number; y: number; road: number } | undefined;
    const c0 = Math.floor((x - maxR) / this.cell);
    const c1 = Math.floor((x + maxR) / this.cell);
    const r0 = Math.floor((y - maxR) / this.cell);
    const r1 = Math.floor((y + maxR) / this.cell);
    for (let cy = r0; cy <= r1; cy++)
      for (let cx = c0; cx <= c1; cx++)
        for (const sg of this.cells.get(cy * 65536 + cx) ?? []) {
          const o = sg * 5;
          const road = this.segs[o + 4] ?? 0;
          if (road === self || road < 0) continue;
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
    return best;
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
          const road = this.segs[o + 4] ?? -1;
          if (road < 0 || (accept && !accept(this.roads[road]?.cls ?? 'path'))) continue;
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
  /** Lakes placed so far (ellipses); later tracks and paths keep out of them. */
  const lakes: Area[] = [];
  const inLake = (x: number, y: number, margin: number): boolean =>
    lakes.some((l) => {
      const c = Math.cos(l.a);
      const sn = Math.sin(l.a);
      const u = ((x - l.x) * c + (y - l.y) * sn) / (l.w / 2 + margin);
      const v = (-(x - l.x) * sn + (y - l.y) * c) / (l.h / 2 + margin);
      return u * u + v * v <= 1;
    });
  /** Field tracks and forest paths don't get bridges: one that would cross water isn't built. */
  const wetCrossing = (pts: readonly Pt[]): boolean => {
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1] as Pt;
      const b = pts[k] as Pt;
      if (riverIndex.crossings(a, b).length > 0) return true;
      if (lakes.length === 0) continue;
      const n = Math.ceil(dist(a, b) / 8);
      for (let i = 0; i <= n; i++)
        if (inLake(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, 4)) return true;
    }
    return false;
  };
  /** Adds a road; returns its index, or −1 for a track / path that would cross water. */
  const addRoad = (cls: RoadClass, pts: Pt[]): number => {
    if ((cls === 'track' || cls === 'path') && wetCrossing(pts)) return -1;
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
  /** Like laneFree, but only the last `tail` metres (the junction) may touch other roads. */
  const laneClear = (pts: readonly Pt[], skip: number, tail: number): boolean => {
    const L = polyLength(pts);
    for (let t = skip; t < L; t += 4) {
      const { p } = pointAt(pts, t);
      if (!occ.free({ x: p.x, y: p.y, w: 8, h: 8, a: 0 }, 0) && (t < L - tail || !onRoad(p)))
        return false;
    }
    return true;
  };
  const onRoad = (p: Pt): boolean => (index.nearest(p.x, p.y, 14)?.d ?? 99) < 12;

  // Forest threshold: ~32 % of the map (Polish lowland average ~30 %).
  const samples: number[] = [];
  for (let i = 0; i < 4096; i++)
    samples.push(forestNoise(seed, rand() * size, rand() * size, size));
  samples.sort((a, b) => a - b);
  const forestThreshold = samples[Math.floor(samples.length * 0.68)] ?? 0.5;
  const isForest = (x: number, y: number, bias = 0) =>
    forestNoise(seed, x, y, size) > forestThreshold + bias;

  // River (Sołwia): from the north edge downhill to the mouth, meandering (`terrain.ts`).
  const riverWidth = 34;
  const traced = traceRiver(seed, size, rng(hash3(seed, 2, 0)));
  const river = traced.pts;
  const riverL = polyLength(river);
  for (let k = 1; k < river.length; k++)
    occ.markSegment(river[k - 1] as Pt, river[k] as Pt, riverWidth + 16);
  const riverIndex = new PolylineIndex(river);
  const riverDist = (x: number, y: number): number => riverIndex.dist(x, y);

  // Settlements. Cities on the river (it runs through their grid; the old town stays dry, off
  // it by OLD_TOWN_OFFSET × r), the first towns near it, villages anywhere dry and open.
  const settlements: Settlement[] = [];
  const counts: [SettlementKind, number, number, number][] = [
    // kind, count, radius min, radius max
    ['city', Math.max(1, Math.round(2 * A)), 760, 980],
    ['town', Math.max(2, Math.round(5 * A)), 300, 430],
    ['village', Math.max(6, Math.round(40 * A)), 120, 190],
  ];
  const gapTo: Record<SettlementKind, number> = { city: 2400, town: 1400, village: 900 };
  const OLD_TOWN_OFFSET = 0.42;
  for (const [kind, n, r0, r1] of counts) {
    let placed = 0;
    for (let tries = 0; placed < n && tries < 6000; tries++) {
      const r = r0 + rand() * (r1 - r0);
      const margin = kind === 'village' ? 500 : r + 900;
      // Riverside spot: a river point, then off it to one side.
      const riverside =
        kind === 'city' ? tries < 4000 : kind === 'town' && placed < 2 && tries < 2000;
      let x = margin + rand() * (size - 2 * margin);
      let y = margin + rand() * (size - 2 * margin);
      if (riverside) {
        const { p, dx, dy } = pointAt(river, riverL * (0.12 + rand() * 0.76));
        const side = rand() < 0.5 ? -1 : 1;
        const off =
          r * OLD_TOWN_OFFSET + riverWidth / 2 + 10 + rand() * r * (kind === 'town' ? 0.8 : 0.15);
        x = p.x - dy * side * off;
        y = p.y + dx * side * off;
        if (x < margin || y < margin || x > size - margin || y > size - margin) continue;
      }
      if (kind !== 'village' && isForest(x, y, -0.03)) continue;
      if (kind === 'village' && isForest(x, y, 0.02)) continue;
      const rd = riverDist(x, y);
      if (rd < (kind === 'village' ? r + 60 : r * OLD_TOWN_OFFSET + riverWidth / 2 + 8)) continue;
      const ok = settlements.every(
        (s) => dist(s, { x, y }) > s.r + r + Math.max(gapTo[s.kind], gapTo[kind]),
      );
      if (!ok) continue;
      settlements.push({
        id: settlements.length,
        kind,
        name: nameFor(kind, placed),
        x,
        y,
        r,
        angle: (rand() - 0.5) * 0.5 + (rand() < 0.5 ? 0 : Math.PI / 2),
      });
      placed++;
    }
  }
  const start = settlements.find((s) => s.kind === 'town')?.id ?? 0;

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
        // First choice in the northern half (the big forests).
        if (!far || riverDist(x, y) < 700 || (relax === 1 && y > size * 0.5)) continue;
        const score = forestNoise(seed, x, y, size);
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
  const oldTowns = new Map<number, OldTown>();
  const connectorsOf = new Map<number, Pt[][]>();
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
    const ot = planOldTown({
      seed,
      id: s.id,
      x: s.x,
      y: s.y,
      r: s.r,
      angle: s.angle,
      city: s.kind === 'city',
    });
    oldTowns.set(s.id, ot);
    const inOld = (u: number, v: number) => {
      const p = toW(u, v);
      const ang = Math.atan2(p.y - s.y, p.x - s.x);
      return Math.hypot(p.x - s.x, p.y - s.y) <= ot.ringAt(ang) + ROAD_WIDTH.street;
    };
    const n = Math.ceil((s.r * 1.15) / bs) + 1;
    const dryC = (p: Pt) => riverDist(p.x, p.y) > riverWidth / 2 + ROAD_WIDTH.main / 2 + 2;
    /** All of a–b on dry land, except within `skip` m of `hole` (a bridge's span). */
    const dryRun = (a: Pt, b: Pt, hole?: Pt, skip = 0): boolean => {
      const steps = Math.ceil(dist(a, b) / 6);
      for (let q = 0; q <= steps; q++) {
        const p = { x: a.x + ((b.x - a.x) * q) / steps, y: a.y + ((b.y - a.y) * q) / steps };
        if (hole && dist(p, hole) < skip) continue;
        if (!dryC(p)) return false;
      }
      return true;
    };
    const blocks: Block[] = [];
    const used = new Set<string>();
    const meadow = new Set<string>();
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
        // The old town takes everything inside its ring (plus a street's width).
        if (
          [
            [u0, v0],
            [u0 + bs, v0],
            [u0, v0 + bs],
            [u0 + bs, v0 + bs],
            [u0 + bs / 2, v0 + bs / 2],
          ].some(([cu = 0, cv = 0]) => inOld(cu, cv))
        )
          continue;
        const u = u0 + bs / 2;
        const v = v0 + bs / 2;
        const inner = bs - ROAD_WIDTH.street - 10;
        // The river: no block in or by the water (bank meadows); the main axes cross it on
        // bridges (below), the rest end on the quays.
        const c0 = toW(u, v);
        if (riverDist(c0.x, c0.y) < bs * 0.71 + riverWidth / 2 + ROAD_WIDTH.main / 2 + 4) {
          const every = 2;
          // A meadow edge stays when it's all on land and doesn't cross the river.
          const edge = (key: string, a: Pt, b: Pt) => {
            if (!dryC(a) || !dryC(b)) return;
            if (dryRun(a, b) && riverIndex.crossings(a, b).length === 0) {
              used.add(key);
              meadow.add(key);
            }
          };
          if (i % every === 0) edge(`v${i},${j}`, toW(u0, v0), toW(u0, v0 + bs));
          if ((i + 1) % every === 0)
            edge(`v${i + 1},${j}`, toW(u0 + bs, v0), toW(u0 + bs, v0 + bs));
          if (j % every === 0) edge(`h${i},${j}`, toW(u0, v0), toW(u0 + bs, v0));
          if ((j + 1) % every === 0)
            edge(`h${i},${j + 1}`, toW(u0, v0 + bs), toW(u0 + bs, v0 + bs));
          continue;
        }
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
    // Bridges on the main axes only (every 4th grid line: 336–384 m apart): one straight span
    // from the last dry corner on one bank to the first on the other, where streets reach both.
    const keyOf = (horiz: boolean, line: number, k: number) =>
      horiz ? `h${k},${line}` : `v${line},${k}`;
    const reached = (horiz: boolean, line: number, k: number): boolean => {
      const [ci, cj] = horiz ? [k, line] : [line, k];
      return [`h${ci - 1},${cj}`, `h${ci},${cj}`, `v${ci},${cj - 1}`, `v${ci},${cj}`].some((e) =>
        used.has(e),
      );
    };
    for (const horiz of [true, false])
      for (let line = -n; line <= n + 1; line++) {
        if (line % 4 !== 0) continue;
        const at = (k: number): Pt => (horiz ? toW(k * bs, line * bs) : toW(line * bs, k * bs));
        const land = (k: number): boolean => {
          const [cu, cv] = horiz ? [k * bs, line * bs] : [line * bs, k * bs];
          return dryC(at(k)) && inside(cu, cv) && !inOld(cu, cv);
        };
        for (let k = -n; k <= n; k++) {
          if (!land(k)) continue;
          let m = k + 1;
          while (m <= n + 1 && m - k <= 4 && !dryC(at(m))) m++;
          if (m - k > 4 || !land(m)) continue;
          const xs = riverIndex.crossings(at(k), at(m));
          if (xs.length !== 1) continue;
          // Square enough to the river (|sin| ≥ 0.5), and on land either side of the span.
          const x0 = xs[0] as { x: number; y: number; seg: number };
          const r0 = river[x0.seg - 1] as Pt;
          const r1 = river[x0.seg] as Pt;
          const ra = Math.atan2(r1.y - r0.y, r1.x - r0.x);
          const sa = Math.atan2(at(m).y - at(k).y, at(m).x - at(k).x);
          const sin = Math.abs(Math.sin(sa - ra));
          if (sin < 0.5) continue;
          if (!dryRun(at(k), at(m), x0, (riverWidth / 2 + ROAD_WIDTH.main / 2 + 2) / sin + 3))
            continue;
          if (!reached(horiz, line, k) || !reached(horiz, line, m)) continue;
          for (let q = k; q < m; q++) used.add(keyOf(horiz, line, q));
          k = m - 1;
        }
      }
    // Bank streets cut off from the grid by the river (no block, no bridge) aren't built.
    {
      const parent = new Map<string, string>();
      const find = (k: string): string => {
        let r = k;
        while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as string;
        parent.set(k, r);
        return r;
      };
      const ends = (e: string): [string, string] => {
        const [ci, cj] = e.slice(1).split(',').map(Number) as [number, number];
        return [`${ci},${cj}`, e[0] === 'h' ? `${ci + 1},${cj}` : `${ci},${cj + 1}`];
      };
      for (const e of used) {
        const [a, b] = ends(e);
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
        parent.set(find(a), find(b));
      }
      const anchored = new Set<string>();
      for (const e of used) if (!meadow.has(e)) anchored.add(find(ends(e)[0]));
      for (const e of meadow) if (!anchored.has(find(ends(e)[0]))) used.delete(e);
    }
    blocksOf.set(s.id, blocks);
    const corners: Pt[] = [];
    for (const [k, nUse] of cornerUse)
      if (nUse < 4) {
        const [ci, cj] = k.split(',').map(Number) as [number, number];
        corners.push(toW(ci * bs, cj * bs));
      }
    cornersOf.set(s.id, corners);
    const firstRoad = roads.length;
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
    // Old town streets: ring on the old walls, inner lane loop, around the square, radials.
    addRoad(s.kind === 'city' ? 'main' : 'street', ot.ring);
    if (ot.innerRing.length > 0) addRoad('street', ot.innerRing);
    addRoad('street', squareEdges(ot.square));
    for (const rd of ot.radials) addRoad('street', rd);
    // Grid streets cut by the old town end at its ring.
    const connectors: Pt[][] = [];
    connectorsOf.set(s.id, connectors);
    for (const [k, nUse] of cornerUse) {
      if (nUse >= 4) continue;
      const [ci, cj] = k.split(',').map(Number) as [number, number];
      const p = toW(ci * bs, cj * bs);
      const ang = Math.atan2(p.y - s.y, p.x - s.x);
      if (Math.hypot(p.x - s.x, p.y - s.y) > ot.ringAt(ang) + bs * 1.1) continue;
      const q = ringHit(ot, p);
      if (q && dist(p, q) > 3) {
        addRoad('street', [p, q]);
        connectors.push([p, q]);
      }
    }
    if (riverDist(s.x, s.y) < s.r * 1.3) quays(s, bs, firstRoad, inside, inOld, blocks);
  }

  /**
   * Quays (bulwary) along both banks through a city or town, and every grid street that would
   * otherwise stop dead on the bank carried on to the quay: no street ends at the water.
   */
  function quays(
    s: Settlement,
    bs: number,
    firstRoad: number,
    inside: (u: number, v: number) => boolean,
    inOld: (u: number, v: number) => boolean,
    blocks: readonly Block[],
  ): void {
    const off = riverWidth / 2 + QUAY_OFFSET;
    const c = Math.cos(-s.angle);
    const sn = Math.sin(-s.angle);
    const toUV = (p: Pt): [number, number] => [
      (p.x - s.x) * c - (p.y - s.y) * sn,
      (p.x - s.x) * sn + (p.y - s.y) * c,
    ];
    // Within the built-up outline (plus half a block: the grid's last corners), off the old town.
    const onLand = (p: Pt): boolean => {
      const [u, v] = toUV(p);
      const ang = Math.atan2(p.y - s.y, p.x - s.x);
      return (
        Math.hypot(p.x - s.x, p.y - s.y) <= outline(s, ang) + bs * 0.6 &&
        !inOld(u, v) &&
        riverDist(p.x, p.y) > off - 2
      );
    };
    const lines: Pt[][] = [];
    for (const side of [-1, 1]) {
      let run: Pt[] = [];
      const flush = () => {
        if (run.length >= 2 && polyLength(run) > bs * 0.8) lines.push(run);
        run = [];
      };
      for (let k = 0; k < river.length; k++) {
        const a = river[Math.max(0, k - 1)] as Pt;
        const b = river[Math.min(river.length - 1, k + 1)] as Pt;
        const l = Math.max(1e-6, dist(a, b));
        const r = river[k] as Pt;
        const p = {
          x: r.x - ((b.y - a.y) / l) * off * side,
          y: r.y + ((b.x - a.x) / l) * off * side,
        };
        if (Math.hypot(p.x - s.x, p.y - s.y) < s.r * 1.3 && onLand(p)) run.push(p);
        else flush();
      }
      flush();
    }
    // A link stays on land and off the blocks.
    const clearPath = (p: Pt, h: Pt): boolean => {
      if (riverIndex.crossings(p, h).length > 0) return false;
      const n = Math.ceil(dist(p, h) / 4);
      for (let k = 1; k < n; k++) {
        const x = p.x + ((h.x - p.x) * k) / n;
        const y = p.y + ((h.y - p.y) * k) / n;
        if (riverDist(x, y) < riverWidth / 2 + 2) return false;
        if (blocks.some((b) => inORect(b.rect, x, y, 1))) return false;
      }
      return true;
    };
    // Streets that stop dead on the bank: carried on, straight, to the quay they point at (or,
    // with no quay ahead, to the nearest other street).
    interface Dead {
      p: Pt;
      road: number;
      cls: RoadClass;
      hit?: Pt | undefined;
      line?: number;
      at?: number;
    }
    const dead: Dead[] = [];
    const last = roads.length;
    for (let i = firstRoad; i < last; i++) {
      const rd = roads[i] as Road;
      if (rd.cls !== 'street' && rd.cls !== 'main') continue;
      const pts = rd.pts;
      for (const end of [0, 1]) {
        const p = (end ? pts[pts.length - 1] : pts[0]) as Pt;
        const prev = end ? pts[pts.length - 2] : pts[1];
        if (!prev || riverDist(p.x, p.y) > DEAD_END_REACH || index.touches(p.x, p.y, 1.5, i))
          continue;
        const d: Dead = { p, road: i, cls: rd.cls };
        const l = dist(prev, p);
        const far = {
          x: p.x + ((p.x - prev.x) / l) * bs * 1.5,
          y: p.y + ((p.y - prev.y) / l) * bs * 1.5,
        };
        let ht = Infinity;
        lines.forEach((q, li) => {
          for (let k = 1; k < q.length; k++) {
            const h = segCross(p, far, q[k - 1] as Pt, q[k] as Pt);
            if (h && h.t < ht && clearPath(p, h)) {
              ht = h.t;
              d.hit = { x: h.x, y: h.y };
              d.line = li;
              d.at = k - 1 + h.u;
            }
          }
        });
        dead.push(d);
      }
    }
    // Each quay runs between the first and the last street that meets it (no loose ends).
    const cityRoads = roads.slice(firstRoad, last);
    lines.forEach((q, li) => {
      const ats = dead.filter((d) => d.line === li).map((d) => d.at as number);
      for (let k = 1; k < q.length; k++)
        for (const rd of cityRoads)
          for (let j = 1; j < rd.pts.length; j++) {
            const h = segCross(q[k - 1] as Pt, q[k] as Pt, rd.pts[j - 1] as Pt, rd.pts[j] as Pt);
            if (h) ats.push(k - 1 + h.t);
          }
      const a0 = Math.min(...ats);
      const a1 = Math.max(...ats);
      if (ats.length < 2 || a1 - a0 < 1e-6) {
        for (const d of dead) if (d.line === li) d.hit = undefined;
        return;
      }
      const at = (a: number): Pt => {
        const k = Math.min(q.length - 2, Math.floor(a));
        const pa = q[k] as Pt;
        const pb = q[k + 1] as Pt;
        const t = a - k;
        return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
      };
      const cut = [at(a0), ...q.slice(Math.floor(a0) + 1, Math.ceil(a1)), at(a1)];
      addRoad('street', cut);
    });
    for (const d of dead) {
      if (!d.hit) {
        const nb = index.nearestExcept(
          d.p.x,
          d.p.y,
          bs,
          d.road,
          (cl) => cl === 'street' || cl === 'main',
        );
        if (nb && clearPath(d.p, nb)) d.hit = { x: nb.x, y: nb.y };
      }
      if (d.hit) {
        if (dist(d.p, d.hit) > 0.5) addRoad(d.cls, [d.p, d.hit]);
        continue;
      }
      trimBack(d.road, d.p);
    }
    // Cutting or dropping a spur can leave another end loose: tidy up until none is left.
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let i = firstRoad; i < roads.length; i++) {
        const rd = roads[i] as Road;
        if ((rd.cls !== 'street' && rd.cls !== 'main') || rd.pts.length < 2) continue;
        for (const p of [rd.pts[0] as Pt, rd.pts[rd.pts.length - 1] as Pt])
          if (riverDist(p.x, p.y) <= DEAD_END_REACH && !index.touches(p.x, p.y, 1.5, i)) {
            trimBack(i, p);
            changed = true;
            break;
          }
      }
      if (!changed) break;
    }

    /** Cuts road `ri` back from its loose end `p` to its last junction (or drops it). */
    function trimBack(ri: number, p: Pt): void {
      const rd = roads[ri] as Road;
      const fromEnd = dist(rd.pts[rd.pts.length - 1] as Pt, p) < 1e-6;
      const pts = fromEnd ? [...rd.pts].reverse() : [...rd.pts];
      let cut: { k: number; p: Pt } | undefined;
      for (let k = 1; k < pts.length && !cut; k++) {
        let best = Infinity;
        const a = pts[k - 1] as Pt;
        const b = pts[k] as Pt;
        for (let j = firstRoad; j < roads.length; j++) {
          if (j === ri) continue;
          const o = roads[j] as Road;
          for (let q = 1; q < o.pts.length; q++) {
            const h = segCross(a, b, o.pts[q - 1] as Pt, o.pts[q] as Pt);
            if (h && h.t * dist(a, b) > 0.5 && h.t < best) {
              best = h.t;
              cut = { k, p: { x: h.x, y: h.y } };
            }
          }
          // Another street ending on this one (a T) is a junction too.
          for (const e of [o.pts[0], o.pts[o.pts.length - 1]]) {
            if (!e) continue;
            const h = segDist(e.x, e.y, a.x, a.y, b.x, b.y);
            if (h.d < 1.5 && h.t * dist(a, b) > 0.5 && h.t < best) {
              best = h.t;
              cut = { k, p: { x: h.x, y: h.y } };
            }
          }
        }
      }
      const kept = cut ? [cut.p, ...pts.slice(cut.k)] : [];
      // A spur with no junction left on it isn't built at all.
      if (kept.length >= 2 && polyLength(kept) > 1)
        index.replace(ri, fromEnd ? kept.reverse() : kept);
      else index.replace(ri, []);
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
      const R = c.r * 1.14 + 40;
      // Opposite the highway; turned round the city until the station and its yard are dry.
      const a0 = Math.atan2(c.y - hw.y, c.x - hw.x);
      let p = { x: c.x + Math.cos(a0) * R, y: c.y + Math.sin(a0) * R };
      for (let k = 1; k < 24 && riverDist(p.x, p.y) < riverWidth / 2 + 120; k++) {
        const a = a0 + Math.ceil(k / 2) * 0.26 * (k % 2 ? 1 : -1);
        p = { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R };
      }
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
    complexes.push({
      kind: 'station',
      name: `${st.s.name} PKP`,
      x: p.x,
      y: p.y,
      settlement: st.s.id,
    });
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
    complexes.push({ kind: 'military', name: 'JW 2417', x: base.x, y: base.y, settlement: -1 });
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

  // ---- lakes in the terrain's basins (in forests, by villages): two big ones with holiday
  // resorts, smaller ones after them ----
  {
    const lr = rng(hash3(seed, 0x1a4e, 3));
    const hgt = (x: number, y: number) => baseHeight(seed, size, x, y, traced.mouth);
    const G = 200;
    const basins: { x: number; y: number; depth: number }[] = [];
    for (let y = G * 3; y < size - G * 3; y += G)
      for (let x = G * 3; x < size - G * 3; x += G) {
        const h0 = hgt(x, y);
        let ring = 0;
        let lowest = true;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const hq = hgt(x + Math.cos(a) * G * 1.6, y + Math.sin(a) * G * 1.6);
          if (hq < h0) lowest = false;
          ring += hq;
        }
        if (lowest) basins.push({ x, y, depth: ring / 8 - h0 });
      }
    basins.sort((a, b) => b.depth - a.depth || a.y - b.y || a.x - b.x);
    const villages = settlements.filter((v) => v.kind === 'village');
    const nearVillage = (x: number, y: number) => villages.some((v) => dist(v, { x, y }) < 1800);
    const LAKE_NAMES = ['Jezioro Czarne', 'Jezioro Białe'];
    const RESORT_NAMES = ['Ośrodek wypoczynkowy „Zacisze”', 'Ośrodek wypoczynkowy „Słoneczko”'];
    const smallWanted = Math.max(3, Math.round(6 * A));
    let big = 0;
    let small = 0;
    for (const pass of [0, 1])
      for (const b of basins) {
        if (big >= 2 && small >= smallWanted) break;
        if (riverDist(b.x, b.y) < 550) continue;
        if (base && dist(base, b) < 1000) continue;
        if (settlements.some((t) => dist(t, b) < t.r * (t.kind === 'village' ? 1.7 : 1.3) + 250))
          continue;
        if (pass === 0 && !isForest(b.x, b.y, -0.05) && !nearVillage(b.x, b.y)) continue;
        if (lakes.some((l) => dist(l, b) < 900)) continue;
        const farFromNamed = lakes.every((l) => !l.name || dist(l, b) > Math.min(3500, size * 0.3));
        const isBig = big < 2 && farFromNamed;
        if (!isBig && small >= smallWanted) continue;
        const a = lr() * Math.PI;
        const ratio = 0.55 + lr() * 0.25;
        let lake: Area | undefined;
        for (let w = isBig ? 1150 : 420; w >= (isBig ? 520 : 160); w -= isBig ? 90 : 40) {
          const cand: Area = { x: b.x, y: b.y, w, h: w * ratio, a, kind: 'lake', round: true };
          if (occ.free(cand, 25)) {
            lake = cand;
            break;
          }
        }
        if (!lake) continue;
        if (isBig) lake.name = LAKE_NAMES[big] ?? 'Jezioro';
        areas.push(lake);
        lakes.push(lake);
        occ.mark(lake, 10);
        if (isBig) {
          resort(lake, RESORT_NAMES[big] ?? 'Ośrodek wypoczynkowy', lr);
          big++;
        } else small++;
      }
  }

  /** Holiday resort on the shore facing the nearest road: beach, cabins, canteen, car park. */
  function resort(l: Area, name: string, r: () => number): void {
    const near = index.nearest(l.x, l.y, 3000, (k) => k === 'main' || k === 'local');
    const toward = near ? Math.atan2(near.y - l.y, near.x - l.x) : 0;
    // Shore point on the axis closest to that direction (clear of the lake's marked bounds).
    const rel = Math.round((toward - l.a) / (Math.PI / 2));
    const ang = l.a + rel * (Math.PI / 2);
    const radius = (rel & 1) === 0 ? l.w / 2 : l.h / 2;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const at = (out: number, along: number): Pt => ({
      x: l.x + dx * (radius + out) - dy * along,
      y: l.y + dy * (radius + out) + dx * along,
    });
    const beach = at(9, 0);
    areas.push({ ...beach, w: 26, h: 110, a: ang, kind: 'beach' });
    for (let row = 0; row < 2; row++)
      for (let k = -3; k <= 3; k++) {
        if (r() < 0.12) continue;
        const p = at(36 + row * 17, k * 14 + (row ? 7 : 0));
        place({ ...p, w: 6, h: 5, a: ang, kind: 'hut', floors: 1 }, 1);
      }
    const canteen = at(78, 0);
    place({ ...canteen, w: 12, h: 26, a: ang, kind: 'bar', floors: 2 }, 1);
    const lot = at(104, 0);
    areas.push({ ...lot, w: 22, h: 44, a: ang, kind: 'parking' });
    occ.mark({ ...lot, w: 22, h: 44, a: ang });
    complexes.push({ kind: 'resort', name, x: canteen.x, y: canteen.y, settlement: -1 });
    if (near) {
      const lane = route(lot, { x: near.x, y: near.y }, 0.06, 60, new Set());
      if (laneClear(lane, 14, 16)) addRoad('local', lane);
    }
  }

  // ---- settlements: blocks, houses, complexes ----
  for (const s of settlements) {
    if (s.kind === 'village') village(s);
    else {
      urban(s);
      oldTown(s);
    }
  }
  // Ribbon development: houses along the country roads leaving each city / town.
  // Allotment gardens first (next to town), then houses further out; towns' ribbons are shorter
  // so the built density keeps falling outwards.
  for (const s of urbanSet) {
    const r = rng(hash3(seed, s.id, 55));
    const exits: { pts: Pt[]; cls: RoadClass }[] = [];
    for (const rd of [...roads]) {
      if (rd.cls !== 'main' && rd.cls !== 'local') continue;
      const a = rd.pts[0] as Pt;
      const z = rd.pts[rd.pts.length - 1] as Pt;
      const ends = (cornersOf.get(s.id) ?? []).some((c) => dist(c, a) < 1 || dist(c, z) < 1);
      if (!ends) continue;
      const pts = (cornersOf.get(s.id) ?? []).some((c) => dist(c, a) < 1)
        ? rd.pts
        : [...rd.pts].reverse();
      exits.push({ pts, cls: rd.cls });
    }
    allotments(s, exits);
    for (const ex of exits) plotsAlong(ex.pts, 30, s.r * (0.3 + r() * 0.45), ex.cls, r, false);
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
      if (what === 'hospital' || what === 'police' || what === 'gasblock' || what === 'clinic') {
        const kind = what === 'clinic' ? 'hospital' : what === 'gasblock' ? 'gas' : what;
        const seat = s.id === settlements[0]?.id;
        const firstOfKind = !complexes.some((c) => c.settlement === s.id && c.kind === kind);
        const name =
          what === 'hospital'
            ? seat && firstOfKind
              ? 'Szpital powiatowy'
              : 'Szpital miejski'
            : what === 'clinic'
              ? 'Przychodnia'
              : what === 'police'
                ? seat && firstOfKind
                  ? 'Komenda Powiatowa Policji'
                  : 'Komisariat Policji'
                : undefined;
        complexes.push({
          kind,
          ...(name ? { name } : {}),
          x: b.rect.x,
          y: b.rect.y,
          settlement: s.id,
        });
      }
    }
    if (industrial)
      complexes.push({
        kind: 'industrial',
        x: s.x + Math.cos(indDir + s.angle) * s.r * 0.75,
        y: s.y + Math.sin(indDir + s.angle) * s.r * 0.75,
        settlement: s.id,
      });
  }

  /**
   * Allotment gardens (ROD) just outside the built-up edge, beside the roads leaving town (`exits`
   * start at the town's edge): plots with garden sheds.
   */
  function allotments(s: Settlement, exits: { pts: Pt[]; cls: RoadClass }[]): void {
    const r = rng(hash3(seed, s.id, 0xa11));
    const want = s.kind === 'city' ? 6 : 2;
    let made = 0;
    for (const t of [70, 190, 310])
      for (const ex of exits)
        for (const side of [-1, 1]) {
          if (made >= want || polyLength(ex.pts) < t + 80) continue;
          const { p, dx, dy } = pointAt(ex.pts, t);
          const w = 110 + r() * 50;
          const h = 60 + r() * 25;
          const off = ROAD_WIDTH[ex.cls] / 2 + 8 + h / 2;
          const x = p.x - dy * side * off;
          const y = p.y + dx * side * off;
          const g: Area = { x, y, w, h, a: Math.atan2(dy, dx), kind: 'allotment' };
          if (riverDist(x, y) < riverWidth / 2 + Math.hypot(w, h) / 2 + 10) continue;
          if (inLake(x, y, Math.hypot(w, h) / 2 + 10) || !occ.free(g, 3)) continue;
          areas.push(g);
          const c = Math.cos(g.a);
          const sn = Math.sin(g.a);
          const pw = 16;
          const ph = 20;
          for (let v = -h / 2 + ph / 2; v + ph / 2 <= h / 2 + 0.01; v += ph)
            for (let u = -w / 2 + pw / 2; u + pw / 2 <= w / 2 + 0.01; u += pw) {
              if (r() < 0.25) continue;
              const px = x + (u + 4) * c - (v - 5) * sn;
              const py = y + (u + 4) * sn + (v - 5) * c;
              buildings.push({ x: px, y: py, w: 3.5, h: 3, a: g.a, kind: 'shed', floors: 1 });
            }
          occ.mark(g);
          made++;
        }
  }

  /** Old town fill: square, town hall, church, tenements packed along every street. */
  function oldTown(s: Settlement): void {
    const ot = oldTowns.get(s.id);
    if (!ot) return;
    const r = rng(hash3(seed, s.id, 0x0ad));
    const city = s.kind === 'city';
    // Paved ground of the whole old town, under everything else.
    let rMax = 0;
    for (let k = 0; k < 32; k++) rMax = Math.max(rMax, ot.ringAt((k / 32) * Math.PI * 2));
    const d = 2 * rMax + 24;
    areas.unshift({ x: s.x, y: s.y, w: d, h: d, a: 0, kind: 'block', round: true });
    // Green belt on the old walls' line (planty) between the ring and the grid, under it all.
    const belt = d + blockSize(s) * 2;
    areas.unshift({ x: s.x, y: s.y, w: belt, h: belt, a: 0, kind: 'park', round: true });
    areas.push({ ...ot.square, kind: 'plaza' });
    place({ ...ot.townHall, kind: 'office', floors: 2 }, 0.5);
    occ.mark(ot.square);
    // Exact checks here (the 4 m occupancy grid is too coarse for wall-to-wall tenements):
    // no overlap with any building around, clear of every street and of the square.
    const reach = ot.ringAt(0) * 1.6 + blockSize(s) * 2;
    const near = buildings.filter((f) => Math.hypot(f.x - s.x, f.y - s.y) < reach);
    const urbanRoads: RoadClass[] = ['highway', 'main', 'local', 'street'];
    const clear = (f: ORect): boolean => {
      const pts = [...oRectCorners(f), { x: f.x, y: f.y }];
      for (let k = 0; k < 4; k++) {
        const p = pts[k] as Pt;
        const q = pts[(k + 1) % 4] as Pt;
        pts.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      }
      for (const p of pts) {
        if (inORect(ot.square, p.x, p.y, 1)) return false;
        for (const cls of urbanRoads)
          if (index.nearest(p.x, p.y, ROAD_WIDTH[cls] / 2 + 0.5, (c) => c === cls)) return false;
      }
      if (riverDist(f.x, f.y) < riverWidth / 2 + 12) return false;
      // Touching neighbours (wall to wall in a frontage) are fine.
      return !near.some((g) => oRectsOverlap(f, g, 0.01));
    };
    const spots = ot.churchSpots;
    const church = spots.find((c, k) => k === spots.length - 1 || clear(c)) as ORect;
    const fc: Footprint = { ...church, kind: 'church', floors: 2 };
    buildings.push(fc);
    near.push(fc);
    occ.mark(fc, -1.5);
    const lot = (l: ORect): boolean => {
      const roll = r();
      const kind: BuildingKind = roll < 0.08 ? 'shop' : roll < 0.12 ? 'bar' : 'tenement';
      const floors = (city ? 3 : 2) + Math.floor(r() * 3);
      const f: Footprint = { ...l, kind, floors };
      if (!clear(f)) return false;
      occ.mark(f, -1.5);
      buildings.push(f);
      near.push(f);
      return true;
    };
    const streets: Pt[][] = [
      squareEdges(ot.square),
      ...ot.radials,
      ot.innerRing,
      ot.ring,
      ...(connectorsOf.get(s.id) ?? []),
    ];
    for (const pts of streets)
      frontage(pts, pts === ot.ring && city ? ROAD_WIDTH.main : ROAD_WIDTH.street, r, lot);
    // Back lots: a second row behind the frontage where the blocks are deep enough.
    for (const pts of [ot.innerRing, ...ot.radials]) frontage(pts, ROAD_WIDTH.street + 30, r, lot);
  }

  /**
   * Zone of an ordinary block by distance from the centre (d = 0 centre, 1 = edge), in bands so
   * the built density falls steadily outwards: tenement quarters (kwartały) round the old town,
   * then housing estates (bloki), then detached houses; allotments and fields lie beyond.
   */
  function zoneOf(s: Settlement, d: number, h: number): string {
    const r = (h % 1000) / 1000;
    if (s.kind === 'city') {
      if (d < 0.4) return r < 0.88 ? 'tenement' : 'office';
      if (d < 0.66) return r < 0.85 ? 'apartment' : 'shops';
      return r < 0.94 ? 'houses' : 'shops';
    }
    if (d < 0.3) return r < 0.75 ? 'tenement' : 'shops';
    if (d < 0.5) return r < 0.6 ? 'apartment' : 'houses';
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
    // Perimeter row of buildings of depth `dep` along the 4 sides (a kwartał): lots 14–30 m
    // whose widths fill each side exactly between the corner buildings, wall to wall; `gap` =
    // chance a lot stays empty (gateways into the courtyard).
    const perimeter = (dep: number, kind: BuildingKind, f0: number, f1: number, gap: number) => {
      const span = W - 2 * dep;
      for (let side = 0; side < 4; side++) {
        const count = Math.max(1, Math.round(span / 22));
        const wts = Array.from({ length: count }, () => 0.7 + r() * 0.6);
        const sum = wts.reduce((x, y) => x + y, 0);
        let t = -half + dep;
        for (const wt of wts) {
          const l = (span * wt) / sum;
          const mid = t + l / 2;
          t += l;
          if (r() < gap) continue;
          const floors = f0 + Math.floor(r() * (f1 - f0 + 1));
          const [u, v, w, hh] =
            side === 0
              ? [mid, -half + dep / 2, l, dep]
              : side === 1
                ? [half - dep / 2, mid, dep, l]
                : side === 2
                  ? [-mid, half - dep / 2, l, dep]
                  : [-half + dep / 2, -mid, dep, l];
          fp(u, v, w, hh, kind, floors);
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
          // Mostly 4–5 storeys, some 10–11 (the usual Polish estate mix).
          const floors = r() < 0.75 ? 4 + Math.floor(r() * 2) : 10 + Math.floor(r() * 2);
          if (along) fp(0, off, len, 12, 'apartment', floors);
          else fp(off, 0, 12, len, 'apartment', floors);
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
      if (laneClear(lane, 20, 0)) through.push(addRoad('local', lane));
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
    // The state farm by the start town (PGR Borki): bigger, two more barns.
    const pgr =
      !complexes.some((k) => k.kind === 'farm') &&
      dist(settlements[start] as Settlement, { x: fx, y: fy }) < 3500;
    if (pgr) {
      items.push([-4, -toRoad * 32, 44, 14, 'barn'], [30, -toRoad * 30, 30, 14, 'barn']);
      complexes.push({ kind: 'farm', name: 'PGR Borki', x: fx, y: fy, settlement: -1 });
    }
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
          if (!laneClear(lane, 16, 16)) continue;
          const li = addRoad(near.d > 450 ? 'local' : 'track', lane);
          if (li < 0) continue;
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
  // ---- countryside: avenues of trees, copses and clumps, shrubby balks, scattered farms ----
  // No open field stays empty: anything over OPEN_TARGET m square gets something on it.
  const treeLines: TreeLine[] = [];
  {
    const cr = rng(hash3(seed, 0xc0, 0x5e));
    const gplan = { seed, size, river, riverWidth, settlements, forestThreshold };
    const ground = new GroundField(gplan);
    const farmland = (x: number, y: number) =>
      x > 20 &&
      y > 20 &&
      x < size - 20 &&
      y < size - 20 &&
      isFarmland(ground.at(x, y)) &&
      !inLake(x, y, 6);
    const spot = (x: number, y: number, r: number) =>
      occ.free({ x, y, w: r * 2, h: r * 2, a: 0 }, 0);
    const row = (kind: TreeLine['kind'], pts: Pt[]) => {
      if (pts.length < 3) return;
      treeLines.push({ kind, pts });
      for (const p of pts) occ.mark({ x: p.x, y: p.y, w: 3, h: 3, a: 0 });
    };
    // Avenues: trees both sides along county roads (most) and some field tracks.
    const country = roads.filter((r) => r.cls === 'local' || r.cls === 'track' || r.cls === 'main');
    for (const rd of country) {
      const L = polyLength(rd.pts);
      if (L < 150) continue;
      const chance = rd.cls === 'local' ? 0.75 : rd.cls === 'main' ? 0.4 : 0.4;
      const spacing = rd.cls === 'track' ? 12 : 10;
      const off = ROAD_WIDTH[rd.cls] / 2 + 4.5;
      for (let t = 0; t < L;) {
        const len = 300 + cr() * 600;
        if (cr() < chance)
          for (const side of [-1, 1]) {
            if (rd.cls === 'track' && cr() < 0.4) continue;
            let pts: Pt[] = [];
            for (let u = t + spacing / 2; u < Math.min(L, t + len); u += spacing) {
              const h = pointAt(rd.pts, u);
              const p = { x: h.p.x - h.dy * off * side, y: h.p.y + h.dx * off * side };
              if (farmland(p.x, p.y) && !inSettlement(p.x, p.y, 0) && spot(p.x, p.y, 0.5))
                pts.push(p);
              else {
                row('avenue', pts);
                pts = [];
              }
            }
            row('avenue', pts);
          }
        t += len;
      }
    }
    // Feature at a point: copse, clump, balk or a farm with its track to the road.
    const copse = (x: number, y: number, r: number): boolean => {
      const a = cr() * Math.PI;
      const w = r * 2;
      const h = r * (1.2 + cr() * 0.8);
      if (!farmland(x, y) || !occ.free({ x, y, w, h, a }, 2)) return false;
      const ar: Area = { x, y, w, h, a, kind: 'copse', round: true };
      areas.push(ar);
      occ.mark(ar);
      return true;
    };
    const balk = (x: number, y: number, len: number): boolean => {
      const { ang } = fieldRegion(seed, x, y);
      const a = ang + (cr() < 0.5 ? 0 : Math.PI / 2);
      const pts: Pt[] = [];
      for (let u = -len / 2; u <= len / 2; u += 4) {
        const p = { x: x + Math.cos(a) * u, y: y + Math.sin(a) * u };
        if (farmland(p.x, p.y) && !inSettlement(p.x, p.y, 20) && spot(p.x, p.y, 0.5)) pts.push(p);
        else if (pts.length) break;
      }
      if (pts.length < 8) return false;
      row('balk', pts);
      return true;
    };
    const farm = (x: number, y: number): boolean => {
      if (!farmland(x, y) || inSettlement(x, y, 150) || riverDist(x, y) < 120) return false;
      const near = index.nearest(x, y, 700, (k) => k === 'main' || k === 'local' || k === 'track');
      if (!near || near.d < 60) return false;
      const n0 = buildings.length;
      farmstead(
        x,
        y,
        Math.atan2(y - near.y, x - near.x) + Math.PI / 2,
        { x: near.x, y: near.y },
        cr,
      );
      return buildings.length > n0;
    };
    // A first scatter over all the farmland, then fill whatever open squares are left.
    const S = 220;
    for (let gy = 0; gy < size / S; gy++)
      for (let gx = 0; gx < size / S; gx++) {
        const x = (gx + 0.15 + cr() * 0.7) * S;
        const y = (gy + 0.15 + cr() * 0.7) * S;
        if (!farmland(x, y) || inSettlement(x, y, 100)) continue;
        const roll = cr();
        if (roll < 0.14) copse(x, y, 25 + cr() * 50);
        else if (roll < 0.36) copse(x, y, 7 + cr() * 9);
        else if (roll < 0.56) balk(x, y, 150 + cr() * 300);
        else if (roll < 0.61) farm(x, y);
      }
    const mask = farmlandMask(gplan);
    clearFeatures(mask, size, buildings, areas, treeLines);
    const n = Math.ceil(size / OPEN_CELL);
    for (let guard = 0; guard < 6000; guard++) {
      const sq = largestOpenSquare(mask, size);
      if (sq.side * OPEN_CELL <= OPEN_TARGET) break;
      const b0 = buildings.length;
      const a0 = areas.length;
      const t0 = treeLines.length;
      const half = (sq.side * OPEN_CELL) / 2;
      let ok = false;
      for (let tries = 0; tries < 10 && !ok; tries++) {
        const x = sq.x + (tries ? (cr() - 0.5) * half : 0);
        const y = sq.y + (tries ? (cr() - 0.5) * half : 0);
        const roll = cr();
        ok =
          (roll < 0.25 && farm(x, y)) ||
          (roll < 0.6 && copse(x, y, 18 + cr() * 40)) ||
          (roll < 0.85 && balk(x, y, 200 + cr() * 250)) ||
          copse(x, y, 5 + cr() * 6);
      }
      clearFeatures(mask, size, buildings.slice(b0), areas.slice(a0), treeLines.slice(t0));
      if (!ok) {
        // Nothing fits there (a field track criss-crossing it): leave that spot be.
        const cx = Math.floor(sq.x / OPEN_CELL);
        const cy = Math.floor(sq.y / OPEN_CELL);
        if (cx >= 0 && cy >= 0 && cx < n && cy < n) mask[cy * n + cx] = 0;
      }
    }
    // Farm tracks laid after the avenues: no tree or bush left standing on a road.
    for (let i = treeLines.length - 1; i >= 0; i--) {
      const t = treeLines[i] as TreeLine;
      const parts: Pt[][] = [[]];
      for (const q of t.pts) {
        const near = index.nearest(q.x, q.y, 10, (c) => c !== 'rail');
        const onRoad = near && near.d <= ROAD_WIDTH[(roads[near.road] as Road).cls] / 2 + 1.5;
        if (onRoad) parts.push([]);
        else (parts[parts.length - 1] as Pt[]).push(q);
      }
      if (parts.length === 1) continue;
      treeLines.splice(
        i,
        1,
        ...parts.filter((q) => q.length >= 3).map((pts) => ({ kind: t.kind, pts })),
      );
    }
  }
  // Spurs dropped on the banks (see `quays`).
  for (let i = roads.length - 1; i >= 0; i--)
    if ((roads[i] as Road).pts.length < 2) roads.splice(i, 1);
  // ---- bridges: wherever a road or the railway crosses the river ----
  const bridges: Bridge[] = [];
  roads.forEach((rd, ri) => {
    for (let k = 1; k < rd.pts.length; k++) {
      const a = rd.pts[k - 1] as Pt;
      const b = rd.pts[k] as Pt;
      for (const h of riverIndex.crossings(a, b)) {
        const ra = river[h.seg - 1] as Pt;
        const rb = river[h.seg] as Pt;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const rAng = Math.atan2(rb.y - ra.y, rb.x - ra.x);
        const sin = Math.max(0.35, Math.abs(Math.sin(ang - rAng)));
        bridges.push({
          x: h.x,
          y: h.y,
          w: riverWidth / sin + 16,
          h: ROAD_WIDTH[rd.cls] + 2,
          a: ang,
          cls: rd.cls,
          road: ri,
        });
      }
    }
  });

  return {
    version: WORLD_PLAN_VERSION,
    seed,
    size,
    chunks: size / CHUNK_SIZE,
    river,
    riverWidth,
    riverName: 'Sołwia',
    riverMouth: traced.mouth,
    bridges,
    start,
    settlements,
    roads,
    buildings,
    areas,
    complexes,
    treeLines,
    forestThreshold,
  };
}

/** Open fields get a copse, a balk or a farm until no open square is wider than this (m). */
const OPEN_TARGET = 350;
/** Quay street centre line this far (m) from the river bank. */
const QUAY_OFFSET = 9;
/** Street ends this close (m) to the river must meet another street (a quay or a bridge). */
const DEAD_END_REACH = 160;
const blockSize = (s: Settlement): number => (s.kind === 'city' ? 96 : 84);

/** Re-export for tests and the renderer. */
export { rand3 };
