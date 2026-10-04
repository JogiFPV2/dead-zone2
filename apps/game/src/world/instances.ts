import { CHUNK_SIZE, EMPTY_TILE, type ChunkData, type TileId } from './chunk.js';

/** World height of one floor level. */
export const LEVEL_HEIGHT = 3;

export interface TileInstances {
  tileId: TileId;
  count: number;
  /** Column-major 4x4 matrices (three.js layout), 16 floats per instance. */
  matrices: Float32Array;
}

/**
 * Groups non-empty floor tiles of a chunk by TileId and builds translation matrices.
 * 1 tile = 1 world unit; matrices are relative to the chunk origin (world X = cx*32, Z = cy*32,
 * where the chunk's group sits — floating origin, float32 instance buffers): tile (x, y) is
 * centred at local X = x + 0.5, Z = y + 0.5, Y = z * LEVEL_HEIGHT.
 */
export function buildTileInstances(chunk: ChunkData): TileInstances[] {
  const { floor, coord } = chunk;
  const counts = new Map<TileId, number>();
  for (const id of floor) if (id !== EMPTY_TILE) counts.set(id, (counts.get(id) ?? 0) + 1);

  const groups = new Map<TileId, TileInstances & { next: number }>();
  for (const [tileId, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    groups.set(tileId, { tileId, count, matrices: new Float32Array(count * 16), next: 0 });
  }

  const ox = 0.5;
  const oz = 0.5;
  const y = coord.z * LEVEL_HEIGHT;

  for (let i = 0; i < floor.length; i++) {
    const id = floor[i] ?? EMPTY_TILE;
    const g = groups.get(id);
    if (!g) continue;
    const o = g.next++ * 16;
    const m = g.matrices;
    m[o] = 1;
    m[o + 5] = 1;
    m[o + 10] = 1;
    m[o + 15] = 1;
    m[o + 12] = ox + (i % CHUNK_SIZE);
    m[o + 13] = y;
    m[o + 14] = oz + Math.floor(i / CHUNK_SIZE);
  }

  return [...groups.values()].map(({ tileId, count, matrices }) => ({ tileId, count, matrices }));
}
