import { MapChunkSchema } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { parseBlueprint, type BlueprintInput } from './blueprint.js';
import { buildMap } from './build.js';
import { mapFiles } from './files.js';
import { renderPreview } from './preview.js';
import { validateSchemasOnly } from './validate.js';

const bp = (over: Partial<BlueprintInput> = {}) =>
  parseBlueprint({
    id: 'unit',
    chunks: { cx0: 0, cy0: 0, cx1: 1, cy1: 0 },
    ground: 'base:grass',
    ...over,
  });
const chunk = (m: ReturnType<typeof buildMap>, cx: number) =>
  MapChunkSchema.parse(m.chunks.find((c) => c.json.address.cx === cx)!.json);

describe('narzędzie schodów i pędzel płotu', () => {
  it('płot: poziomy bieg to krawędzie n, pionowy to w, także w sąsiednim chunku', () => {
    const m = buildMap(
      bp({
        fences: [
          { x: 30, y: 2, side: 'n', len: 4, contentId: 'base:wooden-fence' },
          { x: 5, y: 7, side: 'w', len: 2, contentId: 'base:wooden-fence' },
        ],
      }),
    );
    const e0 = chunk(m, 0).edges.map((e) => `${e.x},${e.y},${e.side},${e.type}`);
    const e1 = chunk(m, 1).edges.map((e) => `${e.x},${e.y},${e.side},${e.type}`);
    expect(e0).toEqual(['5,7,w,fence', '5,8,w,fence', '30,2,n,fence', '31,2,n,fence']);
    expect(e1).toEqual(['0,2,n,fence', '1,2,n,fence']);
  });

  it('płot poza mapą to błąd', () => {
    const f = bp({ fences: [{ x: 62, y: 0, side: 'n', len: 4, contentId: 'base:wooden-fence' }] });
    expect(() => buildMap(f)).toThrow(/poza mapą/);
  });

  it('schody trafiają do chunka najniższego kafla jako {tx, ty, dir, len} (lokalnie)', async () => {
    const m = buildMap(
      bp({
        stairs: [
          { at: [10, 20], dir: 'N', len: 4 },
          { at: [30, 5], dir: 'E', len: 5 },
        ],
      }),
    );
    expect(chunk(m, 0).stairs).toEqual([
      { tx: 10, ty: 20, dir: 'N', len: 4 },
      { tx: 30, ty: 5, dir: 'E', len: 5 },
    ]);
    expect(chunk(m, 1).stairs).toBeUndefined();
    expect('stairs' in m.chunks[1]!.json).toBe(false);
    expect(validateSchemasOnly(await mapFiles(m))).toEqual([]);
  });

  it('schody poza mapą albo zachodzące na siebie to błąd', () => {
    expect(() => buildMap(bp({ stairs: [{ at: [62, 1], dir: 'E', len: 4 }] }))).toThrow(
      /schody 0.*poza mapą/,
    );
    expect(() =>
      buildMap(
        bp({
          stairs: [
            { at: [5, 5], dir: 'E', len: 4 },
            { at: [7, 3], dir: 'S', len: 4 },
          ],
        }),
      ),
    ).toThrow(/schody 1 zachodzą na schody 0/);
    expect(() => bp({ stairs: [{ at: [1, 1], dir: 'N', len: 17 }] })).toThrow(/blueprint/);
  });

  it('widok mapy rysuje płot, ścianę z drzwiami i schody', () => {
    const m = buildMap(
      bp({
        buildings: [
          {
            id: 1,
            origin: [2, 2],
            plan: ['AA'],
            rooms: { A: { id: 1, type: 'base:room-kitchen', floor: 'base:kitchen-tiles' } },
            wall: 'base:brick-wall',
            door: 'base:wooden-door',
            openings: [{ at: [0, 0], side: 'n', type: 'door' }],
          },
        ],
        fences: [{ x: 0, y: 5, side: 'n', len: 3, contentId: 'base:wooden-fence' }],
        stairs: [{ at: [5, 4], dir: 'N', len: 3 }],
        objects: [{ contentId: 'base:cabinet', x: 0, y: 0 }],
      }),
    );
    expect(renderPreview(m, 0, { x: 0, y: 0, w: 6, h: 6 })).toBe(
      [
        '',
        ' * . . . . .',
        '',
        ' . . . . . .',
        '     d -',
        ' . .|, ,|. ^',
        '     - -',
        ' . . . . . ^',
        '',
        ' . . . . . S',
        ' ~ ~ ~',
        ' . . . . . .',
        '',
      ].join('\n'),
    );
    expect(renderPreview(m, 1)).toMatch(/brak chunków na piętrze 1/);
  });
});
