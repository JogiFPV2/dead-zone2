import { CHUNK_TILES } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { tileIndex, type ChunkSource } from './chunk.js';
import { chunkSourceToSimMap, chunkSourceToSimMapData } from './sim-map.js';
import { TEST_BUILDING } from './test-building.js';
import { TEST_MAP_RANGE, createTestMap } from './test-map.js';

describe('ChunkSource → SimMap adapter', () => {
  const source = createTestMap();

  it('keeps floor ids and wall/window edges', () => {
    const map = chunkSourceToSimMap(source);
    const chunk = map.getChunk(0, 0, 0)!;
    const raw = source.getChunk(0, 0, 0)!;
    expect(chunk.floor).toEqual(raw.floor);
    expect(chunk.edgeN).toHaveLength(CHUNK_TILES);
    const { x0, y0 } = TEST_BUILDING;
    expect(chunk.edgeN[tileIndex(x0, y0)]).toBe(raw.edgeN![tileIndex(x0, y0)]);
    expect(chunk.edgeN[tileIndex(x0, y0)]).toBeGreaterThan(0);
    expect(map.getChunk(0, 0, 0)).toBe(chunk);
  });

  it('makes door edges passable', () => {
    const map = chunkSourceToSimMap(source);
    const chunk = map.getChunk(0, 0, 0)!;
    const raw = source.getChunk(0, 0, 0)!;
    const doorId = source.edgePalette!.findIndex((d) => d?.kind === 'door');
    const doors = [...raw.edgeN!.keys()].filter((i) => raw.edgeN![i] === doorId);
    expect(doors.length).toBeGreaterThan(0);
    for (const i of doors) expect(chunk.edgeN[i]).toBe(0);
  });

  it('fills missing edge layers with zeros and returns undefined outside the map', () => {
    const bare: ChunkSource = {
      tilePalette: [null, 'base:grass'],
      getChunk: (cx, cy, z) =>
        cx === 0 && cy === 0 && z === 0
          ? { coord: { cx, cy, z }, floor: new Uint16Array(CHUNK_TILES).fill(1) }
          : undefined,
    };
    const map = chunkSourceToSimMap(bare);
    expect(map.getChunk(0, 0, 0)!.edgeW.every((v) => v === 0)).toBe(true);
    expect(map.getChunk(1, 0, 0)).toBeUndefined();
  });

  it('passes rooms (as room types), objects and stairs, and lists chunks of the range', () => {
    const room = new Uint16Array(CHUNK_TILES);
    room[tileIndex(3, 4)] = 7;
    const src: ChunkSource = {
      tilePalette: [null, 'base:grass'],
      getChunk: (cx, cy, z) =>
        cx === 1 && cy === 0 && z === 0
          ? {
              coord: { cx, cy, z },
              floor: new Uint16Array(CHUNK_TILES).fill(1),
              room,
              rooms: new Map([[7, { type: 'base:room-kitchen', buildingId: 1 }]]),
              objects: [{ contentId: 'base:fridge', x: 3, y: 4, rot: 2 }],
              stairs: [{ tx: 5, ty: 6, dir: 'E', len: 4 }],
            }
          : undefined,
    };
    const map = chunkSourceToSimMap(src, { cx0: 0, cy0: 0, cx1: 1, cy1: 0, z: 0 });
    const c = map.getChunk(1, 0, 0)!;
    expect(c.room).toBe(room);
    expect(c.rooms).toEqual({ '7': 'base:room-kitchen' });
    expect(c.objects).toEqual([{ contentId: 'base:fridge', x: 3, y: 4 }]);
    expect(c.stairs).toEqual([{ tx: 5, ty: 6, dir: 'E', len: 4 }]);
    expect(map.listChunks?.()).toEqual([{ cx: 1, cy: 0, z: 0 }]);
    expect('listChunks' in chunkSourceToSimMap(src)).toBe(false);
    const data = chunkSourceToSimMapData(src, { cx0: 0, cy0: 0, cx1: 1, cy1: 0, z: 0 });
    expect(data.chunks[0]).toMatchObject({ rooms: { '7': 'base:room-kitchen' } });
    expect(data.chunks[0]?.objects).toHaveLength(1);
    expect(data.chunks[0]?.stairs).toEqual([{ tx: 5, ty: 6, dir: 'E', len: 4 }]);
  });

  it('serializes the whole test map for the worker', () => {
    expect(chunkSourceToSimMapData(source, TEST_MAP_RANGE).chunks).toHaveLength(16);
  });
});
