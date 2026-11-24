import { describe, expect, it } from 'vitest';
import { CELL_CLASS, ROOM_KIND, buildBldLut, cellClass, roomKind } from './painted-buildings.js';
import { roomCode } from '../world/town/painted-rooms.js';

describe('painted buildings', () => {
  it('classifies palette cells (outside walls, roofs, interior, floors, the rest flat)', () => {
    expect(cellClass('wall-brick')).toBe(CELL_CLASS.cegla);
    expect(cellClass('wall-siding-green')).toBe(CELL_CLASS.siding);
    expect(cellClass('wall-plaster')).toBe(CELL_CLASS.tynk);
    expect(cellClass('wall-interior')).toBe(CELL_CLASS.interior);
    expect(cellClass('roof-a')).toBe(CELL_CLASS.dachowka);
    expect(cellClass('roof-gravel')).toBe(CELL_CLASS.papa);
    expect(cellClass('wood-floor')).toBe(CELL_CLASS.floor);
    expect(cellClass('glass')).toBe(CELL_CLASS.none);
    expect(cellClass('door-wood')).toBe(CELL_CLASS.door);
    expect(cellClass('door-panel')).toBe(CELL_CLASS.door);
    expect(cellClass('v2w3-wall', 'brick')).toBe(CELL_CLASS.cegla);
    expect(cellClass('v2r1', 'tiles-plain')).toBe(CELL_CLASS.dachowka);
    expect(cellClass('v2r1', 'felt')).toBe(CELL_CLASS.papa);
  });

  it('fills whole cells and bld v2 quarter cells of the 32 × 32 lookup', () => {
    const lut = buildBldLut(
      { 'wall-brick': { uv: [0.21875, 0.03125] }, 'v2w0-wall': { uv: [0.015625, 0.984375] } },
      new Map([['v2w0-wall', 'plaster']]),
    );
    for (const [c, r] of [
      [6, 0],
      [7, 0],
      [6, 1],
      [7, 1],
    ])
      expect(lut[r! * 32 + c!]).toBe(CELL_CLASS.cegla);
    expect(lut[31 * 32 + 0]).toBe(CELL_CLASS.tynk);
    expect(lut[31 * 32 + 1]).toBe(0);
  });

  it('codes rooms by kind with a stable per-room variant', () => {
    expect(roomKind('base:room-kitchen')).toBe(ROOM_KIND.kitchen);
    expect(roomKind('base:room-office')).toBe(ROOM_KIND.public);
    expect(roomKind(undefined)).toBe(ROOM_KIND.hall);
    const a = roomCode('base:room-bedroom', 12, 3);
    expect(a >> 4).toBe(ROOM_KIND.bedroom);
    expect(roomCode('base:room-bedroom', 12, 3)).toBe(a);
    const variants = new Set(
      Array.from({ length: 40 }, (_, i) => roomCode('base:room-bedroom', 7, i) & 15),
    );
    expect(variants.size).toBeGreaterThan(6);
  });
});
