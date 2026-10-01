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
      chunk = {
        floor: data.floor,
        edgeN: data.edgeN ?? NO_EDGES,
        edgeW: data.edgeW ?? NO_EDGES,
        ...(data.room ? { room: data.room, rooms: rooms ?? {} } : {}),
        ...(data.objects?.length
          ? { objects: data.objects.map(({ contentId, x, y }) => ({ contentId, x, y })) }
          : {}),
        ...(data.stairs?.length ? { stairs: data.stairs.map((st) => ({ ...st })) } : {}),
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
        for (let cy = range.cy0; cy <= range.cy1; cy++) {
          for (let cx = range.cx0; cx <= range.cx1; cx++) {
            if (getChunk(cx, cy, range.z)) list.push({ cx, cy, z: range.z });
          }
        }
      }
      return list;
    },
  };
}

/** Serializable map for `createSimWorkerClient(worker).init(seed, map)`. */
export function chunkSourceToSimMapData(source: ChunkSource, range: SimChunkRange): SimMapData {
  return simMapToData(chunkSourceToSimMap(source, range), range);
}
