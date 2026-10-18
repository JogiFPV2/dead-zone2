import {
  CHUNK_SIZE,
  CHUNK_TILES,
  simMapFromData,
  type SimMap,
  type SimEdgeKind,
  type SimMapChunkData,
  type SimZone,
} from '@deadzone/protocol';

export interface MapSpec {
  /** Size in tiles, starting at (0, 0). Must be a multiple of CHUNK_SIZE. */
  width?: number;
  height?: number;
  /** Floor id at tile (default 1 = floor everywhere). */
  floor?: (x: number, y: number) => number;
  wallN?: (x: number, y: number) => boolean;
  wallW?: (x: number, y: number) => boolean;
  /** Map objects in world tiles (storage, placeables). */
  objects?: readonly { contentId: string; x: number; y: number; rot?: number }[];
  /** Room id per world tile (0 = outside) and room id → room type (same for every chunk). */
  room?: (x: number, y: number) => number;
  rooms?: Record<string, string>;
  /** Room id → building id (same for every chunk). */
  roomBuildings?: Record<string, number>;
  /** `SimChunk.buildingKinds` (#249), building id → generator kind; set on every chunk. */
  buildingKinds?: Record<string, string>;
  /** Floors 0..levels − 1, all the same as level 0 (default 1). */
  levels?: number;
  /** Edge id of walls (default 1), with `edgeKinds` as the palette (e.g. 2 = window). */
  edgeId?: (x: number, y: number) => number;
  edgeKinds?: readonly (SimEdgeKind | null)[];
  zones?: readonly SimZone[];
  /** Floor palette (content tile id per floor value). */
  floorTiles?: readonly (string | null)[];
}

/** Builds an in-memory map on level 0 covering [0, width) × [0, height). */
export function buildMap(spec: MapSpec = {}): SimMap {
  const width = spec.width ?? CHUNK_SIZE * 2;
  const height = spec.height ?? CHUNK_SIZE * 2;
  const chunks: SimMapChunkData[] = [];
  for (let cy = 0; cy < height / CHUNK_SIZE; cy++) {
    for (let cx = 0; cx < width / CHUNK_SIZE; cx++) {
      const floor = new Uint16Array(CHUNK_TILES);
      const edgeN = new Uint16Array(CHUNK_TILES);
      const edgeW = new Uint16Array(CHUNK_TILES);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = cx * CHUNK_SIZE + lx;
          const y = cy * CHUNK_SIZE + ly;
          const i = ly * CHUNK_SIZE + lx;
          floor[i] = spec.floor ? spec.floor(x, y) : 1;
          const id = spec.edgeId?.(x, y) ?? 1;
          edgeN[i] = spec.wallN?.(x, y) ? id : 0;
          edgeW[i] = spec.wallW?.(x, y) ? id : 0;
        }
      }
      const room = new Uint16Array(CHUNK_TILES);
      if (spec.room) {
        for (let i = 0; i < CHUNK_TILES; i++) {
          room[i] = spec.room(
            cx * CHUNK_SIZE + (i % CHUNK_SIZE),
            cy * CHUNK_SIZE + ((i / CHUNK_SIZE) | 0),
          );
        }
      }
      const objects = (spec.objects ?? [])
        .filter((o) => Math.floor(o.x / CHUNK_SIZE) === cx && Math.floor(o.y / CHUNK_SIZE) === cy)
        .map((o) => ({
          contentId: o.contentId,
          x: o.x - cx * CHUNK_SIZE,
          y: o.y - cy * CHUNK_SIZE,
          ...(o.rot !== undefined ? { rot: o.rot } : {}),
        }));
      for (let z = 0; z < (spec.levels ?? 1); z++) {
        chunks.push({
          cx,
          cy,
          z,
          floor,
          edgeN,
          edgeW,
          ...(spec.room ? { room, rooms: spec.rooms ?? {} } : {}),
          ...(spec.room && spec.roomBuildings ? { roomBuildings: spec.roomBuildings } : {}),
          ...(spec.buildingKinds ? { buildingKinds: spec.buildingKinds } : {}),
          ...(objects.length > 0 && z === 0 ? { objects } : {}),
        });
      }
    }
  }
  return simMapFromData({
    chunks,
    ...(spec.zones ? { zones: spec.zones } : {}),
    ...(spec.edgeKinds ? { edgeKinds: spec.edgeKinds } : {}),
    ...(spec.floorTiles ? { floorTiles: spec.floorTiles } : {}),
  });
}
