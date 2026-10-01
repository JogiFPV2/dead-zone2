import {
  CHUNK_TILES,
  simMapToData,
  type SimChunk,
  type SimChunkAddress,
  type SimChunkRange,
  type SimMap,
  type SimMapData,
} from '@deadzone/protocol';
import type { ChunkData, ChunkSource, EdgeDef } from './chunk.js';

/** Shared all-zero edge layer for chunks without edges. Read-only by contract. */
const NO_EDGES = new Uint16Array(CHUNK_TILES);

/**
 * Keeps blocking edges and drops passable ones. Doors are open until the sim has door state
 * (docs/sim-architecture.md, `doors`), so the house in the test map can be entered.
 */
function blockingEdges(
  layer: Uint16Array | undefined,
  palette: readonly (EdgeDef | null)[] | undefined,
): Uint16Array {
  if (!layer) return NO_EDGES;
  if (!palette?.some((d) => d?.kind === 'door')) return layer;
  const out = new Uint16Array(CHUNK_TILES);
  for (let i = 0; i < CHUNK_TILES; i++) {
    const id = layer[i] ?? 0;
    out[i] = palette[id]?.kind === 'door' ? 0 : id;
  }
  return out;
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
 * (0 = no floor), missing edge layers become empty, door edges become passable. Rooms (layer +
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
        edgeN: blockingEdges(data.edgeN, source.edgePalette),
        edgeW: blockingEdges(data.edgeW, source.edgePalette),
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
  // Floor palette: the sim picks scattered loot tiles by content tile id (`lootTable.scatter`).
  const floorTiles = source.tilePalette;
  if (!range) return { getChunk, floorTiles };
  let list: SimChunkAddress[] | undefined;
  return {
    getChunk,
    floorTiles,
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
