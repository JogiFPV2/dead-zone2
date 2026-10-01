import { describe, expect, it } from 'vitest';
import { MapChunkSchema } from '../schemas/map/chunk.js';
import { chunk } from './map-fixtures.js';

const paths = (r: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.error?.issues.map((i) => i.path.join('.'));

describe('MapChunkSchema: stairs', () => {
  it('schody: opcjonalne, pierwszy kafel na podłodze, bez nakładania i z poprawnym dir / len', () => {
    expect(MapChunkSchema.parse(chunk()).stairs).toBeUndefined();
    const ok = MapChunkSchema.parse(
      chunk({ cx: 0, cy: 0, z: 0 }, { stairs: [{ tx: 4, ty: 6, dir: 'E', len: 4 }] }),
    );
    expect(ok.stairs).toEqual([{ tx: 4, ty: 6, dir: 'E', len: 4 }]);
    const bad = MapChunkSchema.safeParse(
      chunk(undefined, {
        stairs: [
          { tx: 4, ty: 6, dir: 'E', len: 4 },
          { tx: 6, ty: 4, dir: 'S', len: 3 },
          { tx: 1, ty: 1, dir: 'X', len: 2 },
          { tx: 1, ty: 2, dir: 'N', len: 17 },
        ],
      }),
    );
    expect(paths(bad)).toEqual(['stairs.2.dir', 'stairs.3.len']);
    const overlap = MapChunkSchema.safeParse(
      chunk(undefined, {
        stairs: [
          { tx: 4, ty: 6, dir: 'E', len: 4 },
          { tx: 6, ty: 4, dir: 'S', len: 3 },
        ],
      }),
    );
    expect(paths(overlap)).toEqual(['stairs.1']);
    expect(overlap.error?.issues[0]?.message).toMatch(/nakładają się na kaflu \(6, 6\)/);
    const noFloor = MapChunkSchema.safeParse(
      chunk(undefined, {
        layers: { floor: { rle: [[0, 1024]] } },
        stairs: [{ tx: 0, ty: 0, dir: 'N', len: 1 }],
      }),
    );
    expect(paths(noFloor)).toContain('stairs.0');
  });
});
