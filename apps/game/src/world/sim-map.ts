import {
  CHUNK_TILES,
  simMapToData,
  type SimChunk,
  type SimChunkRange,
  type SimMap,
  type SimMapData,
} from '@deadzone/protocol';
import type { ChunkSource, EdgeDef } from './chunk.js';

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

/**
 * Minimal adapter from the renderer's ChunkSource to the sim's SimMap: floor ids unchanged
 * (0 = no floor), missing edge layers become empty, door edges become passable.
 * Adapted chunks are cached, because ChunkSource implementations may build them on every call.
 */
export function chunkSourceToSimMap(source: ChunkSource): SimMap {
  const cache = new Map<string, SimChunk | undefined>();
  return {
    getChunk(cx, cy, z) {
      const key = `${cx},${cy},${z}`;
      if (cache.has(key)) return cache.get(key);
      const data = source.getChunk(cx, cy, z);
      const chunk = data && {
        floor: data.floor,
        edgeN: blockingEdges(data.edgeN, source.edgePalette),
        edgeW: blockingEdges(data.edgeW, source.edgePalette),
      };
      cache.set(key, chunk);
      return chunk;
    },
  };
}

/** Serializable map for `createSimWorkerClient(worker).init(seed, map)`. */
export function chunkSourceToSimMapData(source: ChunkSource, range: SimChunkRange): SimMapData {
  return simMapToData(chunkSourceToSimMap(source), range);
}
