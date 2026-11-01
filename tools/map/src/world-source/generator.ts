import { pickSpecies, type TreeHabitat } from './tree-species.js';
import { deckRailingEdge } from './deck-railing.js';
import { chunkLamps, type GenLamp } from './lamps.js';
import { clearingMask } from './clearing.js';
import { coverZones } from './cover.js';
import { chunkInfra, type GenInfra } from './infra.js';
import { CHUNK_SIZE } from '@deadzone/content';
import { occupiedTiles } from '@deadzone/content/footprint';
import { OVERLAY_OBJECTS, WINDOW_CLEAR, baseFootprint } from '../furnish.js';
import { solveBuilding, type SolvedBuilding } from './building.js';
import {
  EDGE_PALETTE,
  G_ASPHALT,
  G_CONCRETE,
  G_DIRT,
  G_GRASS,
  G_PARKING,
  G_SIDEWALK,
  G_WATER,
  GROUND_TILE_IDS,
  TILE_PALETTE,
  edgeId,
} from './palette.js';
import { buildingLook, lookPair, NEIGHBOUR_M, type BuildingLook } from './look.js';
import type { Condition, LookType, RoofShape } from './look-palette.js';
import { AREA_ORDER, PlanIndex, type IBuilding } from './plan-index.js';
import { generatorVersionNumber, type WorldPlanInput } from './plan.js';
import {
  AREA_TREES,
  ROAD_GROUND,
  clipSegment,
  fillRings,
  rasterGround,
  type Raster,
} from './raster.js';

const C = CHUNK_SIZE;
const CT = C * C;

/** One storey of a generated chunk (renderer `ChunkData` / sim `SimChunk` layers). */
export interface GenLevel {
  z: number;
  floor: Uint16Array;
  edgeN: Uint16Array;
  edgeW: Uint16Array;
  roof?: Uint16Array;
  room?: Uint16Array;
  /** Chunk-local room id → [room type, global building id]. */
  rooms: [number, string, number][];
  /** Global building id → building kind (`SimChunk.buildingKinds`), buildings of `rooms` only. */
  buildingKinds?: [number, string][];
  objects: { contentId: string; x: number; y: number; rot: number }[];
  stairs: { tx: number; ty: number; dir: 'N' | 'E' | 'S' | 'W'; len: number }[];
  /** Parked cars (level 0): centre in local tiles. */
  vehicles?: { x: number; y: number; heading: number; type: string }[];
  /**
   * Outline walls of slanted buildings on this level, clipped to the chunk (world metres, see
   * `SimChunk.wallSegments`), with the global building id for the renderer.
   */
  wallSegments?: { x0: number; y0: number; x1: number; y1: number; z: number; building: number }[];
  /**
   * Level 0: dense-cover zones (`SimChunk.zones`, sim #256): `bushes` (scrub, hedges) / `cover`
   * (woods), one per role, rectangles in global tiles inside this chunk; id `cover:cx,cy:role`.
   */
  zones?: {
    id: string;
    role: string;
    z: number;
    rects: { x: number; y: number; w: number; h: number }[];
  }[];
  /** Level 0: feet of HV towers and catenary masts (`SimChunk.blockers`, chunk-local metres). */
  blockers?: { x0: number; y0: number; x1: number; y1: number }[];
}

/** Render metadata of a building touching the chunk (`BuildingMeta`). */
export interface GenBuildingMeta {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floors: number;
  /** Footprint is its full bounding box (pitched roof over the whole building). */
  rect: boolean;
  type: string;
  kind: string;
  /** Slanted building with vector walls: outline (x, y pairs, world metres) for a flat roof. */
  outline?: number[];
  /**
   * Look (generator rev 21+, look-spec.md §A–C): palette type, colours `#rrggbb`, roof shape,
   * condition. Absent on older chunks and on buildings without a palette type (ruins).
   */
  look?: LookType;
  wallColor?: string;
  roofColor?: string;
  trimColor?: string;
  roofShape?: RoofShape;
  condition?: Condition;
  /** OSM `height` (m) when tagged. */
  heightM?: number;
  /** Church with a tower. */
  tower?: 1;
}

/**
 * A vector road over a chunk (renderer: smooth ribbons with round joins; the sim keeps the road
 * tiles). One continuous run of the road's polyline whose segments touch the chunk.
 */
export interface GenRoad {
  /** Surface: ground class of the carriageway (`GROUND_TILES` index: asphalt, sidewalk, dirt). */
  ground: number;
  /** Carriageway half width and sidewalk outer radius (0 = none), tiles. */
  r: number;
  rs: number;
  bridge: boolean;
  /** Polyline in chunk-local tiles (x, y pairs, 1/100 tile). */
  pts: number[];
  /** Distance along the whole road at the first point (centre-line dashes stay continuous). */
  d0: number;
}

export interface GenColumn {
  cx: number;
  cy: number;
  levels: GenLevel[];
  /** Vector roads touching the chunk (render only). */
  roads?: GenRoad[];
  /**
   * Level-0 ground under the road tiles (floor tile id, 0 = no road or a building): the renderer
   * draws it below the smooth roads instead of the stair-stepped road tiles.
   */
  under?: Uint16Array;
  /**
   * Paved areas (OSM pedestrian plazas, `area:highway`) touching the chunk, render only: rings
   * (chunk-local tiles, flat x, y pairs; first ring outer, the rest holes) drawn as smooth
   * polygons over `under` instead of the stair-stepped sidewalk tiles.
   */
  paved?: number[][][];
  /** Trees from the plan (OSM trees, avenues, woods, parks): local tile x, y pairs. */
  trees: number[];
  /**
   * Species of each tree (content tree-species id, e.g. `base:oak`): `treeSpecies[i]` belongs to
   * `trees[2i], trees[2i + 1]`. Picked by habitat (forest, park, street, field, garden) from a
   * hash of the tree's position.
   */
  treeSpecies: string[];
  buildings: GenBuildingMeta[];
  /** Power lines, railway track, switches, crossings, catenary (render only, world metres). */
  infra?: GenInfra;
  /** Street lamps (OSM `street_lamp` + evenly along carriageways; render only, world metres). */
  lamps?: GenLamp[];
}

export const VEHICLE_TYPE = 'base:sedan';
export const FUEL_PUMP = 'base:fuel-pump';
/** Max parked cars per chunk (`SimChunk.vehicles`). */
const MAX_CARS = 64;
const RASTER_MARGIN = 12;
/** `Raster.area` values (+1) of the vegetation areas that make cover zones. */
const SCRUB_RANK = AREA_ORDER.indexOf('scrub') + 1;
const FOREST_RANK = AREA_ORDER.indexOf('forest') + 1;

/** Deterministic 0..1 hash of integer coordinates. */
/** Habitat of a tree at world (x, y) from the chunk raster (see `treeSpecies`). */
function habitatAt(r: Raster, occ: Uint8Array, x: number, y: number): TreeHabitat {
  const at = (tx: number, ty: number) => {
    const lx = tx - r.x0;
    const ly = ty - r.y0;
    return lx < 0 || ly < 0 || lx >= r.w || ly >= r.h ? -1 : ly * r.w + lx;
  };
  const j = at(Math.floor(x), Math.floor(y));
  if (j >= 0 && (r.tree[j] === 1 || r.area[j] === FOREST_RANK)) return 'forest';
  if (j >= 0 && r.tree[j] === 2) return 'park';
  let garden = false;
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const k = at(Math.floor(x) + dx, Math.floor(y) + dy);
      if (k < 0) continue;
      const g = r.g[k]!;
      if (g === G_ASPHALT || g === G_SIDEWALK) return 'street';
      if (occ[k]) garden = true;
    }
  return garden ? 'garden' : 'field';
}

export function hash01(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Small LRU (Map order). */
class Lru<K, V> {
  private readonly m = new Map<K, V>();
  constructor(private readonly cap: number) {}
  get(k: K): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }
  set(k: K, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as K);
  }
}

interface Car {
  x: number;
  y: number;
  heading: number;
  h: number;
}

/**
 * Lazy chunk generator over a world plan (OSM Stalowa Wola, plan-4): the spatial index is built
 * once; `column(cx, cy)` rasterises ground, roads, rails, water and bridge decks for the chunk,
 * stamps the buildings touching it (each solved once — interior, storeys, stairwell, furniture —
 * and kept in an LRU) and places trees, parked cars and fuel pumps. Pure: the result depends only
 * on (plan, cx, cy); caches only memoise.
 */
export class PlanChunkGenerator {
  readonly index: PlanIndex;
  readonly id: string;
  readonly version: string;
  readonly generatorVersion: number;
  readonly seed: number;
  readonly bounds: { cx0: number; cy0: number; cx1: number; cy1: number };
  readonly tilePalette = TILE_PALETTE;
  readonly edgePalette = EDGE_PALETTE;
  /** Highest storey any building may have (z of the top floor). */
  readonly maxLevel = 15;
  private readonly solved = new Lru<number, SolvedBuilding | null>(768);
  private readonly pumpsByArea = new Map<number, [number, number][]>();
  private kinds: Uint8Array | undefined;
  private readonly tx0: number;
  private readonly ty0: number;
  private readonly tx1: number;
  private readonly ty1: number;
  /** Building solve / column timings (ms), for the perf report. */
  readonly timings = { columns: 0, columnMs: 0, solves: 0, solveMs: 0 };

  constructor(readonly plan: WorldPlanInput) {
    this.index = new PlanIndex(plan);
    this.id = plan.id;
    this.version = plan.version;
    this.generatorVersion = generatorVersionNumber(plan.version);
    this.seed = plan.seed;
    this.bounds = { ...plan.bounds };
    this.tx0 = plan.bounds.cx0 * C;
    this.ty0 = plan.bounds.cy0 * C;
    this.tx1 = (plan.bounds.cx1 + 1) * C;
    this.ty1 = (plan.bounds.cy1 + 1) * C;
  }

  inBounds(cx: number, cy: number): boolean {
    const b = this.bounds;
    return cx >= b.cx0 && cx <= b.cx1 && cy >= b.cy0 && cy <= b.cy1;
  }

  /** Solved building (memoised), undefined when the building is dropped. */
  building(ib: IBuilding): SolvedBuilding | undefined {
    this.ibs.set(ib.gid, ib);
    const hit = this.solved.get(ib.gid);
    if (hit !== undefined) return hit ?? undefined;
    const t0 = performance.now();
    const s = solveBuilding(this.index, ib, {
      tx0: this.tx0,
      ty0: this.ty0,
      tx1: this.tx1,
      ty1: this.ty1,
    });
    this.timings.solves++;
    this.timings.solveMs += performance.now() - t0;
    this.solved.set(ib.gid, s ?? null);
    return s;
  }

  private ibs = new Map<number, IBuilding>();
  private looks = new Map<number, BuildingLook | null>();
  private baseLooks = new Map<number, BuildingLook | null>();

  private baseLook(ib: IBuilding, floors: number, shift = 0): BuildingLook | undefined {
    const bb = ib.box;
    const cx = Math.floor((bb.x0 + bb.x1) / 2 / C);
    const cy = Math.floor((bb.y0 + bb.y1) / 2 / C);
    const zone = this.chunkKind(cx, cy);
    const R = 80;
    const nearRail =
      this.index.rails.query({ x0: bb.x0 - R, y0: bb.y0 - R, x1: bb.x1 + R, y1: bb.y1 + R })
        .length > 0;
    return buildingLook({
      b: ib.b,
      floors,
      x0: bb.x0,
      y0: bb.y0,
      x1: bb.x1,
      y1: bb.y1,
      shift,
      // Settlement edge / village: houses in village, farm and open-field chunks.
      rural: zone === 'wies' || zone === 'farma' || zone === 'pola' || zone === 'las',
      centre: zone === 'centrum',
      industrialArea: zone === 'przemysl',
      nearRail,
    });
  }

  /**
   * Look of a building for the chunk meta (memoised): palette pick, then the neighbour rule —
   * a building does not repeat the wall + roof pair of any lower-gid building within 15 m.
   */
  private lookOf(gid: number, floors: number): Partial<GenBuildingMeta> {
    let l = this.looks.get(gid);
    if (l === undefined) {
      const ib = this.ibs.get(gid);
      l = null;
      if (ib) {
        const pairs = new Set<string>();
        const bb = ib.box;
        const N = NEIGHBOUR_M;
        for (const j of this.index.buildings.query({
          x0: bb.x0 - N,
          y0: bb.y0 - N,
          x1: bb.x1 + N,
          y1: bb.y1 + N,
        })) {
          const o = this.index.buildings.items[j]!;
          if (o.gid >= gid) continue;
          let bl = this.baseLooks.get(o.gid);
          if (bl === undefined) {
            bl = this.baseLook(o, o.b.levels) ?? null;
            this.baseLooks.set(o.gid, bl);
          }
          if (bl) pairs.add(lookPair(bl));
        }
        for (let k = 0; k < 8; k++) {
          const c = this.baseLook(ib, floors, k);
          if (!c) break;
          l = c;
          if (!pairs.has(lookPair(c))) break;
        }
      }
      this.looks.set(gid, l);
    }
    const h = this.ibs.get(gid)?.b.height;
    if (!l) return h ? { heightM: h } : {};
    const meta: Partial<GenBuildingMeta> & { pair?: string } = { ...l };
    delete meta.pair;
    return { ...meta, ...(h ? { heightM: h } : {}) };
  }

  /** Union of raw building fills on a raster (cars and trees keep off buildings). */
  private occupied(r: Raster): Uint8Array {
    const occ = new Uint8Array(r.w * r.h);
    for (const i of this.index.buildings.query({
      x0: r.x0,
      y0: r.y0,
      x1: r.x0 + r.w,
      y1: r.y0 + r.h,
    })) {
      fillRings(this.index.buildings.items[i]!.rings, r.x0, r.y0, r.w, r.h, (j) => {
        occ[j] = 1;
      });
    }
    return occ;
  }

  column(cx: number, cy: number): GenColumn | undefined {
    if (!this.inBounds(cx, cy)) return undefined;
    const t0 = performance.now();
    const X0 = cx * C;
    const Y0 = cy * C;
    const M = RASTER_MARGIN;
    const r = rasterGround(this.index, X0 - M, Y0 - M, C + 2 * M, C + 2 * M);
    const ri = (lx: number, ly: number) => (ly + M) * r.w + (lx + M);
    const occ = this.occupied(r);
    // Buildings touching the chunk (outdoor props reach 2 tiles out of the footprint).
    const list: SolvedBuilding[] = [];
    for (const i of this.index.buildings.query({
      x0: X0 - 3,
      y0: Y0 - 3,
      x1: X0 + C + 3,
      y1: Y0 + C + 3,
    })) {
      const s = this.building(this.index.buildings.items[i]!);
      if (!s) continue;
      if (s.x0 > X0 + C + 2 || s.y0 > Y0 + C + 2 || s.x0 + s.w < X0 - 2 || s.y0 + s.h < Y0 - 2)
        continue;
      list.push(s);
    }
    list.sort((a, b) => a.gid - b.gid);
    const zs = new Set<number>([0]);
    for (const s of list) for (const z of s.levels.keys()) zs.add(z);
    const levels: GenLevel[] = [];
    /** Tiles of level 0 under a building room (gid). */
    const owner = new Int32Array(CT);
    for (const z of [...zs].sort((a, b) => a - b)) {
      const floor = new Uint16Array(CT);
      const edgeN = new Uint16Array(CT);
      const edgeW = new Uint16Array(CT);
      const roof = new Uint16Array(CT);
      const room = new Uint16Array(CT);
      if (z === 0)
        for (let i = 0; i < CT; i++) floor[i] = GROUND_TILE_IDS[r.g[ri(i % C, (i / C) | 0)]!]!;
      const localRoom = new Map<string, number>();
      const rooms: [number, string, number][] = [];
      const kinds = new Map<number, string>();
      const stairs: GenLevel['stairs'] = [];
      const walls: NonNullable<GenLevel['wallSegments']> = [];
      let any = z === 0;
      for (const s of list) {
        const L = s.levels.get(z);
        if (!L) continue;
        const W = s.w + 1;
        const xa = Math.max(X0, s.x0);
        const ya = Math.max(Y0, s.y0);
        const xb = Math.min(X0 + C, s.x0 + W);
        const yb = Math.min(Y0 + C, s.y0 + s.h + 1);
        for (let y = ya; y < yb; y++)
          for (let x = xa; x < xb; x++) {
            const k = (y - s.y0) * W + (x - s.x0);
            const i = (y - Y0) * C + (x - X0);
            const rm = L.room[k]!;
            if (rm) {
              floor[i] = L.floor[k]!;
              if (L.roof[k]) roof[i] = L.roof[k]!;
              const key = `${s.gid}:${rm}`;
              let id = localRoom.get(key);
              if (id === undefined) {
                id = rooms.length + 1;
                localRoom.set(key, id);
                rooms.push([id, s.rooms.get(rm) ?? 'base:room-hall', s.gid]);
                if (s.lockKind && !kinds.has(s.gid)) kinds.set(s.gid, s.lockKind);
              }
              room[i] = id;
              if (z === 0) owner[i] = s.gid;
              any = true;
            }
            if (L.edgeN[k]) {
              edgeN[i] = L.edgeN[k]!;
              any = true;
            }
            if (L.edgeW[k]) {
              edgeW[i] = L.edgeW[k]!;
              any = true;
            }
          }
        for (const g of s.segments ?? []) {
          if (g.z !== z) continue;
          const c = clipSegment(g.x0, g.y0, g.x1, g.y1, X0, Y0, X0 + C, Y0 + C);
          if (!c || Math.hypot(c[2] - c[0], c[3] - c[1]) < 1e-3) continue;
          walls.push({ x0: c[0], y0: c[1], x1: c[2], y1: c[3], z, building: s.gid });
          any = true;
        }
        for (const st of s.stairs) {
          if (st.z !== z || st.x < X0 || st.y < Y0 || st.x >= X0 + C || st.y >= Y0 + C) continue;
          stairs.push({ tx: st.x - X0, ty: st.y - Y0, dir: st.dir, len: st.len });
        }
      }
      if (!any) continue;
      // Exterior windows / doors keep their tile in front and behind free of every wall segment
      // (Fizyka 25.10): corner walls and neighbouring buildings' slanted walls are cut there.
      if (walls.length) {
        // From every nearby building's own edge grid: a window on the chunk border (x = 0 of the
        // next chunk) still cuts this chunk's walls.
        const boxes: [number, number, number, number][] = [];
        for (const s of list) {
          const L = s.levels.get(z);
          if (!L) continue;
          const W = s.w + 1;
          const rm = (gx: number, gy: number) =>
            gx < 0 || gy < 0 || gx >= s.w || gy >= s.h ? 0 : L.room[gy * W + gx]!;
          const gx0 = Math.max(0, X0 - 1 - s.x0);
          const gy0 = Math.max(0, Y0 - 1 - s.y0);
          const gx1 = Math.min(s.w, X0 + C + 1 - s.x0);
          const gy1 = Math.min(s.h, Y0 + C + 1 - s.y0);
          for (let gy = gy0; gy <= gy1; gy++)
            for (let gx = gx0; gx <= gx1; gx++) {
              for (const axis of ['N', 'W'] as const) {
                const v = (axis === 'N' ? L.edgeN : L.edgeW)[gy * W + gx];
                const k = v ? EDGE_PALETTE[v]?.kind : undefined;
                if (k !== 'window' && k !== 'door') continue;
                const a = rm(gx, gy);
                const b = axis === 'N' ? rm(gx, gy - 1) : rm(gx - 1, gy);
                if (a !== 0 && b !== 0) continue;
                const wx = s.x0 + gx;
                const wy = s.y0 + gy;
                boxes.push(
                  axis === 'N'
                    ? [wx + CUT_M, wy - CUT_DEPTH, wx + 1 - CUT_M, wy + CUT_DEPTH]
                    : [wx - CUT_DEPTH, wy + CUT_M, wx + CUT_DEPTH, wy + 1 - CUT_M],
                );
              }
            }
        }
        if (boxes.length) {
          const cut = cutSegments(walls, boxes);
          walls.length = 0;
          walls.push(...cut);
        }
      }
      /** Tile (x, y) of level 0 is a door tile or in front of a door of any nearby building. */
      const doorAt = (x: number, y: number): boolean => {
        for (const b of list) {
          const L = b.levels.get(0);
          if (!L) continue;
          const W = b.w + 1;
          const at = (ex: number, ey: number, a: Uint16Array) => {
            const gx = ex - b.x0;
            const gy = ey - b.y0;
            if (gx < 0 || gy < 0 || gx >= W || gy > b.h) return false;
            return EDGE_PALETTE[a[gy * W + gx]!]?.kind === 'door';
          };
          if (
            at(x, y, L.edgeN) ||
            at(x, y + 1, L.edgeN) ||
            at(x, y, L.edgeW) ||
            at(x + 1, y, L.edgeW)
          )
            return true;
        }
        return false;
      };
      /** Tile (x, y) of level z has a window edge of any nearby building. */
      const windowAt = (x: number, y: number, z: number): boolean => {
        for (const b of list) {
          const L = b.levels.get(z);
          if (!L) continue;
          const W = b.w + 1;
          const at = (ex: number, ey: number, a: Uint16Array) => {
            const gx = ex - b.x0;
            const gy = ey - b.y0;
            if (gx < 0 || gy < 0 || gx >= W || gy > b.h) return false;
            return EDGE_PALETTE[a[gy * W + gx]!]?.kind === 'window';
          };
          if (
            at(x, y, L.edgeN) ||
            at(x, y + 1, L.edgeN) ||
            at(x, y, L.edgeW) ||
            at(x + 1, y, L.edgeW)
          )
            return true;
        }
        return false;
      };
      // Objects of this level: furniture inside, props outside (first building wins a tile).
      const objects: GenLevel['objects'] = [];
      // Tiles of pieces dropped by a window: what stood on them (TV, lamp, radio) goes too.
      const dropped = new Set<string>();
      for (const s of list)
        for (const o of s.objects) {
          if (o.z !== z || !WINDOW_CLEAR.has(o.contentId)) continue;
          const tiles = occupiedTiles(o.x, o.y, o.rot, baseFootprint(o.contentId));
          if (tiles.some((t) => windowAt(t.x, t.y, z)))
            for (const t of tiles) dropped.add(`${t.x},${t.y}`);
        }
      const taken = new Set<number>();
      for (const s of list) {
        for (const o of s.objects) {
          if (o.z !== z || o.x < X0 || o.y < Y0 || o.x >= X0 + C || o.y >= Y0 + C) continue;
          const i = (o.y - Y0) * C + (o.x - X0);
          // Every tile of the footprint inside this chunk (furniture may cross the chunk edge).
          const cells: number[] = [];
          for (const t of occupiedTiles(o.x, o.y, o.rot, baseFootprint(o.contentId)))
            if (t.x >= X0 && t.y >= Y0 && t.x < X0 + C && t.y < Y0 + C)
              cells.push((t.y - Y0) * C + (t.x - X0));
          // Overlay objects (ceiling lamp, desk lamp on its desk) take no tile.
          const overlay = OVERLAY_OBJECTS.has(o.contentId);
          if (!overlay && cells.some((j) => taken.has(j))) continue;
          // Never in a doorway of any building (both sides of every door stay free).
          if (z === 0 && doorAt(o.x, o.y)) continue;
          // Yard props never in front of any building's window (Fizyka 25.10).
          if (
            WINDOW_CLEAR.has(o.contentId) &&
            occupiedTiles(o.x, o.y, o.rot, baseFootprint(o.contentId)).some((t) =>
              windowAt(t.x, t.y, z),
            )
          )
            continue;
          // ...and nothing that stood on such a piece (TV on its stand, lamp on a desk).
          if (overlay && o.contentId !== 'base:ceiling-lamp' && dropped.has(`${o.x},${o.y}`))
            continue;
          // An outdoor prop never stands in another building.
          if (z === 0 && !room[i] && occ[ri(o.x - X0, o.y - Y0)]) continue;
          if (z === 0 && cells.some((j) => room[j] && owner[j] !== s.gid)) continue;
          if (!overlay) for (const j of cells) taken.add(j);
          objects.push({ contentId: o.contentId, x: o.x - X0, y: o.y - Y0, rot: o.rot });
        }
      }
      const level: GenLevel = { z, floor, edgeN, edgeW, rooms, objects, stairs };
      if (rooms.length) level.room = room;
      if (walls.length) level.wallSegments = walls;
      if (kinds.size) level.buildingKinds = [...kinds];
      if (roof.some((v) => v !== 0)) level.roof = roof;
      if (z === 0) {
        this.railings(r, M, owner, edgeN, edgeW);
        for (const [x, y] of this.pumpsNear(X0, Y0)) {
          const i = (y - Y0) * C + (x - X0);
          if (taken.has(i) || owner[i]) continue;
          taken.add(i);
          objects.push({ contentId: FUEL_PUMP, x: x - X0, y: y - Y0, rot: 0 });
        }
        const cars = this.cars(r, M, occ, X0, Y0);
        if (cars.length) level.vehicles = cars;
      }
      objects.sort((a, b) => a.y - b.y || a.x - b.x);
      levels.push(level);
    }
    const ground = levels[0]!;
    // HV line clearings (przecinki): no trees and no woods cover, grass and scrub stay.
    const lines = this.index.power.query({
      x0: X0 - 30,
      y0: Y0 - 30,
      x1: X0 + C + 30,
      y1: Y0 + C + 30,
    });
    const cut = clearingMask(
      lines.map((i) => this.index.power.items[i]!),
      X0,
      Y0,
      C,
    );
    const trees = this.trees(r, M, occ, ground, X0, Y0, cut);
    const treeSpecies = this.treeSpecies(r, occ, trees, X0, Y0);
    const buildings: GenBuildingMeta[] = list
      .filter((s) => s.bx1 >= X0 && s.by1 >= Y0 && s.bx0 < X0 + C && s.by0 < Y0 + C)
      .map((s) => ({
        id: s.gid,
        x0: s.bx0,
        y0: s.by0,
        x1: s.bx1,
        y1: s.by1,
        floors: s.floors,
        rect: s.rect,
        type: s.type,
        kind: s.kind,
        ...(s.outline ? { outline: s.outline } : {}),
        ...this.lookOf(s.gid, s.floors),
      }));
    const out: GenColumn = { cx, cy, levels, trees, treeSpecies, buildings };
    const infra = chunkInfra(this.index, cx, cy, C);
    if (infra) out.infra = infra;
    const lamps = chunkLamps(this.index, cx * C, cy * C, C);
    if (lamps.length) out.lamps = lamps;
    // Dense cover: scrub / hedges → bushes, woods → cover (open ground only).
    const cls = new Uint8Array(CT);
    let anyCover = false;
    for (let i = 0; i < CT; i++) {
      const j = ri(i % C, (i / C) | 0);
      const a = r.area[j]!;
      const v = a === SCRUB_RANK ? 1 : a === FOREST_RANK && !cut?.[i] ? 2 : 0;
      if (!v || occ[j] || owner[i] || r.deck[j]) continue;
      const g = r.g[j]!;
      if (g !== G_GRASS && g !== G_DIRT) continue;
      cls[i] = v;
      anyCover = true;
    }
    if (anyCover)
      ground.zones = coverZones(cls, C).map((zn) => ({
        id: `cover:${cx},${cy}:${zn.role}`,
        role: zn.role,
        z: 0,
        rects: zn.rects.map((q) => ({ x: X0 + q.x, y: Y0 + q.y, w: q.w, h: q.h })),
      }));
    // Tower / mast feet; a pad on a road tile is dropped (the road runs between the legs;
    // pads on the track bed are dropped in `chunkInfra`).
    const feet = (infra?.blockers ?? []).filter((b) => {
      for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++)
        for (let x = Math.floor(b.x0); x < Math.ceil(b.x1); x++) {
          const gg = r.g[ri(x, y)]!;
          if (gg === G_ASPHALT || r.deck[ri(x, y)]) return false;
        }
      return true;
    });
    if (feet.length) ground.blockers = feet;
    const roads = this.vectorRoads(X0, Y0);
    if (roads.length) out.roads = roads;
    const paved = this.pavedAreas(X0, Y0);
    if (paved.length) out.paved = paved;
    const under = new Uint16Array(CT);
    let anyUnder = false;
    for (let i = 0; i < CT; i++) {
      const u = r.under[ri(i % C, (i / C) | 0)]!;
      if (!u || owner[i]) continue;
      under[i] = GROUND_TILE_IDS[u - 1]!;
      anyUnder = true;
    }
    if (anyUnder) out.under = under;
    this.timings.columns++;
    this.timings.columnMs += performance.now() - t0;
    return out;
  }

  /** Rings of the paved areas whose bounds touch the chunk, chunk-local (0.01 tile). */
  private pavedAreas(X0: number, Y0: number): number[][][] {
    const out: number[][][] = [];
    const idx = this.index.areas;
    for (const i of idx.query({ x0: X0, y0: Y0, x1: X0 + C, y1: Y0 + C })) {
      const a = idx.items[i]!;
      if (a.kind !== 'paved') continue;
      out.push(
        a.rings.map((r) => {
          const pts: number[] = [];
          for (let k = 0; k + 1 < r.length; k += 2)
            pts.push(
              Math.round((r[k]! - X0) * 100) / 100,
              Math.round((r[k + 1]! - Y0) * 100) / 100,
            );
          return pts;
        }),
      );
    }
    return out;
  }

  /** Runs of road polylines whose segments touch the chunk (+ their width), chunk-local. */
  private vectorRoads(X0: number, Y0: number): GenRoad[] {
    const out: GenRoad[] = [];
    const idx = this.index.roads;
    for (const i of idx.query({ x0: X0 - 16, y0: Y0 - 16, x1: X0 + C + 16, y1: Y0 + C + 16 })) {
      const road = idx.items[i]!;
      const p = road.pts;
      const pad = Math.max(road.r, road.rs) + 0.5;
      let run: number[] | undefined;
      let d = 0;
      let d0 = 0;
      const flush = () => {
        if (run && run.length >= 4) {
          out.push({
            ground: ROAD_GROUND(road.kind),
            r: road.r,
            rs: road.rs,
            bridge: road.bridge,
            pts: run,
            d0: Math.round(d0 * 100) / 100,
          });
        }
        run = undefined;
      };
      const loc = (k: number) => [
        Math.round((p[k]! - X0) * 100) / 100,
        Math.round((p[k + 1]! - Y0) * 100) / 100,
      ];
      for (let k = 0; k + 3 < p.length; k += 2) {
        const ax = p[k]!;
        const ay = p[k + 1]!;
        const bx = p[k + 2]!;
        const by = p[k + 3]!;
        const touches =
          Math.max(ax, bx) + pad >= X0 &&
          Math.min(ax, bx) - pad <= X0 + C &&
          Math.max(ay, by) + pad >= Y0 &&
          Math.min(ay, by) - pad <= Y0 + C;
        if (touches) {
          if (!run) {
            run = loc(k);
            d0 = d;
          }
          run.push(...loc(k + 2));
        } else flush();
        d += Math.hypot(bx - ax, by - ay);
      }
      flush();
    }
    return out;
  }

  /** Railings along both side edges of every bridge deck (deck at level 0, as in the OSM scene). */
  private railings(
    r: Raster,
    M: number,
    owner: Int32Array,
    edgeN: Uint16Array,
    edgeW: Uint16Array,
  ) {
    const rail = edgeId('base:railing');
    const at = (lx: number, ly: number) => (ly + M) * r.w + (lx + M);
    const free = (lx: number, ly: number) =>
      lx < 0 || ly < 0 || lx >= C || ly >= C ? true : !owner[ly * C + lx];
    const edge = (ax: number, ay: number, bx: number, by: number) => {
      const a = at(ax, ay);
      const b = at(bx, by);
      if (!free(ax, ay) || !free(bx, by)) return false;
      return deckRailingEdge(r, a, b);
    };
    for (let ly = 0; ly < C; ly++)
      for (let lx = 0; lx < C; lx++) {
        const i = ly * C + lx;
        if (!edgeN[i] && edge(lx, ly, lx, ly - 1)) edgeN[i] = rail;
        if (!edgeW[i] && edge(lx, ly, lx - 1, ly)) edgeW[i] = rail;
      }
  }

  /** Fuel pumps of fuel areas near the chunk (2 per station, on free concrete by its centre). */
  private pumpsNear(X0: number, Y0: number): [number, number][] {
    const out: [number, number][] = [];
    const q = { x0: X0 - 1, y0: Y0 - 1, x1: X0 + C + 1, y1: Y0 + C + 1 };
    for (const i of this.index.areas.query(q)) {
      const a = this.index.areas.items[i]!;
      if (a.kind !== 'fuel') continue;
      let pumps = this.pumpsByArea.get(i);
      if (!pumps) {
        pumps = this.stationPumps(i);
        this.pumpsByArea.set(i, pumps);
      }
      for (const p of pumps)
        if (p[0] >= X0 && p[1] >= Y0 && p[0] < X0 + C && p[1] < Y0 + C) out.push(p);
    }
    return out;
  }

  private stationPumps(areaIndex: number): [number, number][] {
    const box = this.index.areas.boxes[areaIndex]!;
    const x0 = Math.floor(box.x0) - 1;
    const y0 = Math.floor(box.y0) - 1;
    const w = Math.ceil(box.x1) - x0 + 2;
    const h = Math.ceil(box.y1) - y0 + 2;
    if (w * h > 40000) return [];
    const r = rasterGround(this.index, x0, y0, w, h);
    const occ = this.occupied(r);
    const ok = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const lx = x + dx;
          const ly = y + dy;
          if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
          const j = ly * w + lx;
          if (occ[j] || (r.g[j] !== G_CONCRETE && r.g[j] !== G_ASPHALT && r.g[j] !== G_PARKING))
            return false;
        }
      return r.g[y * w + x] === G_CONCRETE;
    };
    let sx = 0;
    let sy = 0;
    let n = 0;
    const cands: [number, number][] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (r.area[y * w + x] === AREA_ORDER.indexOf('fuel') + 1) {
          sx += x;
          sy += y;
          n++;
          if (ok(x, y)) cands.push([x, y]);
        }
    if (!n) return [];
    const mx = sx / n;
    const my = sy / n;
    cands.sort(
      (a, b) =>
        Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my) ||
        a[1] - b[1] ||
        a[0] - b[0],
    );
    const out: [number, number][] = [];
    for (const c of cands) {
      if (out.some((o) => Math.abs(o[0] - c[0] - x0) + Math.abs(o[1] - c[1] - y0) < 5)) continue;
      out.push([c[0] + x0, c[1] + y0]);
      if (out.length >= 2) break;
    }
    return out;
  }

  /**
   * Parked cars: kerbside on streets with a sidewalk and in parking-lot bays. Candidates sit on a
   * global lattice and win over conflicting candidates with a higher hash, so neighbouring chunks
   * agree without seeing each other's result (no overlaps across chunk borders).
   */
  private cars(
    r: Raster,
    M: number,
    occ: Uint8Array,
    X0: number,
    Y0: number,
  ): GenLevel['vehicles'] & object {
    const g = (x: number, y: number) => {
      const lx = x - r.x0;
      const ly = y - r.y0;
      return lx < 0 || ly < 0 || lx >= r.w || ly >= r.h ? -1 : r.g[ly * r.w + lx]!;
    };
    const blocked = (x: number, y: number) => {
      const lx = x - r.x0;
      const ly = y - r.y0;
      if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return true;
      const j = ly * r.w + lx;
      return !!(occ[j] || r.deck[j]);
    };
    const fits = (x: number, y: number, alongX: boolean, floor: number) => {
      for (let a = -2; a <= 2; a++)
        for (let b = -1; b <= 1; b++) {
          const tx = alongX ? x + a : x + b;
          const ty = alongX ? y + b : y + a;
          if (blocked(tx, ty) || g(tx, ty) !== floor) return false;
        }
      return true;
    };
    /** Candidate car centred on tile (x, y), or undefined. */
    const cand = (x: number, y: number): Car | undefined => {
      // Parking bays: every 5 tiles across, 6 along.
      if (((x % 5) + 5) % 5 === 3 && ((y % 6) + 6) % 6 === 3 && g(x, y) === G_PARKING) {
        const h = hash01(x, y, 41);
        if (h < 0.55 && fits(x, y, false, G_PARKING))
          return { x: x + 0.5, y: y + 0.5, heading: h < 0.27 ? Math.PI / 2 : -Math.PI / 2, h };
        return undefined;
      }
      if (g(x, y) !== G_ASPHALT) return undefined;
      const h = hash01(x, y, 43);
      if (h > 0.05) return undefined;
      // Kerb lane: sidewalk 2 tiles to the north / south (car along x) or west / east (along y).
      if ((g(x, y - 2) === G_SIDEWALK || g(x, y + 2) === G_SIDEWALK) && fits(x, y, true, G_ASPHALT))
        return { x: x + 0.5, y: y + 0.5, heading: h < 0.025 ? 0 : Math.PI, h };
      if (
        (g(x - 2, y) === G_SIDEWALK || g(x + 2, y) === G_SIDEWALK) &&
        fits(x, y, false, G_ASPHALT)
      )
        return { x: x + 0.5, y: y + 0.5, heading: h < 0.025 ? Math.PI / 2 : -Math.PI / 2, h };
      return undefined;
    };
    const R = 6; // conflict radius (Chebyshev, tiles): footprints 5 × 3 plus a gap
    const memo = new Map<number, Car | null>();
    const at = (x: number, y: number) => {
      const k = (y - Y0 + 64) * 256 + (x - X0 + 64);
      let c = memo.get(k);
      if (c === undefined) memo.set(k, (c = cand(x, y) ?? null));
      return c ?? undefined;
    };
    const out: Car[] = [];
    for (let y = Y0; y < Y0 + C; y++)
      for (let x = X0; x < X0 + C; x++) {
        const c = at(x, y);
        if (!c) continue;
        let win = true;
        for (let dy = -R; dy <= R && win; dy++)
          for (let dx = -R; dx <= R && win; dx++) {
            if (!dx && !dy) continue;
            const o = at(x + dx, y + dy);
            if (o && (o.h < c.h || (o.h === c.h && (dy < 0 || (dy === 0 && dx < 0))))) win = false;
          }
        if (win) out.push(c);
      }
    void M;
    return out
      .sort((a, b) => a.h - b.h)
      .slice(0, MAX_CARS)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((c) => ({ x: c.x - X0, y: c.y - Y0, heading: c.heading, type: VEHICLE_TYPE }));
  }

  /** Trees: OSM single trees and avenues, woods (5 m jitter grid) and parks (9 m), off paved ground. */
  private trees(
    r: Raster,
    M: number,
    occ: Uint8Array,
    ground: GenLevel,
    X0: number,
    Y0: number,
    cut?: Uint8Array,
  ): number[] {
    const objAt = new Set(ground.objects.map((o) => o.y * C + o.x));
    const ok = (x: number, y: number) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const lx = x + dx - r.x0;
          const ly = y + dy - r.y0;
          if (lx < 0 || ly < 0 || lx >= r.w || ly >= r.h) return false;
          const j = ly * r.w + lx;
          const g = r.g[j]!;
          if (occ[j] || r.deck[j] || (g !== G_GRASS && g !== G_DIRT)) return false;
        }
      const lx = x - X0;
      const ly = y - Y0;
      if (cut?.[ly * C + lx]) return false;
      return !objAt.has(ly * C + lx);
    };
    const out: number[] = [];
    const osm = this.index.trees.query({ x0: X0 - 3, y0: Y0 - 3, x1: X0 + C + 3, y1: Y0 + C + 3 });
    const pts = osm.map((i) => this.index.trees.items[i]!);
    for (const [x, y] of pts) {
      if (x < X0 || y < Y0 || x >= X0 + C || y >= Y0 + C) continue;
      if (ok(Math.floor(x), Math.floor(y))) out.push(x - X0, y - Y0);
    }
    for (const [step, kind, salt] of [
      [5, 1, 51],
      [9, 2, 53],
    ] as const) {
      for (let gy = Math.floor(Y0 / step); gy <= Math.floor((Y0 + C - 1) / step); gy++)
        for (let gx = Math.floor(X0 / step); gx <= Math.floor((X0 + C - 1) / step); gx++) {
          const x = gx * step + 0.5 + hash01(gx, gy, salt) * (step - 1);
          const y = gy * step + 0.5 + hash01(gx, gy, salt + 1) * (step - 1);
          if (x < X0 || y < Y0 || x >= X0 + C || y >= Y0 + C) continue;
          const tx = Math.floor(x);
          const ty = Math.floor(y);
          const j = (ty - r.y0) * r.w + (tx - r.x0);
          if (r.tree[j] !== kind || !ok(tx, ty)) continue;
          if (pts.some(([px, py]) => Math.abs(px - x) < 2.5 && Math.abs(py - y) < 2.5)) continue;
          out.push(Math.round((x - X0) * 100) / 100, Math.round((y - Y0) * 100) / 100);
        }
    }
    void M;
    return out;
  }

  /**
   * Species of every tree (`trees` pairs, chunk-local): habitat from the raster (woods → forest,
   * parks → park, paved ground within 3 m → street, a building within 3 m → garden, else field),
   * species weighted by its `habitats`, hashed from the world position (deterministic).
   */
  private treeSpecies(
    r: Raster,
    occ: Uint8Array,
    trees: readonly number[],
    X0: number,
    Y0: number,
  ): string[] {
    const out: string[] = [];
    for (let i = 0; i + 1 < trees.length; i += 2) {
      const x = X0 + trees[i]!;
      const y = Y0 + trees[i + 1]!;
      out.push(
        pickSpecies(habitatAt(r, occ, x, y), hash01(Math.round(x * 100), Math.round(y * 100), 61)),
      );
    }
    return out;
  }

  /**
   * Zone kind of a chunk for the sim's coarse zombie density (`simLod.zombiesPerChunk`): from
   * building counts by kind and the area under the chunk centre, computed once for the whole world
   * on a chunk-resolution grid (cheap: no chunk is generated).
   */
  chunkKind(cx: number, cy: number): string | undefined {
    if (!this.inBounds(cx, cy)) return undefined;
    const k = (this.kinds ??= this.plan.chunkKinds ?? this.computeKinds());
    const b = this.bounds;
    return CHUNK_KINDS[k[(cy - b.cy0) * (b.cx1 - b.cx0 + 1) + (cx - b.cx0)]!];
  }

  /** Zone kinds of every chunk in the bounds (row-major, `CHUNK_KINDS` indices). */
  computeKinds(): Uint8Array {
    const b = this.bounds;
    const W = b.cx1 - b.cx0 + 1;
    const H = b.cy1 - b.cy0 + 1;
    const area = new Uint8Array(W * H);
    for (const ai of this.index.areas.ordered()) {
      const a = this.index.areas.items[ai]!;
      const rings = a.rings.map((ring) => {
        const out = new Float64Array(ring.length);
        for (let i = 0; i < ring.length; i += 2) {
          out[i] = ring[i]! / C - b.cx0;
          out[i + 1] = ring[i + 1]! / C - b.cy0;
        }
        return out;
      });
      fillRings(rings, 0, 0, W, H, (i) => {
        area[i] = a.rank + 1;
      });
    }
    // Buildings around each chunk: every building counts in the chunks within KIND_RADIUS of
    // its box (a block of flats is bigger than a chunk; the streets between blocks are „bloki”).
    const R = KIND_RADIUS;
    const counts = new Map<number, Record<string, number>>();
    for (const ib of this.index.buildings.items) {
      const bx0 = Math.max(0, Math.floor(ib.box.x0 / C) - b.cx0 - R);
      const by0 = Math.max(0, Math.floor(ib.box.y0 / C) - b.cy0 - R);
      const bx1 = Math.min(W - 1, Math.floor(ib.box.x1 / C) - b.cx0 + R);
      const by1 = Math.min(H - 1, Math.floor(ib.box.y1 / C) - b.cy0 + R);
      for (let y = by0; y <= by1; y++)
        for (let x = bx0; x <= bx1; x++) {
          const k = y * W + x;
          const c = counts.get(k) ?? {};
          c[ib.b.kind] = (c[ib.b.kind] ?? 0) + 1;
          counts.set(k, c);
        }
    }
    const out = new Uint8Array(W * H);
    const id = (s: string) => (CHUNK_KINDS as readonly string[]).indexOf(s);
    for (let i = 0; i < W * H; i++) {
      const c = counts.get(i);
      const ak = AREA_ORDER[(area[i] ?? 0) - 1];
      let kind = 'pola';
      if (c) {
        const n = (k: string) => c[k] ?? 0;
        const services =
          n('shop') +
          n('office') +
          n('pharmacy') +
          n('school') +
          n('hospital') +
          n('police') +
          n('station') +
          n('church') +
          n('gym') +
          n('fire-station');
        const homes = n('house') + n('kostka');
        if (n('industrial') > 0 && n('industrial') >= homes + n('block')) kind = 'przemysl';
        // Blocks with shops / offices / public buildings around: the town centre.
        else if (n('block') >= 1 && services >= 3 && services + n('block') >= 5) kind = 'centrum';
        else if (n('block') >= 2) kind = 'bloki';
        else if (services >= 3) kind = 'uslugi';
        else if (homes >= 2) kind = ak === 'farmland' || ak === 'meadow' || !ak ? 'wies' : 'domy';
        else kind = ak === 'military' ? 'wojsko' : 'farma';
      } else if (ak === 'water') kind = 'woda';
      else if (ak && AREA_TREES[ak] === 1) kind = 'las';
      else if (ak === 'military') kind = 'wojsko';
      else if (ak === 'industrial') kind = 'przemysl';
      else if (ak === 'residential') kind = 'domy';
      out[i] = id(kind);
    }
    return out;
  }

  /**
   * Player start near `plan.start`: the closest sidewalk tile off bridge decks and buildings
   * (heading towards the hint), searching up to 96 tiles away.
   */
  start(): { x: number; y: number; heading: number } {
    const s = this.plan.start;
    const R = 96;
    const x0 = Math.floor(s.x) - R;
    const y0 = Math.floor(s.y) - R;
    const r = rasterGround(this.index, x0, y0, 2 * R, 2 * R);
    const occ = this.occupied(r);
    let best = Infinity;
    let out = { x: s.x, y: s.y, heading: 0 };
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        const j = y * r.w + x;
        if (r.g[j] !== G_SIDEWALK || occ[j] || r.deck[j]) continue;
        const d = Math.hypot(x0 + x + 0.5 - s.x, y0 + y + 0.5 - s.y);
        if (d < best) {
          best = d;
          out = { x: x0 + x + 0.5, y: y0 + y + 0.5, heading: 0 };
        }
      }
    out.heading = Math.atan2(s.y - out.y, s.x - out.x);
    return out;
  }

  /**
   * Zombies around the start: open ground 44–60 tiles from the player (deterministic), outside
   * the sim's safe-start radius (40; the sim also drops any in the player's line of sight).
   */
  startZombies(p: { x: number; y: number }, n = 8): { x: number; y: number; heading: number }[] {
    const R = 62;
    const x0 = Math.floor(p.x) - R;
    const y0 = Math.floor(p.y) - R;
    const r = rasterGround(this.index, x0, y0, 2 * R, 2 * R);
    const occ = this.occupied(r);
    const out: { x: number; y: number; heading: number }[] = [];
    for (let k = 0; k < 4000 && out.length < n; k++) {
      const a = hash01(k, 1, 61) * Math.PI * 2;
      const d = 44 + hash01(k, 2, 61) * 16;
      const x = Math.floor(p.x + Math.cos(a) * d);
      const y = Math.floor(p.y + Math.sin(a) * d);
      const j = (y - y0) * r.w + (x - x0);
      const g = r.g[j];
      if (occ[j] || r.deck[j] || (g !== G_ASPHALT && g !== G_SIDEWALK && g !== G_GRASS)) continue;
      if (out.some((z) => Math.hypot(z.x - x, z.y - y) < 3)) continue;
      out.push({ x: x + 0.5, y: y + 0.5, heading: Math.atan2(p.y - y, p.x - x) });
    }
    return out;
  }

  /** Named places (`saveSummary.place`, world-map.json shape: name + centre in tiles). */
  places(): { name: string; kind: string; x: number; y: number }[] {
    return this.plan.features.places.map((p) => ({
      name: p.name,
      kind: p.kind,
      x: p.x / 10,
      y: p.y / 10,
    }));
  }
}

/** Chunks around a building (each side) where it counts for the zone kind. */
export const KIND_RADIUS = 1;

export const CHUNK_KINDS = [
  'centrum',
  'uslugi',
  'bloki',
  'domy',
  'przemysl',
  'wies',
  'farma',
  'pola',
  'las',
  'woda',
  'wojsko',
  'ruiny',
] as const;

void G_WATER;

/** Window / door corridor cut into wall segments: depth (m) each side, inset along the edge. */
const CUT_DEPTH = 0.95;
const CUT_M = 0.02;

/** `walls` minus the parts inside any of `boxes` ([x0, y0, x1, y1]). Pure (tests). */
export function cutSegments<S extends { x0: number; y0: number; x1: number; y1: number }>(
  walls: readonly S[],
  boxes: readonly [number, number, number, number][],
): S[] {
  let cur: S[] = [...walls];
  for (const [bx0, by0, bx1, by1] of boxes) {
    const next: S[] = [];
    for (const w of cur) {
      const dx = w.x1 - w.x0;
      const dy = w.y1 - w.y0;
      let t0 = 0;
      let t1 = 1;
      let inside = true;
      for (const [p, q] of [
        [-dx, w.x0 - bx0],
        [dx, bx1 - w.x0],
        [-dy, w.y0 - by0],
        [dy, by1 - w.y0],
      ] as const) {
        if (Math.abs(p) < 1e-12) {
          if (q < 0) inside = false;
          continue;
        }
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
      if (!inside || t0 >= t1) {
        next.push(w);
        continue;
      }
      const len = Math.hypot(dx, dy);
      if (t0 * len > 1e-3) next.push({ ...w, x1: w.x0 + dx * t0, y1: w.y0 + dy * t0 });
      if ((1 - t1) * len > 1e-3) next.push({ ...w, x0: w.x0 + dx * t1, y0: w.y0 + dy * t1 });
    }
    cur = next;
  }
  return cur;
}
