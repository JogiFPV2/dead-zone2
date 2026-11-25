import { describe, expect, it } from 'vitest';
import { CHUNK_TILES, type ChunkData } from './chunk.js';
import { MapObjects } from './map-objects.js';

/** Chunk on level z: tile (1, 1) in room 7 of building 3, (5, 5) outside; a dresser on both. */
const chunk = (z: number): ChunkData => {
  const room = new Uint16Array(CHUNK_TILES);
  room[1 * 32 + 1] = 7;
  return {
    coord: { cx: 0, cy: 0, z },
    floor: new Uint16Array(CHUNK_TILES).fill(1),
    room,
    rooms: new Map([[7, { type: 'base:room-bedroom', buildingId: 3 }]]),
    objects: [
      { contentId: 'base:dresser', x: 1, y: 1, rot: 0 },
      { contentId: 'base:dresser', x: 5, y: 5, rot: 0 },
    ],
  };
};

describe('MapObjects: cutaway', () => {
  it('hides furniture above the player floor only in the player building', () => {
    const m = new MapObjects();
    for (const z of [0, 1, 2]) m.loadChunk(chunk(z));
    const shown = () =>
      m.root.children.filter((c) => c.visible).map((c) => Math.round(c.position.y));
    const all = shown().length;
    m.setCutaway({ building: 3, tx: 1, ty: 1, side: { sx: 1, sz: 1 }, z: 0 });
    // Inside building 3 on the ground floor: its z 1 and z 2 dressers go, the outside ones stay.
    expect(shown().length).toBe(all - 2);
    m.setCutaway({ building: 3, tx: 1, ty: 1, side: { sx: 1, sz: 1 }, z: 1 });
    expect(shown().length).toBe(all - 1);
    m.setCutaway({ building: 9, tx: 1, ty: 1, side: { sx: 1, sz: 1 }, z: 0 });
    expect(shown().length).toBe(all);
    // Chunks streamed in later get the current cutaway too.
    m.setCutaway({ building: 3, tx: 1, ty: 1, side: { sx: 1, sz: 1 }, z: 0 });
    m.loadChunk(chunk(3));
    expect(shown().length).toBe(all - 2 + 1);
  });
});

describe('MapObjects: F highlight (Paweł 25.11)', () => {
  it('lights the piece at the target tile, moves with the target, goes with none', () => {
    const m = new MapObjects();
    m.loadChunk(chunk(0));
    const lit = () => m.root.children.filter((c) => c.name === 'furniture-highlight');
    m.setHighlight({ x: 1, y: 1, z: 0 }, 0);
    expect(m.highlightedAt).toEqual({ tx: 1, ty: 1, z: 0 });
    expect(lit()).toHaveLength(1);
    m.setHighlight({ x: 1, y: 1, z: 0 }, 16);
    expect(lit()).toHaveLength(1);
    m.setHighlight({ x: 5, y: 5, z: 0 }, 32);
    expect(m.highlightedAt).toEqual({ tx: 5, ty: 5, z: 0 });
    expect(lit()).toHaveLength(1);
    m.setHighlight({ x: 9, y: 9, z: 0 }, 48);
    expect(m.highlightedAt).toBeUndefined();
    expect(lit()).toHaveLength(0);
    m.setHighlight({ x: 1, y: 1, z: 0 }, 64);
    m.setHighlight(undefined, 80);
    expect(lit()).toHaveLength(0);
  });

  it('nothing lit when the piece is hidden by the cutaway', () => {
    const m = new MapObjects();
    m.loadChunk(chunk(1));
    m.setCutaway({ building: 3, tx: 1, ty: 1, side: { sx: 1, sz: 1 }, z: 0 });
    m.setHighlight({ x: 1, y: 1, z: 1 }, 0);
    expect(m.highlightedAt).toBeUndefined();
  });
});
