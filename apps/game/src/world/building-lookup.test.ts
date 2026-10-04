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

describe('chunk-local room ids (docs/sim-architecture.md 9.24)', () => {
  it('keys on the global building id, never on the room id', () => {
    const roomsOf = (pairs: [number, number][]) =>
      new Map(
        pairs.map(([room, b]) => [room, { type: 'base:room-kitchen' as const, buildingId: b }]),
      );
    const mk = (
      cx: number,
      rooms: ReadonlyMap<number, { type: 'base:room-kitchen'; buildingId: number }>,
    ) => {
      const room = new Uint16Array(CHUNK_TILES).fill(1);
      return {
        coord: { cx, cy: 0, z: 0 },
        floor: new Uint16Array(CHUNK_TILES),
        room,
        rooms,
      } as ChunkData;
    };
    // Room 1 of chunk 0 and room 1 of chunk 1 are different buildings; room 1 of chunk 2 is the
    // same building as chunk 1 (one house over the chunk border, different local ids are fine).
    const chunks = [
      mk(0, roomsOf([[1, 100]])),
      mk(1, roomsOf([[1, 4_000_000_000]])),
      mk(2, roomsOf([[1, 4_000_000_000]])),
    ];
    const lookup = new BuildingLookup({ getChunk: (cx) => chunks[cx] });
    expect(lookup.at(5, 5, 0)).toBe(100);
    expect(lookup.at(40, 5, 0)).toBe(4_000_000_000);
    expect(lookup.at(70, 5, 0)).toBe(lookup.at(40, 5, 0));
    expect(lookup.at(5, 5, 0)).not.toBe(lookup.at(40, 5, 0));
  });
});
