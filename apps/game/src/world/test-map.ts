import {
  CHUNK_SIZE,
  CHUNK_TILES,
  tileIndex,
  type ChunkData,
  type ChunkRange,
  type ChunkSource,
} from './chunk.js';
import { TEST_EDGE_PALETTE, TEST_ROOMS, paintTestBuilding } from './test-building.js';

export const TEST_MAP_PALETTE = [
  null,
  'base:grass',
  'base:asphalt',
  'base:concrete',
  'base:roof-flat',
  'base:sidewalk',
] as const;
const GRASS = 1;
const ASPHALT = 2;
const CONCRETE = 3;
const ROOF_FLAT = 4;
const SIDEWALK = 5;

/** 4x4 chunks (128x128 tiles) centred on the origin. */
export const TEST_MAP_RANGE: ChunkRange = { cx0: -2, cy0: -2, cx1: 1, cy1: 1, z: 0 };

/** Last tile of the test map (sidewalks only run along roads inside the map). */
const MAP_MAX = (TEST_MAP_RANGE.cx1 + 1) * CHUNK_SIZE - 1;

/**
 * Deterministic placeholder map: grass, a road grid every 32 tiles with 2-tile sidewalks and
 * concrete lots.
 */
function tileAt(wx: number, wy: number): number {
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  if (lx < 4 || ly < 4) return ASPHALT;
  const walkX = lx < 6 || (lx >= 30 && wx < MAP_MAX - 1);
  const walkY = ly < 6 || (ly >= 30 && wy < MAP_MAX - 1);
  if (walkX || walkY) return SIDEWALK;
  if (lx >= 10 && lx < 22 && ly >= 10 && ly < 22) return CONCRETE;
  return GRASS;
}

/** World-space floor rectangle covered by a chunk range (1 tile = 1 unit). */
export function rangeBounds(range: ChunkRange): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  return {
    minX: range.cx0 * CHUNK_SIZE,
    minY: range.cy0 * CHUNK_SIZE,
    maxX: (range.cx1 + 1) * CHUNK_SIZE,
    maxY: (range.cy1 + 1) * CHUNK_SIZE,
  };
}

/**
 * Vehicle test props (vehicle UI without `?car=` / `?pump=`): two fuel pumps on the concrete lot
 * north of the start (chunk (0, −1)) with a car parked at each side within hose reach, and two
 * cars on the roads by the start. World tiles; the sim spawns the cars from chunk data.
 */
export const TEST_MAP_PUMPS: readonly { x: number; y: number }[] = [
  { x: 14, y: -16 },
  { x: 18, y: -16 },
];
export const TEST_MAP_CARS: readonly { x: number; y: number; heading: number }[] = [
  { x: 16, y: -13.5, heading: 0 },
  { x: 16, y: -19.5, heading: Math.PI },
  { x: 8, y: 2, heading: 0 },
  { x: -16, y: 2, heading: Math.PI },
];

const inChunk = (cx: number, cy: number) => (p: { x: number; y: number }) =>
  Math.floor(p.x / CHUNK_SIZE) === cx && Math.floor(p.y / CHUNK_SIZE) === cy;

/** Pumps (map objects) and parked cars of chunk (cx, cy), in local tiles. */
function vehicleProps(cx: number, cy: number): Pick<ChunkData, 'objects' | 'vehicles'> {
  const ox = cx * CHUNK_SIZE;
  const oy = cy * CHUNK_SIZE;
  const pumps = TEST_MAP_PUMPS.filter(inChunk(cx, cy));
  const cars = TEST_MAP_CARS.filter(inChunk(cx, cy));
  return {
    ...(pumps.length
      ? {
          objects: pumps.map((p) => ({
            contentId: 'base:fuel-pump' as const,
            x: p.x - ox,
            y: p.y - oy,
            rot: 0,
          })),
        }
      : {}),
    ...(cars.length
      ? {
          vehicles: cars.map((c) => ({
            x: c.x - ox,
            y: c.y - oy,
            heading: c.heading,
            type: 'base:sedan',
          })),
        }
      : {}),
  };
}

export function createTestMap(range: ChunkRange = TEST_MAP_RANGE): ChunkSource {
  const inRange = (cx: number, cy: number, z: number) =>
    z === range.z && cx >= range.cx0 && cx <= range.cx1 && cy >= range.cy0 && cy <= range.cy1;

  return {
    tilePalette: TEST_MAP_PALETTE,
    edgePalette: TEST_EDGE_PALETTE,
    getChunk(cx, cy, z): ChunkData | undefined {
      if (!inRange(cx, cy, z)) return undefined;
      const floor = new Uint16Array(CHUNK_TILES);
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          floor[tileIndex(x, y)] = tileAt(cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y);
        }
      }
      const coord = { cx, cy, z };
      // One grey-box building in chunk (0, 0); other chunks keep empty edges (SimMap shape).
      const props = vehicleProps(cx, cy);
      if (cx === 0 && cy === 0) {
        return { coord, floor, ...paintTestBuilding(ROOF_FLAT), rooms: TEST_ROOMS, ...props };
      }
      return {
        coord,
        floor,
        edgeN: new Uint16Array(CHUNK_TILES),
        edgeW: new Uint16Array(CHUNK_TILES),
        ...props,
      };
    },
  };
}
