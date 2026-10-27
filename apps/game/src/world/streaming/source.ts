import type { GenInfra } from '@deadzone/map/world-source';
import { CHUNK_SIZE as SIM_CHUNK_SIZE } from '@deadzone/protocol';
import {
  CHUNK_SIZE,
  type BuildingId,
  type ChunkData,
  type ChunkRange,
  type ChunkSource,
  type ContentId,
  type EdgeDef,
} from '../chunk.js';

/**
 * Streaming world contract (docs/streaming.md). One grid for generator, sim and renderer: chunks
 * are CHUNK_SIZE × CHUNK_SIZE tiles (the sim's `SimChunk`, protocol `CHUNK_SIZE`), addressed by
 * (cx, cy) with one `ChunkData` per floor level z (floor / edges / roof / rooms / objects / stairs).
 */
if (CHUNK_SIZE !== SIM_CHUNK_SIZE) throw new Error('renderer and sim chunk sizes differ');

/** Client-only prop / plant instance (trees, bushes, rocks, litter). The sim ignores decor. */
export interface DecorInstance {
  /** Content id of the decor kind (e.g. `base:tree-pine`); unknown kinds get a placeholder. */
  readonly kind: ContentId;
  /** Local tile coordinates inside the chunk (floats, 0..CHUNK_SIZE). */
  readonly x: number;
  readonly y: number;
  /** Floor level (0 = ground). */
  readonly z: number;
  /** Yaw in radians. */
  readonly rot: number;
  /** Uniform scale (1 = authored size). */
  readonly scale: number;
}

/** Render metadata of a building touching this chunk (roof hiding, upper floors, far LOD). */
export interface BuildingMeta {
  /** Map-global building id (the `buildingId` of the chunk's `rooms`). */
  readonly id: BuildingId;
  /** Global tile bounding box, inclusive (may extend into neighbour chunks). */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Number of floor levels above ground (1 = bungalow); roof sits on top of level floors - 1. */
  readonly floors: number;
  /** Optional block / prefab id from the generator (e.g. `base:block-house-small`). */
  readonly block?: ContentId;
  /**
   * Look from the generator (rev 21+, `GenBuildingMeta`; absent on older chunks): palette type,
   * colours `#rrggbb`, roof shape, condition (`ok` / `neglected` / `abandoned` / `ruin`).
   */
  readonly look?: string;
  readonly wallColor?: string;
  readonly roofColor?: string;
  readonly trimColor?: string;
  readonly roofShape?: string;
  readonly condition?: string;
  /** OSM height (m) when tagged. */
  readonly heightM?: number;
  /** Church with a tower. */
  readonly tower?: 1;
}

/** One chunk column: all levels at (cx, cy) plus client-only decor and building metadata. */
export interface WorldChunk {
  readonly cx: number;
  readonly cy: number;
  /** Level z → layers. Level 0 must exist for every chunk inside the world. */
  readonly levels: ReadonlyMap<number, ChunkData>;
  readonly decor?: readonly DecorInstance[];
  readonly buildings?: readonly BuildingMeta[];
  /** Vector roads over the chunk (generated maps): drawn as smooth ribbons, render only. */
  readonly roads?: readonly VectorRoad[];
  /**
   * Level-0 ground under the road tiles (TileId, 0 = none): drawn under `roads` instead of the
   * stair-stepped road tiles.
   */
  readonly under?: Uint16Array;
  /**
   * Paved areas (plazas, `area:highway`) touching the chunk, render only: rings in chunk-local
   * tiles (flat x, y pairs; first ring outer, the rest holes), drawn as smooth polygons.
   */
  readonly paved?: readonly (readonly (readonly number[])[])[];
  /** Power lines, railway, catenary (generated maps, render only, world metres). */
  readonly infra?: GenInfra;
  /**
   * Scrub and hedges (the sim's `bushes` cover zone, generated maps): rectangles in global
   * tiles; the realistic style plants bushes there.
   */
  readonly bushes?: readonly { x: number; y: number; w: number; h: number }[];
}

/** One run of a road polyline touching a chunk (chunk-local tiles, flat x, y pairs). */
export interface VectorRoad {
  /** Carriageway surface: content id of its tile (`base:asphalt`, `base:sidewalk`, `base:dirt`). */
  readonly surface: ContentId;
  /** Carriageway half width / sidewalk outer radius (0 = none), tiles. */
  readonly r: number;
  readonly rs: number;
  readonly bridge: boolean;
  readonly pts: readonly number[];
  /** Distance along the road at the first point (dash phase). */
  readonly d0: number;
}

/**
 * Cheap far-LOD summary (from the generator's macro plan, no chunk fill needed): a coarse
 * SUMMARY_CELLS × SUMMARY_CELLS grid of dominant floor TileIds and building heights (levels).
 */
export const SUMMARY_CELLS = 8;
export interface ChunkSummary {
  readonly cx: number;
  readonly cy: number;
  /** SUMMARY_CELLS² dominant floor TileId per cell (row-major, y * SUMMARY_CELLS + x). */
  readonly ground: Uint16Array;
  /** SUMMARY_CELLS² building height per cell in levels (0 = no building). */
  readonly height: Uint8Array;
}

/** Inclusive chunk bounds of the world (level-independent). */
export interface ChunkBounds {
  readonly cx0: number;
  readonly cy0: number;
  readonly cx1: number;
  readonly cy1: number;
}

/**
 * Where streamed chunks come from (content map today, Silnik 2's generator later).
 *
 * Contract: `getChunk(cx, cy)` is a pure deterministic function of (seed, version, cx, cy): no
 * global mutable state, same inputs → same chunk, any call order. The streamer may call it
 * concurrently, cancel it (signal), and call it again for the same chunk after unloading.
 * Palettes are world-wide and fixed for the source's lifetime.
 */
export interface WorldChunkSource {
  /** Human-readable id, e.g. `content:base:test-town`, `gen:deadzone`, `stress`. */
  readonly id: string;
  /** Generator / map format version; part of every cache key (seed + version = world). */
  readonly version: string;
  readonly seed: number;
  /** Tiles per chunk side; must equal CHUNK_SIZE (the sim grid). */
  readonly chunkSize: number;
  readonly bounds: ChunkBounds;
  /** Inclusive floor-level range present in the world (e.g. { min: 0, max: 2 }). */
  readonly levels: { readonly min: number; readonly max: number };
  /** TileId → content id (floor and roof layers). Index 0 = empty. */
  readonly tilePalette: readonly (ContentId | null)[];
  /** Edge id → edge type (edgeN / edgeW layers). Index 0 = none. */
  readonly edgePalette?: readonly (EdgeDef | null)[];
  /** Full chunk column; undefined outside the world. Must not mutate returned data later. */
  getChunk(cx: number, cy: number, signal?: AbortSignal): Promise<WorldChunk | undefined>;
  /** Optional cheap far-LOD data (macro plan); the streamer falls back to `getChunk`. */
  getSummary?(cx: number, cy: number): ChunkSummary | undefined;
}

export const inBounds = (b: ChunkBounds, cx: number, cy: number): boolean =>
  cx >= b.cx0 && cx <= b.cx1 && cy >= b.cy0 && cy <= b.cy1;

/** Adapts today's in-memory renderer ChunkSource (content map / test map) as a streaming source. */
export function chunkSourceToWorld(
  source: ChunkSource,
  range: ChunkRange,
  id: string,
  seed = 0,
  version = 'content-1',
): WorldChunkSource {
  return {
    id,
    version,
    seed,
    chunkSize: CHUNK_SIZE,
    bounds: { cx0: range.cx0, cy0: range.cy0, cx1: range.cx1, cy1: range.cy1 },
    levels: { min: range.z, max: range.z },
    tilePalette: source.tilePalette,
    ...(source.edgePalette ? { edgePalette: source.edgePalette } : {}),
    getChunk(cx, cy) {
      const data = source.getChunk(cx, cy, range.z);
      if (!data) return Promise.resolve(undefined);
      return Promise.resolve({ cx, cy, levels: new Map([[range.z, data]]) });
    },
  };
}

/**
 * Synchronous ChunkSource view of the chunks the streamer currently holds, for the per-chunk
 * render layers (terrain, structures, building lookup) that read neighbours synchronously.
 */
export class LoadedChunks implements ChunkSource {
  private readonly chunks = new Map<string, WorldChunk>();

  readonly tilePalette: readonly (ContentId | null)[];
  readonly edgePalette?: readonly (EdgeDef | null)[];

  constructor(world: WorldChunkSource) {
    this.tilePalette = world.tilePalette;
    if (world.edgePalette) this.edgePalette = world.edgePalette;
  }

  get size(): number {
    return this.chunks.size;
  }

  set(chunk: WorldChunk): void {
    this.chunks.set(`${chunk.cx},${chunk.cy}`, chunk);
  }

  delete(cx: number, cy: number): void {
    this.chunks.delete(`${cx},${cy}`);
  }

  column(cx: number, cy: number): WorldChunk | undefined {
    return this.chunks.get(`${cx},${cy}`);
  }

  getChunk(cx: number, cy: number, z: number): ChunkData | undefined {
    return this.chunks.get(`${cx},${cy}`)?.levels.get(z);
  }
}
