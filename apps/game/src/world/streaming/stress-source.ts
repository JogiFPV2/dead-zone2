import {
  CHUNK_SIZE,
  CHUNK_TILES,
  tileIndex,
  type ChunkData,
  type ContentId,
  type EdgeDef,
  type MapObjectRef,
  type RoomInfo,
} from '../chunk.js';
import {
  SUMMARY_CELLS,
  type BuildingMeta,
  type ChunkSummary,
  type DecorInstance,
  type WorldChunk,
  type WorldChunkSource,
} from './source.js';

/** 8 × 8 km at 1 m tiles: 250 × 250 chunks. */
export const STRESS_WORLD_CHUNKS = 250;
export const STRESS_VERSION = 'stress-1';

const PALETTE: readonly (ContentId | null)[] = [
  null,
  'base:grass',
  'base:asphalt',
  'base:concrete',
  'base:roof-flat',
  'base:dirt',
];
const GRASS = 1;
const ASPHALT = 2;
const CONCRETE = 3;
const ROOF = 4;
const DIRT = 5;
const EDGES: readonly (EdgeDef | null)[] = [
  null,
  { id: 'base:wall-plain', kind: 'wall' },
  { id: 'base:window-plain', kind: 'window' },
  { id: 'base:door-plain', kind: 'door' },
];
const WALL = 1;
const WINDOW = 2;
const DOOR = 3;

/** Stateless 32-bit hash of integers (deterministic across platforms). */
export function hash(...v: number[]): number {
  let h = 0x9e3779b9;
  for (const x of v) {
    h = Math.imul(h ^ (x | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}
const unit = (...v: number[]): number => hash(...v) / 0x100000000;

interface Town {
  cx: number;
  cy: number;
  r: number;
}

interface House {
  lot: number;
  /** Local tile bounds, inclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  floors: number;
}

/**
 * DEV stress world: a deterministic dummy generator of an 8 × 8 km world (towns of grey-box
 * houses, a highway grid, forests) to exercise streaming. Same shape Silnik 2's generator will
 * have: a cheap macro plan from the seed (towns, roads, forest noise), then pure per-chunk fill.
 */
export class StressWorldSource implements WorldChunkSource {
  readonly id = 'stress';
  readonly version = STRESS_VERSION;
  readonly chunkSize = CHUNK_SIZE;
  readonly bounds: { cx0: number; cy0: number; cx1: number; cy1: number };
  readonly levels = { min: 0, max: 1 };
  readonly tilePalette = PALETTE;
  readonly edgePalette = EDGES;
  /** Macro plan (cached once per seed). */
  readonly towns: readonly Town[];
  /** Calls to getChunk that produced a chunk (tests). */
  generated = 0;

  constructor(
    readonly seed = 1,
    private readonly latencyMs = 0,
    /** Side in chunks: 250 (8 km, default) or 512 (16 384 m, `?stress=16`: floating origin). */
    readonly chunks = STRESS_WORLD_CHUNKS,
  ) {
    this.bounds = { cx0: 0, cy0: 0, cx1: chunks - 1, cy1: chunks - 1 };
    const towns: Town[] = [];
    // One town around the centre (the spawn), the rest scattered.
    towns.push({ cx: this.chunks / 2, cy: this.chunks / 2, r: 6 });
    // 16 km world: a town near the far corner too (floating-origin test spawn ~16 000, 16 000).
    if (this.chunks !== STRESS_WORLD_CHUNKS)
      towns.push({ cx: this.chunks - 12, cy: this.chunks - 12, r: 5 });
    for (let i = 0; i < 40; i++) {
      towns.push({
        cx: Math.floor(unit(seed, 1, i) * this.chunks),
        cy: Math.floor(unit(seed, 2, i) * this.chunks),
        r: 2 + Math.floor(unit(seed, 3, i) * 6),
      });
    }
    this.towns = towns;
  }

  /** Centre of the world (tile coords) — the stress spawn. */
  get centre(): { x: number; y: number } {
    // Street corner next to the highway crossing in the central town (open view, houses around).
    const c = (this.chunks / 2 + 6) * CHUNK_SIZE + 2.5;
    return { x: c, y: c };
  }

  isTown(cx: number, cy: number): boolean {
    return this.towns.some((t) => Math.max(Math.abs(cx - t.cx), Math.abs(cy - t.cy)) <= t.r);
  }

  /** Highway rows / columns every 20 chunks (tiles 14..17 of that chunk). */
  private highway(c: number): boolean {
    return c % 20 === 10;
  }

  /** Coarse value noise in [0, 1) at chunk scale (forests). */
  private forest(tx: number, ty: number): boolean {
    const s = 96;
    const gx = Math.floor(tx / s);
    const gy = Math.floor(ty / s);
    const fx = tx / s - gx;
    const fy = ty / s - gy;
    const v = (x: number, y: number) => unit(this.seed, 7, x, y);
    const a = v(gx, gy) * (1 - fx) + v(gx + 1, gy) * fx;
    const b = v(gx, gy + 1) * (1 - fx) + v(gx + 1, gy + 1) * fx;
    return a * (1 - fy) + b * fy > 0.62;
  }

  private houses(cx: number, cy: number): House[] {
    // No houses on highway chunks (the road runs through tiles 14..17).
    if (!this.isTown(cx, cy) || this.highway(cx) || this.highway(cy)) return [];
    const out: House[] = [];
    for (let lot = 0; lot < 4; lot++) {
      if (unit(this.seed, 11, cx, cy, lot) < 0.25) continue;
      const lx = 6 + (lot % 2) * 13;
      const ly = 6 + Math.floor(lot / 2) * 13;
      const w = 6 + Math.floor(unit(this.seed, 12, cx, cy, lot) * 5);
      const h = 5 + Math.floor(unit(this.seed, 13, cx, cy, lot) * 5);
      const floors = unit(this.seed, 14, cx, cy, lot) < 0.2 ? 2 : 1;
      out.push({ lot, x0: lx, y0: ly, x1: lx + w - 1, y1: ly + h - 1, floors });
    }
    return out;
  }

  private ground(cx: number, cy: number, x: number, y: number): number {
    const tx = cx * CHUNK_SIZE + x;
    const ty = cy * CHUNK_SIZE + y;
    if ((this.highway(cy) && y >= 14 && y <= 17) || (this.highway(cx) && x >= 14 && x <= 17)) {
      return ASPHALT;
    }
    if (this.isTown(cx, cy)) {
      if (x < 4 || y < 4) return ASPHALT;
      if (x < 6 || y < 6) return CONCRETE;
      return GRASS;
    }
    return this.forest(tx, ty) ? DIRT : GRASS;
  }

  getSummary(cx: number, cy: number): ChunkSummary | undefined {
    if (cx < 0 || cy < 0 || cx >= this.chunks || cy >= this.chunks) return undefined;
    const n = SUMMARY_CELLS;
    const cell = CHUNK_SIZE / n;
    const ground = new Uint16Array(n * n);
    const height = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * cell + cell / 2;
      const y = Math.floor(i / n) * cell + cell / 2;
      ground[i] = this.ground(cx, cy, x, y);
      for (const h of this.houses(cx, cy)) {
        if (x >= h.x0 && x <= h.x1 + 1 && y >= h.y0 && y <= h.y1 + 1) height[i] = h.floors;
      }
    }
    return { cx, cy, ground, height };
  }

  async getChunk(cx: number, cy: number, signal?: AbortSignal): Promise<WorldChunk | undefined> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    if (signal?.aborted) return undefined;
    return this.generate(cx, cy);
  }

  /** Pure chunk fill: (seed, version, cx, cy) → chunk. */
  generate(cx: number, cy: number): WorldChunk | undefined {
    if (cx < 0 || cy < 0 || cx >= this.chunks || cy >= this.chunks) return undefined;
    this.generated++;
    const floor = new Uint16Array(CHUNK_TILES);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) floor[tileIndex(x, y)] = this.ground(cx, cy, x, y);
    }
    const houses = this.houses(cx, cy);
    const levels = new Map<number, ChunkData>();
    const lv = [0, 1].map(() => ({
      edgeN: new Uint16Array(CHUNK_TILES),
      edgeW: new Uint16Array(CHUNK_TILES),
      roof: new Uint16Array(CHUNK_TILES),
      room: new Uint16Array(CHUNK_TILES),
      floor: new Uint16Array(CHUNK_TILES),
      rooms: new Map<number, RoomInfo>(),
      objects: [] as MapObjectRef[],
    }));
    const buildings: BuildingMeta[] = [];
    const base = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    for (const h of houses) {
      // Map-global building id; room ids are per chunk (see docs/streaming.md).
      const buildingId = (cy * this.chunks + cx) * 4 + h.lot + 1;
      const roomId = h.lot + 1;
      buildings.push({
        id: buildingId,
        x0: base + h.x0,
        y0: baseY + h.y0,
        x1: base + h.x1,
        y1: baseY + h.y1,
        floors: h.floors,
      });
      for (let z = 0; z < h.floors; z++) {
        const L = lv[z]!;
        L.rooms.set(roomId, { type: 'base:room-living-room', buildingId });
        for (let y = h.y0; y <= h.y1; y++) {
          for (let x = h.x0; x <= h.x1; x++) {
            const i = tileIndex(x, y);
            if (z === 0) floor[i] = CONCRETE;
            else L.floor[i] = CONCRETE;
            L.room[i] = roomId;
            if (z === h.floors - 1) L.roof[i] = ROOF;
          }
        }
        const doorX = Math.floor((h.x0 + h.x1) / 2);
        for (let x = h.x0; x <= h.x1; x++) {
          const win = (x - h.x0) % 3 === 1;
          L.edgeN[tileIndex(x, h.y0)] = win ? WINDOW : WALL;
          L.edgeN[tileIndex(x, h.y1 + 1)] = z === 0 && x === doorX ? DOOR : win ? WINDOW : WALL;
        }
        for (let y = h.y0; y <= h.y1; y++) {
          const win = (y - h.y0) % 3 === 1;
          L.edgeW[tileIndex(h.x0, y)] = win ? WINDOW : WALL;
          L.edgeW[tileIndex(h.x1 + 1, y)] = win ? WINDOW : WALL;
        }
        if (unit(this.seed, 20, cx, cy, h.lot, z) < 0.7) {
          L.objects.push({ contentId: 'base:crate', x: h.x0 + 1, y: h.y0, rot: 0 });
        }
        if (unit(this.seed, 21, cx, cy, h.lot, z) < 0.5) {
          L.objects.push({ contentId: 'base:wardrobe', x: h.x1, y: h.y0, rot: 2 });
        }
      }
    }
    lv.forEach((L, z) => {
      if (z > 0 && L.rooms.size === 0) return;
      levels.set(z, {
        coord: { cx, cy, z },
        floor: z === 0 ? floor : L.floor,
        edgeN: L.edgeN,
        edgeW: L.edgeW,
        roof: L.roof,
        room: L.room,
        rooms: L.rooms,
        ...(L.objects.length ? { objects: L.objects } : {}),
        ...(z === 0 && houses.some((h) => h.floors > 1)
          ? {
              stairs: houses
                .filter((h) => h.floors > 1)
                .map((h) => ({ tx: h.x0 + 1, ty: h.y0 + 1, dir: 'S' as const, len: 3 })),
            }
          : {}),
      });
    });
    return { cx, cy, levels, decor: this.decor(cx, cy, floor), buildings };
  }

  private decor(cx: number, cy: number, floor: Uint16Array): DecorInstance[] {
    const out: DecorInstance[] = [];
    const tries = 48;
    for (let i = 0; i < tries; i++) {
      const x = unit(this.seed, 30, cx, cy, i) * CHUNK_SIZE;
      const y = unit(this.seed, 31, cx, cy, i) * CHUNK_SIZE;
      const id = floor[tileIndex(Math.floor(x), Math.floor(y))];
      const r = unit(this.seed, 32, cx, cy, i);
      let kind: ContentId | undefined;
      if (id === DIRT) kind = r < 0.85 ? 'base:tree-pine' : 'base:bush';
      else if (id === GRASS && r < 0.15) kind = r < 0.05 ? 'base:rock' : 'base:bush';
      if (!kind) continue;
      out.push({
        kind,
        x,
        y,
        z: 0,
        rot: unit(this.seed, 33, cx, cy, i) * Math.PI * 2,
        scale: 0.8 + unit(this.seed, 34, cx, cy, i) * 0.5,
      });
    }
    return out;
  }
}
