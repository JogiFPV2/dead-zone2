import { expect, it } from 'vitest';
import { CHUNK_TILES } from './chunk.js';
import { createTestMap } from './test-map.js';

it('serves 4x4 full chunks with palette ids and nothing outside', () => {
  const map = createTestMap();
  let chunks = 0;
  for (let cy = -3; cy <= 2; cy++) {
    for (let cx = -3; cx <= 2; cx++) {
      const c = map.getChunk(cx, cy, 0);
      if (!c) continue;
      chunks++;
      expect(c.floor).toHaveLength(CHUNK_TILES);
      for (const id of c.floor) expect(map.tilePalette[id]).toMatch(/^base:[a-z-]+$/);
    }
  }
  expect(chunks).toBe(16);
  expect(map.getChunk(0, 0, 1)).toBeUndefined();
});
