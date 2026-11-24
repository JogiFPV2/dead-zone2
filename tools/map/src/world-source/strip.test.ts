import { describe, expect, it } from 'vitest';
import type { BuildingLevel } from './building.js';
import { clipToRings, joinStrip } from './strip.js';

const WALL = 1;
const DOOR = 2;
const kindOf = (v: number) => (v === WALL ? 'wall' : v === DOOR ? 'door' : undefined);

/**
 * Triangle (0,0)-(8,0)-(0,8): the room tiles are those wholly inside (x + y ≤ 6), the strip is
 * the diagonal x + y = 7. Room 1 west of x = 2, room 2 east of it; walls on every room border.
 */
function building() {
  const w = 8;
  const h = 8;
  const W = w + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x + y <= 6) mask[y * w + x] = 1;
  const levels = new Map<number, BuildingLevel>();
  for (const z of [0, 1]) {
    const L: BuildingLevel = {
      floor: new Uint16Array(W * (h + 1)),
      room: new Uint16Array(W * (h + 1)),
      roof: new Uint16Array(W * (h + 1)),
      edgeN: new Uint16Array(W * (h + 1)),
      edgeW: new Uint16Array(W * (h + 1)),
    };
    const roomAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x] ? 0 : x < 2 ? 1 : 2;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const rm = roomAt(x, y);
        if (!rm) continue;
        L.room[y * W + x] = rm;
        L.floor[y * W + x] = 5;
        if (roomAt(x, y - 1) !== rm) L.edgeN[y * W + x] = WALL;
        if (roomAt(x - 1, y) !== rm) L.edgeW[y * W + x] = WALL;
        if (roomAt(x, y + 1) !== rm) L.edgeN[(y + 1) * W + x] = WALL;
        if (roomAt(x + 1, y) !== rm) L.edgeW[y * W + x + 1] = WALL;
      }
    // Exterior door between (3, 3) and the strip tile (3, 4).
    L.edgeN[4 * W + 3] = DOOR;
    levels.set(z, L);
  }
  const rings = [new Float64Array([0, 0, 8, 0, 0, 8])];
  return { w, h, W, mask, levels, rings };
}

describe('joinStrip (strip along a slanted wall)', () => {
  it('opens the rooms onto their strip, floors it upstairs and carries partitions to the wall', () => {
    const { w, h, W, mask, levels, rings } = building();
    const segs = joinStrip({
      rings,
      levels,
      fx: 0,
      fy: 0,
      w,
      h,
      mask,
      blocked: () => false,
      kindOf,
    });
    const L0 = levels.get(0)!;
    const L1 = levels.get(1)!;
    // Exterior tile wall between room tile (6, 0) and strip tile (6, 1) is gone on both levels.
    expect(L0.edgeN[1 * W + 6]).toBe(0);
    expect(L1.edgeN[1 * W + 6]).toBe(0);
    // The door stays (the outline's gate reads it).
    expect(L0.edgeN[4 * W + 3]).toBe(DOOR);
    // Upstairs the strip has floor (no room); downstairs the ground stays.
    expect(L1.floor[1 * W + 6]).toBe(5);
    expect(L1.room[1 * W + 6]).toBe(0);
    expect(L0.floor[1 * W + 6]).toBe(0);
    // Strip tile (2, 5) joined room 2, its west neighbour (1, 5) is room 1: a partition piece
    // on x = 2 inside the outline, on both levels.
    const part = segs.filter((s) => s.x0 === 2 && s.x1 === 2);
    expect(part.map((s) => s.z).sort()).toEqual([0, 1]);
    for (const s of segs) {
      for (const [x, y] of [
        [s.x0, s.y0],
        [s.x1, s.y1],
      ] as const)
        expect(x + y).toBeLessThanOrEqual(8 + 1e-9);
    }
  });

  it('leaves tiles of other buildings alone', () => {
    const { w, h, W, mask, levels, rings } = building();
    joinStrip({ rings, levels, fx: 0, fy: 0, w, h, mask, blocked: () => true, kindOf });
    expect(levels.get(0)!.edgeN[1 * W + 6]).toBe(WALL);
    expect(levels.get(1)!.floor[1 * W + 6]).toBe(0);
  });
});

describe('clipToRings', () => {
  it('keeps the inside pieces of a segment', () => {
    const rings = [new Float64Array([0, 0, 8, 0, 0, 8])];
    const out = clipToRings(rings, 6, 1, 6, 4);
    expect(out).toHaveLength(1);
    expect(out[0]![1]).toBeCloseTo(1);
    expect(out[0]![3]).toBeCloseTo(2);
  });
});
