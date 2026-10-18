import {
  CHUNK_TILES,
  simMapToData,
  type SimChunk,
  type SimChunkAddress,
  type SimChunkRange,
  type SimMap,
  type SimEdgeKind,
  type SimMapData,
} from '@deadzone/protocol';
import type { ChunkData, ChunkSource, EdgeDef } from './chunk.js';

/** Shared all-zero edge layer for chunks without edges. Read-only by contract. */
const NO_EDGES = new Uint16Array(CHUNK_TILES);

/**
 * Sim edge kind per edge palette id: doors, windows and fences become sim openings (state,
 * crowd pressure, a knocked-over fence); walls stay walls.
 */
export function edgeKindsOf(
  palette: readonly (EdgeDef | null)[] | undefined,
): (SimEdgeKind | null)[] | undefined {
  return palette?.map((d) => d?.kind ?? null);
}

/** Room id → room type (keys as strings, the sim's `SimChunk.rooms` shape). */
function roomTypes(data: ChunkData): Record<string, string> | undefined {
  if (!data.rooms || data.rooms.size === 0) return undefined;
  const out: Record<string, string> = {};
  for (const [id, info] of data.rooms) out[String(id)] = info.type;
  return out;
}

/**
 * Room id → global building id (the sim's `SimChunk.roomBuildings`; room ids are chunk-local in
 * the sim contract, docs/sim-architecture.md 9.24). Rooms without a building are left out.
 */
function roomBuildings(data: ChunkData): Record<string, number> | undefined {
  if (!data.rooms || data.rooms.size === 0) return undefined;
  let out: Record<string, number> | undefined;
  for (const [id, info] of data.rooms)
    if (info.buildingId > 0) (out ??= {})[String(id)] = info.buildingId;
  return out;
}

/**
 * Adapter from the renderer's ChunkSource to the sim's SimMap: floor ids unchanged
 * (0 = no floor), missing edge layers become empty, `edgeKinds` from the edge palette (doors,
 * windows and fences are sim openings, closed by default; the player opens doors with F). Rooms (layer +
 * room types) and map objects are passed through, so the sim creates world storage with the
 * right loot tables. With `range`, `listChunks` lists its existing chunks (world storage is
 * created from them). Adapted chunks are cached, because ChunkSource implementations may build
 * them on every call. `floorTiles` = the renderer's `tilePalette`.
 */
export function chunkSourceToSimMap(source: ChunkSource, range?: SimChunkRange): SimMap {
  const cache = new Map<string, SimChunk | undefined>();
  const getChunk = (cx: number, cy: number, z: number): SimChunk | undefined => {
    const key = `${cx},${cy},${z}`;
    if (cache.has(key)) return cache.get(key);
    const data = source.getChunk(cx, cy, z);
    let chunk: SimChunk | undefined;
    if (data) {
      const rooms = roomTypes(data);
      const buildings = roomBuildings(data);
      chunk = {
        floor: data.floor,
        edgeN: data.edgeN ?? NO_EDGES,
        edgeW: data.edgeW ?? NO_EDGES,
        ...(data.room ? { room: data.room, rooms: rooms ?? {} } : {}),
        ...(data.room && buildings ? { roomBuildings: buildings } : {}),
        ...(data.objects?.length
          ? {
              objects: data.objects.map(({ contentId, x, y, rot }) => ({
                contentId,
                x,
                y,
                ...(rot & 3 ? { rot: rot & 3 } : {}),
              })),
            }
          : {}),
        ...(data.stairs?.length ? { stairs: data.stairs.map((st) => ({ ...st })) } : {}),
        ...(data.vehicles?.length ? { vehicles: data.vehicles.map((v) => ({ ...v })) } : {}),
      };
    }
    cache.set(key, chunk);
    return chunk;
  };
  const kinds = edgeKindsOf(source.edgePalette);
  // Floor palette: the sim picks scattered loot tiles by content tile id (`lootTable.scatter`).
  const extra = { floorTiles: source.tilePalette, ...(kinds ? { edgeKinds: kinds } : {}) };
  if (!range) return { getChunk, ...extra };
  let list: SimChunkAddress[] | undefined;
  return {
    getChunk,
    ...extra,
    listChunks: () => {
      if (!list) {
        list = [];
        for (const z of levelsOf(getChunk, range)) {
          for (let cy = range.cy0; cy <= range.cy1; cy++) {
            for (let cx = range.cx0; cx <= range.cx1; cx++) {
              if (getChunk(cx, cy, z)) list.push({ cx, cy, z });
            }
          }
        }
      }
      return list;
    },
  };
}

/** Highest floor level a map may have (blueprint floors go up to z = 15). */
export const MAX_MAP_LEVEL = 15;

/** Levels `range.z`, `range.z + 1`, ... that have at least one chunk in `range` (stops at a gap). */
export function levelsOf(
  getChunk: (cx: number, cy: number, z: number) => unknown,
  range: SimChunkRange,
): number[] {
  const out: number[] = [];
  for (let z = range.z; z <= MAX_MAP_LEVEL; z++) {
    let any = false;
    for (let cy = range.cy0; cy <= range.cy1 && !any; cy++)
      for (let cx = range.cx0; cx <= range.cx1 && !any; cx++) any = !!getChunk(cx, cy, z);
    if (!any) break;
    out.push(z);
  }
  return out;
}

/**
 * Serializable map for `createSimWorkerClient(worker).init(seed, map)`: every floor level of
 * `range` (upper floors and stairs; the sim reads chunks by (cx, cy, z)).
 */
export function chunkSourceToSimMapData(source: ChunkSource, range: SimChunkRange): SimMapData {
  const map = chunkSourceToSimMap(source, range);
  const levels = levelsOf((cx, cy, z) => map.getChunk(cx, cy, z), range);
  const first = simMapToData(map, range);
  if (levels.length <= 1) return first;
  const upper = levels.slice(1).flatMap((z) => simMapToData(map, { ...range, z }).chunks);
  return { ...first, chunks: [...first.chunks, ...upper] };
}
