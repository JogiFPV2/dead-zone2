import { CHUNK_TILES, tileIndex, type EdgeDef, type RoomInfo } from './chunk.js';

/** Edge palette of the test map (grey-box content ids until content defines edge types). */
export const TEST_EDGE_PALETTE: readonly (EdgeDef | null)[] = [
  null,
  { id: 'base:wall-plain', kind: 'wall' },
  { id: 'base:window-plain', kind: 'window' },
  { id: 'base:door-plain', kind: 'door' },
];
const WALL = 1;
const WINDOW = 2;
const DOOR = 3;

export const TEST_BUILDING_ID = 1;
/** Building footprint in chunk (0, 0), inclusive tile bounds (world = local there). */
export const TEST_BUILDING: Readonly<Record<'x0' | 'y0' | 'x1' | 'y1', number>> = {
  x0: 11,
  y0: 11,
  x1: 20,
  y1: 18,
};
/** A tile inside the living room, used by the `?spawn=inside` debug spawn. */
export const TEST_BUILDING_INSIDE = { x: 13.5, y: 15.5 } as const;

export const TEST_ROOMS: ReadonlyMap<number, RoomInfo> = new Map([
  [1, { type: 'base:room-living-room', buildingId: TEST_BUILDING_ID }],
  [2, { type: 'base:room-kitchen', buildingId: TEST_BUILDING_ID }],
  [3, { type: 'base:room-bedroom', buildingId: TEST_BUILDING_ID }],
]);

export interface BuildingLayers {
  edgeN: Uint16Array;
  edgeW: Uint16Array;
  roof: Uint16Array;
  room: Uint16Array;
}

/**
 * One grey-box house: living room (x 11–15) | kitchen (x 16–20, y 11–14) over bedroom
 * (y 15–18). Front door south, interior doors, windows on every outer side, flat roof.
 */
export function paintTestBuilding(roofTile: number): BuildingLayers {
  const edgeN = new Uint16Array(CHUNK_TILES);
  const edgeW = new Uint16Array(CHUNK_TILES);
  const roof = new Uint16Array(CHUNK_TILES);
  const room = new Uint16Array(CHUNK_TILES);
  const { x0, y0, x1, y1 } = TEST_BUILDING;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      room[tileIndex(x, y)] = x <= 15 ? 1 : y <= 14 ? 2 : 3;
      roof[tileIndex(x, y)] = roofTile;
    }
  }
  const n = (x: number, y: number, id: number) => (edgeN[tileIndex(x, y)] = id);
  const w = (x: number, y: number, id: number) => (edgeW[tileIndex(x, y)] = id);

  for (let x = x0; x <= x1; x++) {
    n(x, y0, x === 14 || x === 18 ? WINDOW : WALL); // north outer wall
    n(x, y1 + 1, x === 13 ? DOOR : x === 15 || x === 18 ? WINDOW : WALL); // south outer wall
  }
  for (let y = y0; y <= y1; y++) {
    w(x0, y, y === 16 ? WINDOW : WALL); // west outer wall
    w(x1 + 1, y, y === 12 || y === 16 ? WINDOW : WALL); // east outer wall
    w(16, y, y === 13 || y === 17 ? DOOR : WALL); // living room | kitchen, bedroom
  }
  for (let x = 16; x <= x1; x++) n(x, 15, x === 18 ? DOOR : WALL); // kitchen | bedroom

  return { edgeN, edgeW, roof, room };
}
