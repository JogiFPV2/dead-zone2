import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { CHUNK_TILES, tileIndex, type ChunkData } from './chunk.js';
import { LEVEL_HEIGHT, buildTileInstances } from './instances.js';

const chunk = (cx: number, cy: number, z: number, tiles: [number, number, number][]): ChunkData => {
  const floor = new Uint16Array(CHUNK_TILES);
  for (const [x, y, id] of tiles) floor[tileIndex(x, y)] = id;
  return { coord: { cx, cy, z }, floor };
};

const positionOf = (matrices: Float32Array, i: number) =>
  new Vector3().setFromMatrixPosition(new Matrix4().fromArray(matrices, i * 16));

describe('buildTileInstances', () => {
  it('returns nothing for an empty chunk', () => {
    expect(buildTileInstances(chunk(0, 0, 0, []))).toEqual([]);
  });

  it('groups tiles by id, sorted, with correct counts', () => {
    const res = buildTileInstances(
      chunk(0, 0, 0, [
        [0, 0, 2],
        [1, 0, 1],
        [2, 0, 2],
      ]),
    );
    expect(res.map((g) => [g.tileId, g.count])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(res[1]?.matrices).toHaveLength(32);
  });

  it('places tile centres in world space (1 tile = 1 unit)', () => {
    const [g] = buildTileInstances(
      chunk(1, -2, 1, [
        [0, 0, 5],
        [31, 3, 5],
      ]),
    );
    expect(g).toBeDefined();
    if (!g) return;
    expect(positionOf(g.matrices, 0).toArray()).toEqual([32.5, LEVEL_HEIGHT, -63.5]);
    expect(positionOf(g.matrices, 1).toArray()).toEqual([63.5, LEVEL_HEIGHT, -60.5]);
  });

  it('produces pure translation matrices', () => {
    const [g] = buildTileInstances(chunk(0, 0, 0, [[4, 7, 1]]));
    const m = new Matrix4().fromArray(g?.matrices ?? []);
    const scale = new Vector3();
    const rotation = new Quaternion();
    m.decompose(new Vector3(), rotation, scale);
    expect(scale.toArray()).toEqual([1, 1, 1]);
    expect(rotation.toArray()).toEqual([0, 0, 0, 1]);
  });
});
