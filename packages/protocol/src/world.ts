import { CHUNK_SIZE, type SimChunk, type SimEdgeKind, type SimMap, type SimZone } from './map.js';

/**
 * World source contract (docs/sim-architecture.md 9.24): what the sim needs from a world
 * generator (Engine 2) to run a big map lazily. The sim only ever asks for chunks near players
 * (active area + hysteresis) and for `chunkKind` once per chunk when it seeds coarse zombie
 * counts. Everything must be a pure function of `(seed, generatorVersion, cx, cy, z)`: the same
 * call always returns a chunk with the same layers, rooms, objects (same order) and stairs.
 * Saves store only `seed` + `generatorVersion` + a delta (sim `save/`), so a generator change
 * that alters any chunk must bump `generatorVersion`.
 */
export interface WorldSource {
  /** World (generator) seed, saved in the save header and checked on load. */
  readonly seed: number;
  /** Bump whenever generated chunks change; saves from another version are refused (code `generator-version`) unless `acceptsGeneratorVersion` says yes. */
  readonly generatorVersion: number;
  /** Inclusive chunk rectangle and level range of the world. */
  readonly bounds: WorldBounds;
  /** Chunk at (cx, cy, z); undefined = solid / outside. May be generated on demand and cached by the caller. */
  getChunk(cx: number, cy: number, z: number): SimChunk | undefined;
  /**
   * Zone kind of a chunk column for coarse zombie density (`worldSettings.simLod.zombiesPerChunk`
   * keys: `centrum`, `uslugi`, `bloki`, `domy`, `przemysl`, `wies`, `farma`, `pola`, `las`,
   * `woda`, `wojsko`, `ruiny`); undefined = `defaultZombiesPerChunk`.
   */
  chunkKind?(cx: number, cy: number): string | undefined;
  /**
   * Lazily loaded worlds (OSM tiles fetched in the background): false while the data of chunk
   * column (cx, cy) is not in yet, so `getChunk` there is a placeholder (undefined) that must
   * not be cached or acted on (world storage, stairs). Absent = always ready.
   */
  ready?(cx: number, cy: number): boolean;
  /** Migration hook: saves made with generator version `v` load unchanged (the generator still produces identical chunks for them). */
  acceptsGeneratorVersion?(v: number): boolean;
  /** Global palettes and zones, as on `SimMap`. */
  readonly zones?: readonly SimZone[] | undefined;
  readonly edgeKinds?: readonly (SimEdgeKind | null)[] | undefined;
  readonly floorTiles?: readonly (string | null)[] | undefined;
}

export interface WorldBounds {
  readonly cx0: number;
  readonly cy0: number;
  readonly cx1: number;
  readonly cy1: number;
  readonly z0: number;
  readonly z1: number;
}

export const worldWidthChunks = (b: WorldBounds): number => b.cx1 - b.cx0 + 1;
export const worldHeightChunks = (b: WorldBounds): number => b.cy1 - b.cy0 + 1;

/** Bounds of a map with `listChunks` (undefined for lazy maps or no chunks). */
export function mapBounds(map: SimMap): WorldBounds | undefined {
  const list = map.listChunks?.();
  if (!list || list.length === 0) return undefined;
  let cx0 = Infinity;
  let cy0 = Infinity;
  let cx1 = -Infinity;
  let cy1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const a of list) {
    cx0 = Math.min(cx0, a.cx);
    cy0 = Math.min(cy0, a.cy);
    cx1 = Math.max(cx1, a.cx);
    cy1 = Math.max(cy1, a.cy);
    z0 = Math.min(z0, a.z);
    z1 = Math.max(z1, a.z);
  }
  return { cx0, cy0, cx1, cy1, z0, z1 };
}

/**
 * Adapter for the in-memory demo map (`simMapFromData`): a `WorldSource` over a ready `SimMap`
 * (generator version 0 = "static map"; the map itself is the generator output).
 */
export function worldSourceFromMap(
  map: SimMap,
  opts: {
    seed: number;
    generatorVersion?: number;
    chunkKind?: (cx: number, cy: number) => string | undefined;
  },
): WorldSource {
  const bounds = mapBounds(map) ?? { cx0: 0, cy0: 0, cx1: 0, cy1: 0, z0: 0, z1: 0 };
  return {
    seed: opts.seed | 0,
    generatorVersion: opts.generatorVersion ?? 0,
    bounds,
    getChunk: (cx, cy, z) => map.getChunk(cx, cy, z),
    ...(opts.chunkKind ? { chunkKind: opts.chunkKind } : {}),
    ...(map.zones ? { zones: map.zones } : {}),
    ...(map.edgeKinds ? { edgeKinds: map.edgeKinds } : {}),
    ...(map.floorTiles ? { floorTiles: map.floorTiles } : {}),
  };
}

/**
 * Lazy `SimMap` over a world source: chunks are generated on first access and kept in an LRU
 * cache of `cacheChunks` (default 1024 ≈ 6 MiB of layers). No `listChunks` (the world is too
 * big to enumerate): map-wide init scans (stairs, lights, animals) see nothing; the sim LOD
 * spawns world storage and loot per chunk instead.
 */
export function simMapFromWorldSource(src: WorldSource, cacheChunks = 1024): SimMap {
  // Two-generation cache (≈ LRU without bookkeeping on hits): recent chunks in `cur`, the
  // previous generation in `old`; a hit in `old` is promoted, a full `cur` becomes `old`.
  let cur = new Map<number, SimChunk | null>();
  let old = new Map<number, SimChunk | null>();
  const half = Math.max(1, cacheChunks >> 1);
  const { cx0, cy0, cx1, cy1, z0, z1 } = src.bounds;
  const w = cx1 - cx0 + 1;
  const h = cy1 - cy0 + 1;
  return {
    getChunk(cx, cy, z) {
      if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1 || z < z0 || z > z1) return undefined;
      const key = ((z - z0) * h + (cy - cy0)) * w + (cx - cx0);
      let c = cur.get(key);
      if (c === undefined) {
        c = old.get(key);
        if (c === undefined) {
          // Data not loaded yet: answer without caching, so the chunk comes once it is in.
          if (src.ready && !src.ready(cx, cy)) return src.getChunk(cx, cy, z);
          c = src.getChunk(cx, cy, z) ?? null;
        }
        if (cur.size >= half) {
          old = cur;
          cur = new Map();
        }
        cur.set(key, c);
      }
      return c ?? undefined;
    },
    ...(src.ready ? { ready: (cx: number, cy: number) => src.ready!(cx, cy) } : {}),
    ...(src.zones ? { zones: src.zones } : {}),
    ...(src.edgeKinds ? { edgeKinds: src.edgeKinds } : {}),
    ...(src.floorTiles ? { floorTiles: src.floorTiles } : {}),
  };
}

/** Chunk of a world tile coordinate (floor division). */
export const chunkOfTile = (t: number): number => Math.floor(t / CHUNK_SIZE);
