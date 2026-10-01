import { expect, it } from 'vitest';
import { CHUNK_TILES, NO_BUILDING } from './chunk.js';
import { BuildingLookup } from './building-lookup.js';
import {
  TEST_BUILDING,
  TEST_BUILDING_ID,
  TEST_BUILDING_INSIDE,
  TEST_EDGE_PALETTE,
} from './test-building.js';
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
      expect(c.edgeN).toHaveLength(CHUNK_TILES);
      expect(c.edgeW).toHaveLength(CHUNK_TILES);
      if (cx !== 0 || cy !== 0) expect(c.edgeN).toEqual(new Uint16Array(CHUNK_TILES));
      for (const id of c.floor) expect(map.tilePalette[id]).toMatch(/^base:[a-z-]+$/);
      for (const id of [...(c.edgeN ?? []), ...(c.edgeW ?? [])]) {
        if (id !== 0) expect(map.edgePalette?.[id]?.id).toMatch(/^base:[a-z-]+$/);
      }
    }
  }
  expect(chunks).toBe(16);
  expect(map.getChunk(0, 0, 1)).toBeUndefined();
});

it('reports the floor bounds of the test map', () => {
  expect(rangeBounds(TEST_MAP_RANGE)).toEqual({ minX: -64, minY: -64, maxX: 64, maxY: 64 });
});

it('has one building with rooms, a roof and all edge kinds in chunk (0, 0)', () => {
  const c = createTestMap().getChunk(0, 0, 0);
  const lookup = new BuildingLookup(createTestMap());
  expect(c?.rooms?.size).toBe(3);
  const { x0, y0, x1, y1 } = TEST_BUILDING;
  expect(lookup.at(x0, y0, 0)).toBe(TEST_BUILDING_ID);
  expect(lookup.at(x1, y1, 0)).toBe(TEST_BUILDING_ID);
  expect(lookup.at(x0 - 1, y0, 0)).toBe(NO_BUILDING);
  expect(lookup.at(Math.floor(TEST_BUILDING_INSIDE.x), Math.floor(TEST_BUILDING_INSIDE.y), 0)).toBe(
    TEST_BUILDING_ID,
  );
  expect(c?.roof?.filter((id) => id !== 0)).toHaveLength((x1 - x0 + 1) * (y1 - y0 + 1));
  const kinds = new Set(
    [...(c?.edgeN ?? []), ...(c?.edgeW ?? [])].map((id) => TEST_EDGE_PALETTE[id]?.kind),
  );
  expect(kinds).toEqual(new Set([undefined, 'wall', 'window', 'door', 'fence']));
});
