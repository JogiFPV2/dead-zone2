import { expect, it } from 'vitest';
import { CHUNK_TILES } from './chunk.js';
import { TEST_MAP_RANGE, createTestMap, rangeBounds } from './test-map.js';

it('serves 4x4 full chunks with palette ids and nothing outside', () => {
  const map = createTestMap();
  let chunks = 0;
  for (let cy = -3; cy <= 2; cy++) {
    for (let cx = -3; cx <= 2; cx++) {
      const c = map.getChunk(cx, cy, 0);
      if (!c) continue;
      chunks++;
      expect(c.floor).toHaveLength(CHUNK_TILES);
      expect(c.edgeN).toEqual(new Uint16Array(CHUNK_TILES));
      expect(c.edgeW).toEqual(new Uint16Array(CHUNK_TILES));
      for (const id of c.floor) expect(map.tilePalette[id]).toMatch(/^base:[a-z-]+$/);
    }
  }
  expect(chunks).toBe(16);
  expect(map.getChunk(0, 0, 1)).toBeUndefined();
});

it('reports the floor bounds of the test map', () => {
  expect(rangeBounds(TEST_MAP_RANGE)).toEqual({ minX: -64, minY: -64, maxX: 64, maxY: 64 });
});
