import {
  CHUNK_SIZE,
  CHUNK_TILES,
  tileIndex,
  type ChunkData,
  type ChunkRange,
  type ChunkSource,
} from './chunk.js';

export const TEST_MAP_PALETTE = [null, 'base:grass', 'base:asphalt', 'base:concrete'] as const;
const GRASS = 1;
const ASPHALT = 2;
const CONCRETE = 3;

/** 4x4 chunks (128x128 tiles) centred on the origin. */
export const TEST_MAP_RANGE: ChunkRange = { cx0: -2, cy0: -2, cx1: 1, cy1: 1, z: 0 };

/** Deterministic placeholder map: grass, a road grid every 32 tiles and concrete lots. */
function tileAt(wx: number, wy: number): number {
  const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  if (lx < 4 || ly < 4) return ASPHALT;
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

export function createTestMap(range: ChunkRange = TEST_MAP_RANGE): ChunkSource {
  const inRange = (cx: number, cy: number, z: number) =>
    z === range.z && cx >= range.cx0 && cx <= range.cx1 && cy >= range.cy0 && cy <= range.cy1;

  return {
    tilePalette: TEST_MAP_PALETTE,
    getChunk(cx, cy, z): ChunkData | undefined {
      if (!inRange(cx, cy, z)) return undefined;
      const floor = new Uint16Array(CHUNK_TILES);
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          floor[tileIndex(x, y)] = tileAt(cx * CHUNK_SIZE + x, cy * CHUNK_SIZE + y);
        }
      }
      // No walls yet: empty edges so this source can also satisfy the sim's SimMap later.
      const edgeN = new Uint16Array(CHUNK_TILES);
      const edgeW = new Uint16Array(CHUNK_TILES);
      return { coord: { cx, cy, z }, floor, edgeN, edgeW };
    },
  };
}
