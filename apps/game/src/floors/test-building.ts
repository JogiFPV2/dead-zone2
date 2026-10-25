import {
  CHUNK_SIZE,
  CHUNK_TILES,
  tileIndex,
  type ChunkData,
  type ChunkSource,
  type EdgeDef,
  type RoomInfo,
} from '../world/chunk.js';

/**
 * Test fixture: building 7 on floors 0 and 1, x 28..35 (crossing the chunk border at x 32),
 * y 2..7. Floor 0: room A (kitchen, x 28..31) and room B (living room, x 32..35, the same
 * room in two chunk pieces is not needed: B is wholly in chunk 1); a hall at x 28..35, y 6..7
 * split by the border (two pieces, one room). Floor 1: one bedroom over the whole footprint.
 * Outer walls with one window and one door; stairs N from (30, 5) len 3 on floor 0.
 */
export function testBuildingSource(): ChunkSource {
  const edgePalette: (EdgeDef | null)[] = [
    null,
    { id: 'base:wall', kind: 'wall' },
    { id: 'base:window', kind: 'window' },
    { id: 'base:door', kind: 'door' },
  ];
  const chunks = new Map<string, ChunkData>();
  const make = (cx: number, cy: number, z: number) => {
    const c = {
      coord: { cx, cy, z },
      floor: new Uint16Array(CHUNK_TILES),
      edgeN: new Uint16Array(CHUNK_TILES),
      edgeW: new Uint16Array(CHUNK_TILES),
      room: new Uint16Array(CHUNK_TILES),
      rooms: new Map<number, RoomInfo>(),
      stairs: [] as { tx: number; ty: number; dir: 'N' | 'E' | 'S' | 'W'; len: number }[],
    };
    chunks.set(`${cx},${cy},${z}`, c);
    return c;
  };
  type C = ReturnType<typeof make>;
  const get = (x: number, z: number): C =>
    (chunks.get(`${Math.floor(x / CHUNK_SIZE)},0,${z}`) as C | undefined) ??
    make(Math.floor(x / CHUNK_SIZE), 0, z);
  const setRoom = (x: number, y: number, z: number, room: number, type: string) => {
    const c = get(x, z);
    c.room[tileIndex(x - c.coord.cx * CHUNK_SIZE, y)] = room;
    c.rooms.set(room, { type: type as RoomInfo['type'], buildingId: 7 });
  };
  const edge = (x: number, y: number, z: number, side: 'N' | 'W', id: number) => {
    const c = get(x, z);
    (side === 'N' ? c.edgeN : c.edgeW)[tileIndex(x - c.coord.cx * CHUNK_SIZE, y)] = id;
  };
  for (const z of [0, 1]) {
    get(0, z);
    get(CHUNK_SIZE, z);
    for (let y = 2; y < 8; y++) {
      for (let x = 28; x < 36; x++) {
        let room: number;
        let type: string;
        if (z === 1) {
          room = x < 32 ? 50 : 51;
          type = 'base:room-bedroom';
        } else if (y >= 6) {
          room = x < 32 ? 10 : 11;
          type = 'base:room-hall';
        } else if (x < 32) {
          room = 12;
          type = 'base:room-kitchen';
        } else {
          room = 13;
          type = 'base:room-living-room';
        }
        setRoom(x, y, z, room, type);
      }
    }
    for (let x = 28; x < 36; x++) {
      edge(x, 2, z, 'N', x === 30 ? 2 : 1);
      edge(x, 8, z, 'N', x === 33 && z === 0 ? 3 : 1);
    }
    for (let y = 2; y < 8; y++) {
      edge(28, y, z, 'W', 1);
      edge(36, y, z, 'W', 1);
    }
  }
  // Inner wall between kitchen and living room (floor 0, crosses the chunk border line x 32).
  for (let y = 2; y < 6; y++) edge(32, y, 0, 'W', 1);
  get(30, 0).stairs.push({ tx: 30, ty: 5, dir: 'N', len: 3 });
  return {
    tilePalette: [null],
    edgePalette,
    getChunk: (cx, cy, z) => chunks.get(`${cx},${cy},${z}`),
  };
}
