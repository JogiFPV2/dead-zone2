import { CHUNK_SIZE, NO_BUILDING, tileIndex, type BuildingId, type ChunkData } from './chunk.js';

/** Anything that serves chunks (a ChunkSource, or a test stub). */
export interface ChunkGetter {
  getChunk(cx: number, cy: number, z: number): ChunkData | undefined;
}

/** World tile containing a floor point (sim x, y). */
export const tileOf = (x: number, y: number): { tx: number; ty: number } => ({
  tx: Math.floor(x),
  ty: Math.floor(y),
});

/** Building of the room at world tile (tx, ty) on level z, or NO_BUILDING. */
export function buildingInChunk(chunk: ChunkData | undefined, tx: number, ty: number): BuildingId {
  if (!chunk?.room || !chunk.rooms) return NO_BUILDING;
  const lx = tx - chunk.coord.cx * CHUNK_SIZE;
  const ly = ty - chunk.coord.cy * CHUNK_SIZE;
  if (lx < 0 || ly < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE) return NO_BUILDING;
  const roomId = chunk.room[tileIndex(lx, ly)] ?? 0;
  return roomId === 0 ? NO_BUILDING : (chunk.rooms.get(roomId)?.buildingId ?? NO_BUILDING);
}

/** tile -> room -> buildingId lookup across chunks, caching fetched chunks. */
export class BuildingLookup {
  private readonly cache = new Map<string, ChunkData | undefined>();

  /**
   * `cache: false` for sources that are already a cheap lookup and change over time (the
   * streamer's loaded chunks): nothing is pinned in memory, unloaded chunks are not remembered.
   */
  constructor(
    private readonly source: ChunkGetter,
    private readonly cacheChunks = true,
  ) {}

  at(tx: number, ty: number, z: number): BuildingId {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    if (!this.cacheChunks) return buildingInChunk(this.source.getChunk(cx, cy, z), tx, ty);
    const key = `${cx},${cy},${z}`;
    if (!this.cache.has(key)) this.cache.set(key, this.source.getChunk(cx, cy, z));
    return buildingInChunk(this.cache.get(key), tx, ty);
  }

  /** Building owning the edge: the tile's own building, else the neighbour across the edge. */
  edge(axis: EdgeAxis, tx: number, ty: number, z: number): BuildingId {
    const own = this.at(tx, ty, z);
    if (own !== NO_BUILDING) return own;
    return axis === 'N' ? this.at(tx, ty - 1, z) : this.at(tx - 1, ty, z);
  }
}

/** N = north border of a tile (runs along X), W = west border (runs along Z). */
export type EdgeAxis = 'N' | 'W';
