import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { BuildingLookup } from './building-lookup.js';
import { CHUNK_TILES, tileIndex, type ChunkData } from './chunk.js';
import {
  LOWERED_HEIGHT,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WINDOW_HEIGHT,
  collectEdges,
  collectRoofs,
  edgeHeight,
  writeEdgeMatrix,
  writeRoofMatrix,
} from './structure-instances.js';

const layer = (cells: [number, number, number][]) => {
  const a = new Uint16Array(CHUNK_TILES);
  for (const [x, y, id] of cells) a[tileIndex(x, y)] = id;
  return a;
};

const chunk: ChunkData = {
  coord: { cx: 1, cy: 0, z: 0 },
  floor: new Uint16Array(CHUNK_TILES),
  edgeN: layer([
    [0, 1, 1],
    [1, 1, 2],
    [2, 1, 3],
  ]),
  edgeW: layer([[0, 0, 1]]),
  roof: layer([[0, 0, 4]]),
  room: layer([[0, 0, 1]]),
  rooms: new Map([[1, { type: 'base:room-kitchen', buildingId: 9 }]]),
};
const lookup = new BuildingLookup({ getChunk: (cx) => (cx === 1 ? chunk : undefined) });
const kinds = [undefined, 'wall', 'window', 'door'] as const;
const kindOf = (id: number) => kinds[id];

const decompose = (m: Float32Array, o = 0) => {
  const pos = new Vector3();
  const scale = new Vector3();
  new Matrix4().fromArray(m, o).decompose(pos, new Quaternion(), scale);
  return { pos: pos.toArray(), scale: scale.toArray() };
};

describe('collectEdges', () => {
  it('groups by edge id, skips doors, resolves buildings via either side', () => {
    const groups = collectEdges(chunk, kindOf, lookup);
    expect(groups.map((g) => [g.edgeId, g.kind, g.edges.length])).toEqual([
      [1, 'wall', 2],
      [2, 'window', 1],
    ]);
    // N edge of (32, 1) borders room tile (32, 0) to the north; W edge of (32, 0) is its own tile.
    expect(groups[0]?.edges).toEqual([
      { axis: 'N', tx: 32, ty: 1, building: 9 },
      { axis: 'W', tx: 32, ty: 0, building: 9 },
    ]);
    expect(groups[1]?.edges[0]?.building).toBe(0);
  });
});

describe('collectRoofs', () => {
  it('groups roof tiles with their building', () => {
    expect(collectRoofs(chunk, lookup)).toEqual([
      { roofId: 4, tiles: [{ tx: 32, ty: 0, building: 9 }] },
    ]);
    expect(collectRoofs({ ...chunk, roof: undefined as never }, lookup)).toEqual([]);
  });
});

describe('matrices', () => {
  it('stretches N edges along X and W edges along Z', () => {
    const m = new Float32Array(32);
    writeEdgeMatrix(m, 0, { axis: 'N', tx: 3, ty: 4, building: 0 }, 0, 2);
    writeEdgeMatrix(m, 16, { axis: 'W', tx: 3, ty: 4, building: 0 }, 3, 1);
    const len = 1 + WALL_THICKNESS;
    const n = decompose(m, 0);
    const w = decompose(m, 16);
    expect(n.pos).toEqual([3.5, 0, 4]);
    expect(n.scale.map((v) => +v.toFixed(4))).toEqual([len, 2, WALL_THICKNESS]);
    expect(w.pos).toEqual([3, 3, 4.5]);
    expect(w.scale.map((v) => +v.toFixed(4))).toEqual([WALL_THICKNESS, 1, len]);
  });

  it('places roofs on top of walls and collapses hidden ones', () => {
    const m = new Float32Array(16);
    writeRoofMatrix(m, 0, { tx: 1, ty: 2, building: 1 }, 0, false);
    expect(decompose(m).pos.map((v) => +v.toFixed(4))).toEqual([1.5, WALL_HEIGHT, 2.5]);
    writeRoofMatrix(m, 0, { tx: 1, ty: 2, building: 1 }, 0, true);
    expect([m[0], m[5], m[10]]).toEqual([0, 0, 0]);
  });

  it('uses lower segments for windows and a stub when lowered', () => {
    expect(edgeHeight('wall', false)).toBe(WALL_HEIGHT);
    expect(edgeHeight('window', false)).toBe(WINDOW_HEIGHT);
    expect(edgeHeight('wall', true)).toBe(LOWERED_HEIGHT);
    expect(edgeHeight('window', true)).toBe(LOWERED_HEIGHT);
  });
});
