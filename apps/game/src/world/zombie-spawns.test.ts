import { CHUNK_SIZE, CHUNK_TILES } from '@deadzone/protocol';
import { expect, it } from 'vitest';
import { pickZombieSpawns } from './zombie-spawns.js';

it('picks free outdoor tiles away from the start', () => {
  const chunk = (cx: number, cy: number) => ({
    cx,
    cy,
    z: 0,
    floor: new Uint16Array(CHUNK_TILES).fill(1),
    edgeN: new Uint16Array(CHUNK_TILES),
    edgeW: new Uint16Array(CHUNK_TILES),
  });
  const map = { chunks: [chunk(0, 0), chunk(1, 0), chunk(0, 1), chunk(1, 1)] };
  const out = pickZombieSpawns(map, { x: 1, y: 1 }, 10);
  expect(out).toHaveLength(10);
  for (const p of out) {
    expect(Math.hypot(p.x - 1, p.y - 1)).toBeGreaterThanOrEqual(18);
    expect(p.x).toBeLessThan(2 * CHUNK_SIZE - 1);
  }
  expect(pickZombieSpawns(map, { x: 1, y: 1 }, 10)).toEqual(out);
});
