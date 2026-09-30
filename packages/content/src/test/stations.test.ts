import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { material, miniBase } from './helpers.js';

const bench = (id: string, level: number, station = 'base:bench') => ({
  id,
  name: `item.${id.replace(':', '.')}.name`,
  kind: 'placeable',
  weightKg: 10,
  placeable: { station: { id: station, level } },
});
const recipe = (id: string, ingredients: unknown[], result: string, extra = {}) => ({
  id,
  name: `recipe.${id.replace(':', '.')}.name`,
  category: 'building',
  ingredients,
  durationMin: 5,
  results: [{ item: result }],
  ...extra,
});
const station = (levels: unknown[]) => ({
  id: 'base:bench',
  name: 'station.base.bench.name',
  category: 'carpentry',
  levels,
});
const pack = (files: Record<string, unknown>) => ({
  'items/benches.json': [bench('base:bench-1', 1), bench('base:bench-2', 2)],
  'items/x.json': [
    material('base:stick'),
    material('base:nails'),
    material('base:tape', ['base:tape']),
  ],
  'recipes/build.json': [
    recipe('base:build-1', [{ item: 'base:plank' }], 'base:bench-1'),
    recipe('base:build-2', [{ item: 'base:bench-1' }, { item: 'base:plank' }], 'base:bench-2'),
  ],
  'stations/bench.json': station([
    { level: 1, item: 'base:bench-1', recipe: 'base:build-1' },
    { level: 2, item: 'base:bench-2', recipe: 'base:build-2' },
  ]),
  ...files,
});
const run = (files: Record<string, unknown> = {}) =>
  validatePacks([miniBase(pack(files))]).errors.map((e) => [e.code, e.path]);

describe('stacje i łączenie (combine)', () => {
  it('poprawna stacja z poziomami 1–2 i receptura na poziomie 2 przechodzą', () => {
    const r = recipe('base:r', [{ item: 'base:stick' }], 'base:branch', {
      station: { id: 'base:bench', minLevel: 2 },
    });
    expect(run({ 'recipes/r.json': r })).toEqual([]);
  });

  it('combine: najwyżej 4 części (wpisy), narzędzia dozwolone, bez stacji', () => {
    const ok = recipe(
      'base:c',
      [{ item: 'base:stick' }, { item: 'base:nails', count: 5 }, { tag: 'base:tape' }],
      'base:branch',
      { kind: 'combine', tools: [{ tag: 'base:tool-cutting' }] },
    );
    expect(run({ 'recipes/c.json': ok })).toEqual([]);
    const five = Array.from({ length: 5 }, () => ({ item: 'base:stick' }));
    const bad = { ...ok, ingredients: five, station: { id: 'base:bench' } };
    expect(run({ 'recipes/c.json': bad })).toEqual([
      ['combine_too_many_parts', '$.ingredients'],
      ['combine_has_station', '$.station'],
    ]);
  });

  it('receptura: nieistniejąca stacja i brakujący poziom', () => {
    const r = (id: string, minLevel: number) =>
      recipe('base:r', [{ item: 'base:stick' }], 'base:branch', { station: { id, minLevel } });
    expect(run({ 'recipes/r.json': r('base:nope', 1) })).toEqual([['missing_ref', '$.station.id']]);
    expect(run({ 'recipes/r.json': r('base:bench', 3) })).toEqual([
      ['station_level_missing', '$.station.minLevel'],
    ]);
  });

  it('stacja: luka w poziomach, zły przedmiot i brak ścieżki ulepszenia', () => {
    const gap = station([{ level: 2, item: 'base:bench-2', recipe: 'base:build-2' }]);
    expect(run({ 'stations/bench.json': gap })).toEqual([
      ['station_level_gap', '$.levels[0].level'],
    ]);
    const wrong = station([
      { level: 1, item: 'base:bench-2', recipe: 'base:build-1' },
      { level: 2, item: 'base:bench-2', recipe: 'base:build-1' },
    ]);
    expect(run({ 'stations/bench.json': wrong })).toEqual([
      ['station_item_mismatch', '$.levels[0].item'],
      ['station_upgrade_missing', '$.levels[0].recipe'],
      ['station_upgrade_missing', '$.levels[1].recipe'],
    ]);
  });
});
