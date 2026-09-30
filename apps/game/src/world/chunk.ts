/**
 * Local chunk contract for the renderer. The shared map format is still being agreed,
 * so this lives in apps/game and only describes what the client reads.
 */
export const CHUNK_SIZE = 32;
export const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;

/** Content id, e.g. `base:concrete-floor`. */
export type ContentId = `${string}:${string}`;

/** Value stored in a tile layer. 0 = empty, otherwise an index into `ChunkSource.tilePalette`. */
export type TileId = number;
export const EMPTY_TILE: TileId = 0;

export interface ChunkCoord {
  readonly cx: number;
  readonly cy: number;
  /** Floor level (0 = ground). */
  readonly z: number;
}

export interface ChunkData {
  readonly coord: ChunkCoord;
  /** CHUNK_TILES entries, indexed `y * CHUNK_SIZE + x`. */
  readonly floor: Uint16Array;
  // Planned: roof (Uint16Array, hidden together with walls by buildingId), edges, objects, rooms.
}

export interface ChunkSource {
  /** Maps TileId -> content id. Index 0 (empty) is unused. */
  readonly tilePalette: readonly (ContentId | null)[];
  /** Returns undefined for chunks outside the map. */
  getChunk(cx: number, cy: number, z: number): ChunkData | undefined;
}

/** Inclusive rectangle of chunks on one level. */
export interface ChunkRange {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  z: number;
}

export const tileIndex = (x: number, y: number): number => y * CHUNK_SIZE + x;
