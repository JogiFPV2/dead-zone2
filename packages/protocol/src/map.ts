/** Map access contract shared by sim and render (docs/sim-architecture.md, "Kontrakt mapy"). */
export const CHUNK_SIZE = 32;
export const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;

/** 0 in `floor` = no floor (void, blocks movement); 0 in an edge layer = no wall. */
export const EMPTY_TILE = 0;

/**
 * One 32×32 chunk. Every layer is a `Uint16Array` of `CHUNK_TILES` entries indexed `y * 32 + x`.
 * `edgeN[i]` is the wall on the north side of tile i (line y = tileY), `edgeW[i]` on the west
 * side (line x = tileX). Any non-zero id blocks movement (wall, window, door for now).
 */
export interface SimChunk {
  readonly floor: Uint16Array;
  readonly edgeN: Uint16Array;
  readonly edgeW: Uint16Array;
  /** Room id per tile (0 = outside), keys of `rooms`; optional (no rooms = outside). */
  readonly room?: Uint16Array | undefined;
  /** Room id → room type (e.g. `base:room-kitchen`, picks loot tables). */
  readonly rooms?: Readonly<Record<string, string>> | undefined;
  /**
   * Map objects (chunk `objects` in content): storage types (`containers/`) and placeables with
   * `containerType` become world storage; the rest is ignored by the sim for now.
   */
  readonly objects?: readonly SimMapObject[] | undefined;
}

/** A map object at local tile (x, y) of its chunk. */
export interface SimMapObject {
  readonly contentId: string;
  readonly x: number;
  readonly y: number;
}

export interface SimChunkAddress {
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
}

export interface SimMap {
  /** Returns undefined for chunks outside the map (treated as solid). */
  getChunk(cx: number, cy: number, z: number): SimChunk | undefined;
  /** All chunks (world storage is created from their objects); optional for plain maps. */
  listChunks?(): readonly SimChunkAddress[];
}

export const tileIndex = (x: number, y: number): number => y * CHUNK_SIZE + x;

/** Structured-clone friendly form of a map, used to send it to the worker. */
export interface SimMapChunkData extends SimChunk {
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
}
export interface SimMapData {
  readonly chunks: readonly SimMapChunkData[];
}

const chunkKey = (cx: number, cy: number, z: number): string => `${cx},${cy},${z}`;

function checkLayer(layer: Uint16Array, name: string): void {
  if (!(layer instanceof Uint16Array) || layer.length !== CHUNK_TILES) {
    throw new Error(`SimChunk.${name} must be a Uint16Array(${CHUNK_TILES})`);
  }
}

/** Builds an in-memory `SimMap` from serialized chunks (throws on malformed layers). */
export function simMapFromData(data: SimMapData): SimMap {
  const chunks = new Map<string, SimChunk>();
  for (const c of data.chunks) {
    checkLayer(c.floor, 'floor');
    checkLayer(c.edgeN, 'edgeN');
    checkLayer(c.edgeW, 'edgeW');
    if (c.room) checkLayer(c.room, 'room');
    chunks.set(chunkKey(c.cx, c.cy, c.z), {
      floor: c.floor,
      edgeN: c.edgeN,
      edgeW: c.edgeW,
      room: c.room,
      rooms: c.rooms,
      objects: c.objects,
    });
  }
  const list: SimChunkAddress[] = data.chunks.map(({ cx, cy, z }) => ({ cx, cy, z }));
  return {
    getChunk: (cx, cy, z) => chunks.get(chunkKey(cx, cy, z)),
    listChunks: () => list,
  };
}

/** Inclusive chunk rectangle on one level. */
export interface SimChunkRange {
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  z: number;
}

/** Copies the chunks of `range` out of any `SimMap` (e.g. to post them to the worker). */
export function simMapToData(map: SimMap, range: SimChunkRange): SimMapData {
  const chunks: SimMapChunkData[] = [];
  for (let cy = range.cy0; cy <= range.cy1; cy++) {
    for (let cx = range.cx0; cx <= range.cx1; cx++) {
      const c = map.getChunk(cx, cy, range.z);
      if (!c) continue;
      chunks.push({
        cx,
        cy,
        z: range.z,
        floor: c.floor.slice(),
        edgeN: c.edgeN.slice(),
        edgeW: c.edgeW.slice(),
        ...(c.room ? { room: c.room.slice() } : {}),
        ...(c.rooms ? { rooms: { ...c.rooms } } : {}),
        ...(c.objects ? { objects: c.objects.map((o) => ({ ...o })) } : {}),
      });
    }
  }
  return { chunks };
}
