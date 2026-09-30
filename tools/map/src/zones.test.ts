import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BASE_PACK_DIR, readPackDir } from '@deadzone/content/node';
import { describe, expect, it } from 'vitest';
import { parseBlueprint, type BlueprintInput } from './blueprint.js';
import { buildMap } from './build.js';
import { mapFiles } from './files.js';
import { formatErrors, validateSchemasOnly, validateWithPack } from './validate.js';
import { buildZones, tilesToRects } from './zones.js';

const bp = (over: Partial<BlueprintInput> = {}) =>
  parseBlueprint({
    id: 'zones',
    chunks: { cx0: 0, cy0: 0, cx1: 0, cy1: 0 },
    ground: 'base:grass',
    ...over,
  });

describe('tilesToRects', () => {
  it('merges runs horizontally and identical runs vertically', () => {
    // xx.
    // xx.
    // xxx
    const tiles: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ];
    expect(tilesToRects(tiles)).toEqual([
      { x: 0, y: 0, w: 2, h: 2 },
      { x: 0, y: 2, w: 3, h: 1 },
    ]);
    expect(
      tilesToRects([
        [5, 5],
        [5, 5],
        [5, 7],
      ]),
    ).toEqual([
      { x: 5, y: 5, w: 1, h: 1 },
      { x: 5, y: 7, w: 1, h: 1 },
    ]);
  });
});

describe('buildZones', () => {
  it('combines explicit rects with the ASCII zone plan', () => {
    const zones = buildZones(
      bp({
        zones: [
          { id: 'start', role: 'start', rects: [{ x: 0, y: 0, w: 2, h: 2 }], tags: ['base:demo'] },
          { id: 'house', role: 'villa' },
        ],
        zonePlans: [{ origin: [10, 20], legend: { h: 'house', s: 'start' }, plan: ['hh.', 'hhs'] }],
      }),
    );
    expect(zones).toEqual([
      {
        id: 'start',
        role: 'start',
        z: 0,
        rects: [
          { x: 0, y: 0, w: 2, h: 2 },
          { x: 12, y: 21, w: 1, h: 1 },
        ],
        tags: ['base:demo'],
      },
      { id: 'house', role: 'villa', z: 0, rects: [{ x: 10, y: 20, w: 2, h: 2 }] },
    ]);
  });

  it('rejects unknown legend ids and characters', () => {
    const zones = [{ id: 'a', role: 'start' }];
    expect(() =>
      buildZones(bp({ zones, zonePlans: [{ origin: [0, 0], legend: { b: 'b' }, plan: ['b'] }] })),
    ).toThrow(/nieznaną strefę/);
    expect(() =>
      buildZones(bp({ zones, zonePlans: [{ origin: [0, 0], legend: { a: 'a' }, plan: ['ax'] }] })),
    ).toThrow(/„x”/);
  });

  it('omits `zones` from the manifest when there are none', () => {
    expect('zones' in buildMap(bp()).manifest).toBe(false);
  });

  it('content validation reports zones outside the map and empty zones', async () => {
    const built = buildMap(
      bp({
        zones: [
          { id: 'out', role: 'start', rects: [{ x: 30, y: 0, w: 4, h: 1 }] },
          { id: 'empty', role: 'villa' },
        ],
      }),
    );
    const files = await mapFiles(built);
    expect(validateSchemasOnly(files)).toEqual([]);
    const errors = formatErrors(
      validateWithPack(files, built.id, await readPackDir(BASE_PACK_DIR)),
    ).join('\n');
    expect(errors).toMatch(/zone_out_of_bounds/);
    expect(errors).toMatch(/zone_empty/);
  });
});

describe('blueprint zones', () => {
  it('test-town has the three rescue roles and matches the base pack manifest', async () => {
    const text = await readFile(new URL('../blueprints/test-town.json', import.meta.url), 'utf8');
    const built = buildMap(parseBlueprint(JSON.parse(text)));
    expect(built.manifest.zones?.map((z) => z.role)).toEqual(['start', 'villa', 'extraction']);
    const committed: unknown = JSON.parse(
      await readFile(join(BASE_PACK_DIR, 'maps/test-town/manifest.json'), 'utf8'),
    );
    expect(built.manifest).toEqual(committed);
  });
});
