import { describe, expect, it } from 'vitest';
import { CHUNK_TILES, NO_BUILDING, tileIndex, type ChunkData } from './chunk.js';
import { BuildingLookup, buildingInChunk, tileOf } from './building-lookup.js';

const chunk = (cx: number, cy: number, cells: [number, number, number][]): ChunkData => {
  const room = new Uint16Array(CHUNK_TILES);
  for (const [x, y, id] of cells) room[tileIndex(x, y)] = id;
  const rooms = new Map([
    [1, { type: 'base:room-kitchen' as const, buildingId: 7 }],
    [2, { type: 'base:room-bedroom' as const, buildingId: 8 }],
  ]);
  return { coord: { cx, cy, z: 0 }, floor: new Uint16Array(CHUNK_TILES), room, rooms };
};

describe('tileOf', () => {
  it('floors positions, also negative', () => {
    expect(tileOf(3.9, 0.1)).toEqual({ tx: 3, ty: 0 });
    expect(tileOf(-0.2, -32.5)).toEqual({ tx: -1, ty: -33 });
  });
});

describe('buildingInChunk', () => {
  it('maps tile -> room -> building, 0 outside', () => {
    const c = chunk(1, 0, [[2, 3, 1]]);
    expect(buildingInChunk(c, 34, 3)).toBe(7);
    expect(buildingInChunk(c, 35, 3)).toBe(NO_BUILDING);
    expect(buildingInChunk(c, 2, 3)).toBe(NO_BUILDING);
  });

  it('handles chunks without room layers', () => {
    const plain: ChunkData = { coord: { cx: 0, cy: 0, z: 0 }, floor: new Uint16Array(CHUNK_TILES) };
    expect(buildingInChunk(plain, 0, 0)).toBe(NO_BUILDING);
    expect(buildingInChunk(undefined, 0, 0)).toBe(NO_BUILDING);
  });
});

describe('BuildingLookup', () => {
  const chunks = [chunk(0, 0, [[0, 0, 1]]), chunk(-1, -1, [[31, 31, 2]])];
  let fetches = 0;
  const lookup = new BuildingLookup({
    getChunk: (cx, cy) => {
      fetches++;
      return chunks.find((c) => c.coord.cx === cx && c.coord.cy === cy);
    },
  });

  it('looks up across chunks and caches', () => {
    expect(lookup.at(0, 0, 0)).toBe(7);
    expect(lookup.at(-1, -1, 0)).toBe(8);
    expect(lookup.at(5, 5, 0)).toBe(NO_BUILDING);
    expect(lookup.at(40, 0, 0)).toBe(NO_BUILDING);
    const before = fetches;
    lookup.at(1, 1, 0);
    expect(fetches).toBe(before);
  });

  it('assigns an edge to its own tile or the neighbour across it', () => {
    expect(lookup.edge('N', 0, 1, 0)).toBe(7);
    expect(lookup.edge('W', 1, 0, 0)).toBe(7);
    expect(lookup.edge('N', 0, 0, 0)).toBe(7);
    expect(lookup.edge('W', 0, -1, 0)).toBe(8);
    expect(lookup.edge('N', 5, 5, 0)).toBe(NO_BUILDING);
  });
});
