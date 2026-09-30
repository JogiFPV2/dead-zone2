import { describe, expect, it } from 'vitest';
import { MapManifestSchema } from '../schemas/map/manifest.js';
import { validatePacks } from '../validate/validate-packs.js';
import { floorBounds } from '../validate/maps/map-bounds.js';
import { chunk, manifest, mapPack } from './map-fixtures.js';

const M = 'maps/house/manifest.json';
const C1 = 'maps/house/chunks/1_0_0.json';
const zone = (extra: Record<string, unknown> = {}) => ({
  id: 'villa',
  role: 'villa',
  z: 0,
  rects: [{ x: 2, y: 3, w: 4, h: 2 }],
  ...extra,
});
/** Mapa 2×1 chunków: x 0..63, y 0..31 na z=0. */
const chunks = [
  { cx: 0, cy: 0, z: 0 },
  { cx: 1, cy: 0, z: 0 },
];
const withZones = (zones: unknown[]) => ({ ...manifest(chunks), zones });
const run = (zones: unknown[]) => {
  const files = { [M]: withZones(zones), [C1]: chunk(chunks[1]) };
  return validatePacks([mapPack(files)]).errors.map((e) => [e.code, e.path]);
};

describe('strefy mapy w manifeście', () => {
  it('schemat: id i rola w kebab-case, w/h ≥ 1, liczby całkowite, tags opcjonalne', () => {
    expect(MapManifestSchema.parse(withZones([zone({ tags: ['base:safe'] })])).zones).toHaveLength(
      1,
    );
    expect(MapManifestSchema.parse(manifest()).zones).toBeUndefined();
    for (const bad of [
      zone({ id: 'Villa' }),
      zone({ role: 'npc hold' }),
      zone({ rects: [{ x: 0, y: 0, w: 0, h: 1 }] }),
      zone({ rects: [{ x: 0.5, y: 0, w: 1, h: 1 }] }),
      zone({ z: 1.5 }),
    ]) {
      expect(MapManifestSchema.safeParse(withZones([bad])).success).toBe(false);
    }
  });

  it('granice piętra z zasięgu chunków manifestu', () => {
    const m = MapManifestSchema.parse({
      ...manifest([
        { cx: -1, cy: 0, z: 0 },
        { cx: 1, cy: 2, z: 0 },
        { cx: 0, cy: 0, z: 1 },
      ]),
    });
    expect(floorBounds(m, 0)).toEqual({ x0: -32, y0: 0, x1: 64, y1: 96 });
    expect(floorBounds(m, 1)).toEqual({ x0: 0, y0: 0, x1: 32, y1: 32 });
    expect(floorBounds(m, 2)).toBeUndefined();
  });

  it('poprawne strefy przechodzą: kilka ról tego samego typu, punkt 1×1, prostokąt przez 2 chunki', () => {
    const errors = validatePacks([
      mapPack({
        [M]: withZones([
          zone(),
          zone({ id: 'exit-a', role: 'extraction', rects: [{ x: 63, y: 31, w: 1, h: 1 }] }),
          zone({ id: 'exit-b', role: 'extraction', rects: [{ x: 20, y: 0, w: 30, h: 32 }] }),
        ]),
        [C1]: chunk(chunks[1]),
      }),
    ]).errors;
    expect(errors).toEqual([]);
  });

  it('błędy: powtórzone id, pusta strefa, prostokąt poza mapą lub na piętrze bez chunków', () => {
    expect(
      run([
        zone(),
        zone({ rects: [] }),
        zone({ id: 'edge', rects: [{ x: 60, y: 30, w: 5, h: 1 }] }),
        zone({ id: 'neg', rects: [{ x: -1, y: 0, w: 1, h: 1 }] }),
        zone({ id: 'up', z: 1 }),
      ]),
    ).toEqual([
      ['zone_duplicate_id', '$.zones[1].id'],
      ['zone_empty', '$.zones[1].rects'],
      ['zone_out_of_bounds', '$.zones[2].rects[0]'],
      ['zone_out_of_bounds', '$.zones[3].rects[0]'],
      ['zone_out_of_bounds', '$.zones[4].rects[0]'],
    ]);
  });
});
