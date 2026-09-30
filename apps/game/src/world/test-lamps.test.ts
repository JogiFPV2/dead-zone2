import { describe, expect, it } from 'vitest';
import { lampHead } from '../lighting/street-lamps.js';
import { selectLamps } from '../lighting/light-budget.js';
import { CHUNK_SIZE } from './chunk.js';
import { createTestLamps } from './test-lamps.js';
import { TEST_BUILDING } from './test-building.js';

/** Road strips of the test map: local tile x or y < 4 in each chunk. */
const onRoad = (v: number) => ((Math.floor(v) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE < 4;

describe('createTestLamps', () => {
  const lamps = createTestLamps();

  it('puts poles beside the roads and heads over them', () => {
    for (const l of lamps.slice(0, -1)) {
      expect(onRoad(l.x) && onRoad(l.z)).toBe(false);
      const h = lampHead(l);
      expect(onRoad(h.x) || onRoad(h.z)).toBe(true);
    }
  });

  it('keeps lamps out of the test building', () => {
    const { x0, y0, x1, y1 } = TEST_BUILDING;
    for (const l of lamps) {
      const inside = l.x >= x0 && l.x <= x1 + 1 && l.z >= y0 && l.z <= y1 + 1;
      expect(inside).toBe(false);
    }
  });

  it('has broken lamps and enough working ones around the spawn to fill the budget', () => {
    expect(lamps.some((l) => !l.working)).toBe(true);
    expect(lamps.filter((l) => l.working).length).toBeGreaterThan(lamps.length / 2);
    expect(selectLamps(lamps, 0.5, 0.5)).toHaveLength(4);
  });

  it('is deterministic', () => {
    expect(createTestLamps()).toEqual(lamps);
  });
});
