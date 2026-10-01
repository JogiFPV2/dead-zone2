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
  /**
   * Optional wall edges (CHUNK_TILES entries, 0 = none, else index into `ChunkSource.edgePalette`),
   * mirrored from the sim's SimMap shape. edgeN[i] is the tile's north border (line Z = tile row),
   * edgeW[i] its west border (line X = tile column).
   */
  readonly edgeN?: Uint16Array;
  readonly edgeW?: Uint16Array;
  /** Optional roof layer (CHUNK_TILES entries, 0 = none, else index into `tilePalette`). */
  readonly roof?: Uint16Array;
  /** Optional room layer (CHUNK_TILES entries, 0 = outside, else a RoomId from `rooms`). */
  readonly room?: Uint16Array;
  /** Rooms referenced by `room`. Room ids are unique within the whole map. */
  readonly rooms?: ReadonlyMap<RoomId, RoomInfo>;
  /** Static map objects (furniture, storage, lights) at local tiles. Dynamic state is never here. */
  readonly objects?: readonly MapObjectRef[];
  /** Flights of stairs from this level to z + 1 (content `stairs`, sim `SimChunk.stairs`). */
  readonly stairs?: readonly StairsRef[];
}

/** A flight of stairs: bottom tile (tx, ty) local to the chunk, `len` tiles climbing `dir`. */
export interface StairsRef {
  readonly tx: number;
  readonly ty: number;
  readonly dir: 'N' | 'E' | 'S' | 'W';
  readonly len: number;
}

/** A map object at local tile (x, y) of its chunk (content `objects`). */
export interface MapObjectRef {
  readonly contentId: ContentId;
  readonly x: number;
  readonly y: number;
  /** Rotation in 90° steps (0..3). */
  readonly rot: number;
}

/** 0 = outside. */
export type RoomId = number;
/** 0 = not a building. */
export type BuildingId = number;
export const NO_BUILDING: BuildingId = 0;

export interface RoomInfo {
  /** Room type content id, e.g. `base:room-kitchen`. */
  readonly type: ContentId;
  readonly buildingId: BuildingId;
}

/** How the renderer draws an edge type; the kind itself comes from content. */
export type EdgeKind = 'wall' | 'window' | 'door';

export interface EdgeDef {
  readonly id: ContentId;
  readonly kind: EdgeKind;
}

export interface ChunkSource {
  /** Maps TileId -> content id. Index 0 (empty) is unused. */
  readonly tilePalette: readonly (ContentId | null)[];
  /** Maps edge ids (edgeN/edgeW values) -> edge type. Index 0 (none) is unused. */
  readonly edgePalette?: readonly (EdgeDef | null)[];
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
