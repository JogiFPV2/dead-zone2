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

it('also spawns inside buildings and on upper floors, never on stairs or openings', () => {
  const room = new Uint16Array(CHUNK_TILES);
  // A 10 × 10 building at (4..13, 4..13) on both levels.
  for (let y = 4; y < 14; y++) for (let x = 4; x < 14; x++) room[y * CHUNK_SIZE + x] = 1;
  const ground = {
    cx: 0,
    cy: 0,
    z: 0,
    floor: new Uint16Array(CHUNK_TILES).fill(1),
    edgeN: new Uint16Array(CHUNK_TILES),
    edgeW: new Uint16Array(CHUNK_TILES),
    room,
    rooms: { '1': 'base:room-living-room' },
    stairs: [{ tx: 8, ty: 12, dir: 'N' as const, len: 3 }],
  };
  const upFloor = new Uint16Array(CHUNK_TILES);
  for (let y = 4; y < 14; y++) for (let x = 4; x < 14; x++) upFloor[y * CHUNK_SIZE + x] = 2;
  // Stair opening above the flight.
  for (const y of [10, 11, 12]) upFloor[y * CHUNK_SIZE + 8] = 0;
  const upper = { ...ground, z: 1, floor: upFloor, stairs: undefined };
  const map = { chunks: [ground, upper] };
  const out = pickZombieSpawns(map, { x: 30, y: 30 }, 40, 3);
  expect(out).toHaveLength(40);
  const inside = out.filter((p) => p.x > 4 && p.x < 14 && p.y > 4 && p.y < 14);
  expect(inside.length).toBe(12);
  expect(out.some((p) => p.z === 1)).toBe(true);
  for (const p of out) {
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y);
    if (p.z === 1) expect(upFloor[ty * CHUNK_SIZE + tx]).toBeGreaterThan(0);
    else expect(tx === 8 && ty >= 10 && ty <= 12).toBe(false);
  }
});

it('the safe radius applies on the start level only', () => {
  const chunk = (z: number) => ({
    cx: 0,
    cy: 0,
    z,
    floor: new Uint16Array(CHUNK_TILES).fill(1),
    edgeN: new Uint16Array(CHUNK_TILES),
    edgeW: new Uint16Array(CHUNK_TILES),
    room: new Uint16Array(CHUNK_TILES).fill(1),
    rooms: { '1': 'base:room-bedroom' },
  });
  const out = pickZombieSpawns({ chunks: [chunk(0), chunk(1)] }, { x: 16, y: 16, z: 1 }, 30);
  for (const p of out) {
    if (p.z === 1) expect(Math.hypot(p.x - 16, p.y - 16)).toBeGreaterThanOrEqual(18);
  }
});
