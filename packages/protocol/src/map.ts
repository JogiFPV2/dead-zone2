/** Map access contract shared by sim and render (docs/sim-architecture.md, "Kontrakt mapy"). */
export const CHUNK_SIZE = 32;
export const CHUNK_TILES = CHUNK_SIZE * CHUNK_SIZE;

/**
 * World size, shared by sim, client and server (docs/backend.md §4.2): 16 × 16 km =
 * `MAP_CHUNKS × MAP_CHUNKS` chunks of `CHUNK_SIZE_M` metres. Import these instead of literals.
 */
export const MAP_CHUNKS = 512;
/** Chunk edge in metres (1 tile = 1 m), same value as `CHUNK_SIZE`. */
export const CHUNK_SIZE_M = CHUNK_SIZE;
/** World edge in metres (16 384 m). */
export const MAP_SIZE_M = MAP_CHUNKS * CHUNK_SIZE_M;

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
  /**
   * Room id per tile (0 = outside), keys of `rooms`; optional (no rooms = outside). Room ids are
   * **local to the chunk** (docs/sim-architecture.md 9.24): unique within this chunk only, so a
   * generator never runs out of Uint16 ids on an 8 × 8 km world. One room spanning several
   * chunks may have a different id in each; it is the same building when `roomBuildings` agree.
   * Content maps keep map-wide unique ids (a valid special case).
   */
  readonly room?: Uint16Array | undefined;
  /** Room id → room type (e.g. `base:room-kitchen`, picks loot tables). */
  readonly rooms?: Readonly<Record<string, string>> | undefined;
  /**
   * Room id → map-global numeric building id (> 0, any safe integer, not limited to Uint16),
   * optional (absent = rooms belong to no known building). Same building = same id everywhere.
   */
  readonly roomBuildings?: Readonly<Record<string, number>> | undefined;
  /**
   * Map objects (chunk `objects` in content): storage types (`containers/`) and placeables with
   * `containerType` become world storage; the rest is ignored by the sim for now.
   */
  readonly objects?: readonly SimMapObject[] | undefined;
  /**
   * Doors / gates locked at the start (protocol 26, generator's choice): `tileIndex(x, y) * 2 +
   * side` (side 0 = north edge, 1 = west edge of that tile). Present (even empty) = the sim does
   * not roll `openings.locks.exteriorLockedChance` for this chunk. Keys: `roomBuildings`.
   */
  readonly lockedDoors?: readonly number[] | undefined;
  /**
   * Flights of stairs starting on this chunk's level `z` and leading to z + 1 (sim
   * `world/levels.ts`). Optional; a chunk without stairs omits it.
   */
  readonly stairs?: readonly SimStairs[] | undefined;
  /**
   * Parked cars on this chunk's level (generator, docs/sim-architecture.md 9.36). The sim spawns
   * them once, when the chunk first goes live (LOD) or at init (whole map), with seeded rolls
   * for lock / key / fuel from `worldSettings.vehicles.spawn`. Optional.
   */
  readonly vehicles?: readonly SimChunkVehicle[] | undefined;
}

/**
 * A parked car in chunk data: centre in **local tiles** of the chunk (float, 0 ≤ x, y < 32),
 * heading in radians (0 = +x / east, π/2 = +y; default 0), vehicle type content id (default
 * `worldSettings.vehicles.spawn.defaultType`).
 */
export interface SimChunkVehicle {
  readonly x: number;
  readonly y: number;
  readonly heading?: number | undefined;
  readonly type?: string | undefined;
}

/** Direction of ascent of a flight (N = towards −y, E = +x, S = +y, W = −x). */
export const STAIR_DIRS = ['N', 'E', 'S', 'W'] as const;
export type StairDir = (typeof STAIR_DIRS)[number];

/**
 * A flight of stairs: bottom tile at local tile (tx, ty) of its chunk, climbing `len` tiles
 * (1..16, may run into the next chunk) in `dir`. Entered only from the bottom edge (the side of
 * the first tile away from `dir`) or from the top (tile (tx, ty) + len × dir on level z + 1).
 */
export interface SimStairs {
  readonly tx: number;
  readonly ty: number;
  readonly dir: StairDir;
  readonly len: number;
}

/** A map object at local tile (x, y) of its chunk. */
export interface SimMapObject {
  readonly contentId: string;
  /** Chunk-local tile; with a footprint the north-west tile of the occupied rectangle. */
  readonly x: number;
  readonly y: number;
  /**
   * Rotation 0–3 (90° clockwise seen from above, back to wall 0 = N, 1 = E, 2 = S, 3 = W), as in
   * content `objects[].rot`. Swaps the footprint sides at 1 / 3 (`@deadzone/content/footprint`).
   * Missing = 0. Only used by the sim with `worldSettings.furnitureFootprint`.
   */
  readonly rot?: number | undefined;
}

export interface SimChunkAddress {
  readonly cx: number;
  readonly cy: number;
  readonly z: number;
}

/**
 * Edge kinds (content `map/edge.ts` types). Windows block movement but not sight; a low `fence`
 * blocks movement only (sim-only for now: a crowd can knock it over, state `broken`). A `gate` is
 * an openable section of a fence (compound fences: hospital, police, army): it opens, closes and
 * locks like a door, zombies bash and force it, it can be barricaded; closed it blocks movement,
 * not sight or sound.
 */
export const SIM_EDGE_KINDS = ['wall', 'window', 'door', 'fence', 'gate'] as const;
export type SimEdgeKind = (typeof SIM_EDGE_KINDS)[number];

/**
 * State of a door / window / gate edge (sim `openings`). Doors and gates: `open` / `closed` /
 * `locked` / `broken` (smashed or forced, passable). Windows: `closed` (blocks movement, not
 * sight), `open` and `broken` (passable slowly). Map default: `closed`. Planks are a separate
 * count (`OpeningView.barricade` 0..4, on top of any state): the sim no longer produces
 * `barricaded` (kept for `debugOpening`, which turns it into `closed` + the maximum of planks).
 */
export const OPENING_STATES = ['open', 'closed', 'locked', 'barricaded', 'broken'] as const;
export type OpeningState = (typeof OPENING_STATES)[number];
/** Edge side of a tile: `n` = north edge (y = ty), `w` = west edge (x = tx). */
export type EdgeSide = 'n' | 'w';

/** Rectangle in global tiles (`x = cx * 32 + lx`). */
export interface SimZoneRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Map zone from the manifest (`zones[]`): a union of rectangles on level `z`. The sim reads
 * role `dark` (unlit areas: a player there without an active light is invisible to zombies).
 */
export interface SimZone {
  readonly id: string;
  readonly role: string;
  readonly z: number;
  readonly rects: readonly SimZoneRect[];
  readonly tags?: readonly string[] | undefined;
}

export interface SimMap {
  /** Returns undefined for chunks outside the map (treated as solid). */
  getChunk(cx: number, cy: number, z: number): SimChunk | undefined;
  /** All chunks (world storage is created from their objects); optional for plain maps. */
  listChunks?(): readonly SimChunkAddress[];
  /** Manifest zones (optional). */
  readonly zones?: readonly SimZone[] | undefined;
  /**
   * Edge palette: kind of each non-zero edge id in `edgeN`/`edgeW` (index = id). Without it
   * every edge is a wall (blocks sight); `window` lets sight through.
   */
  readonly edgeKinds?: readonly (SimEdgeKind | null)[] | undefined;
  /**
   * Floor palette: content tile id of each non-zero `floor` value (index = value, e.g. the
   * renderer's global `tilePalette`). Scattered loot picks tiles by it (`lootTable.scatter.terrain`);
   * without it every floor tile matches only tables with an empty `terrain`.
   */
  readonly floorTiles?: readonly (string | null)[] | undefined;
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
  readonly zones?: readonly SimZone[] | undefined;
  readonly edgeKinds?: readonly (SimEdgeKind | null)[] | undefined;
  readonly floorTiles?: readonly (string | null)[] | undefined;
}

const chunkKey = (cx: number, cy: number, z: number): string => `${cx},${cy},${z}`;

function checkLayer(layer: Uint16Array, name: string): void {
  if (!(layer instanceof Uint16Array) || layer.length !== CHUNK_TILES) {
    throw new Error(`SimChunk.${name} must be a Uint16Array(${CHUNK_TILES})`);
  }
}

/** Room id at local tile index `i` of a chunk (0 = outside). Chunk-local, see `SimChunk.room`. */
export function roomIdAt(chunk: SimChunk | undefined, i: number): number {
  return chunk?.room?.[i] ?? 0;
}

/** Global building id of local tile index `i` (0 = outside or no building id). */
export function buildingIdAt(chunk: SimChunk | undefined, i: number): number {
  const room = roomIdAt(chunk, i);
  return room === 0 ? 0 : (chunk?.roomBuildings?.[String(room)] ?? 0);
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
      ...(c.roomBuildings ? { roomBuildings: c.roomBuildings } : {}),
      objects: c.objects,
      ...(c.stairs ? { stairs: c.stairs } : {}),
      ...(c.vehicles ? { vehicles: c.vehicles } : {}),
    });
  }
  const list: SimChunkAddress[] = data.chunks.map(({ cx, cy, z }) => ({ cx, cy, z }));
  return {
    getChunk: (cx, cy, z) => chunks.get(chunkKey(cx, cy, z)),
    listChunks: () => list,
    ...(data.zones ? { zones: data.zones } : {}),
    ...(data.edgeKinds ? { edgeKinds: data.edgeKinds } : {}),
    ...(data.floorTiles ? { floorTiles: data.floorTiles } : {}),
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
        ...(c.roomBuildings ? { roomBuildings: { ...c.roomBuildings } } : {}),
        ...(c.objects ? { objects: c.objects.map((o) => ({ ...o })) } : {}),
        ...(c.stairs ? { stairs: c.stairs.map((st) => ({ ...st })) } : {}),
        ...(c.vehicles ? { vehicles: c.vehicles.map((v) => ({ ...v })) } : {}),
      });
    }
  }
  return {
    chunks,
    ...(map.zones
      ? { zones: map.zones.map((zn) => ({ ...zn, rects: zn.rects.map((r) => ({ ...r })) })) }
      : {}),
    ...(map.edgeKinds ? { edgeKinds: [...map.edgeKinds] } : {}),
    ...(map.floorTiles ? { floorTiles: [...map.floorTiles] } : {}),
  };
}
