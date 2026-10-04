import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { chunk, mapPack } from './map-fixtures.js';

const errs = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => [e.code, e.file, e.path]);
const C0 = 'maps/house/chunks/0_0_0.json';

describe('mapy: płoty i schody w paczce', () => {
  it('płot wskazuje tile z category fence; schody przechodzą walidację paczki', () => {
    const ok = validatePacks([
      mapPack({
        [C0]: chunk(undefined, {
          edges: [{ x: 3, y: 3, side: 'n', type: 'fence', contentId: 'base:fence' }],
          stairs: [{ tx: 4, ty: 8, dir: 'N', len: 3 }],
        }),
      }),
    ]);
    expect(errs(ok)).toEqual([]);
    expect(ok.maps[0]?.chunks[0]?.stairs).toEqual([{ tx: 4, ty: 8, dir: 'N', len: 3 }]);
    const bad = validatePacks([
      mapPack({
        [C0]: chunk(undefined, {
          edges: [
            { x: 3, y: 3, side: 'n', type: 'fence', contentId: 'base:wall' },
            { x: 4, y: 3, side: 'n', type: 'wall', contentId: 'base:fence' },
          ],
        }),
      }),
    ]);
    expect(bad.errors.map((e) => [e.code, e.path])).toEqual([
      ['wrong_kind', '$.edges[0].contentId'],
      ['wrong_kind', '$.edges[1].contentId'],
    ]);
  });

  it('brama w ogrodzeniu: krawędź `gate` z tile category gate', () => {
    const ok = validatePacks([
      mapPack({
        [C0]: chunk(undefined, {
          edges: [
            { x: 3, y: 3, side: 'n', type: 'fence', contentId: 'base:fence' },
            { x: 4, y: 3, side: 'n', type: 'gate', contentId: 'base:gate' },
          ],
        }),
      }),
    ]);
    expect(errs(ok)).toEqual([]);
    const bad = validatePacks([
      mapPack({
        [C0]: chunk(undefined, {
          edges: [{ x: 4, y: 3, side: 'n', type: 'gate', contentId: 'base:fence' }],
        }),
      }),
    ]);
    expect(bad.errors.map((e) => [e.code, e.path])).toEqual([
      ['wrong_kind', '$.edges[0].contentId'],
    ]);
  });
});
