import { describe, expect, it } from 'vitest';
import { buildContentBundle, ContentValidationError } from '../bundle/build-content-bundle.js';
import { BASE_PACK_DIR, readPackDir, validatePackDirs } from '../node/index.js';
import { formatError } from '../validate/format.js';
import { memPack } from './helpers.js';

describe('paczka bazowa data/base', () => {
  it('waliduje się bez błędów', async () => {
    const r = await validatePackDirs([BASE_PACK_DIR]);
    expect(r.errors.map(formatError)).toEqual([]);
    expect(r.loadOrder.map((m) => m.id)).toEqual(['base']);
  });

  it('zawiera uzgodnioną listę umiejętności w 4 grupach', async () => {
    const bundle = buildContentBundle([await readPackDir(BASE_PACK_DIR)]);
    const byGroup: Record<string, string[]> = {};
    for (const s of Object.values(bundle.skills)) (byGroup[s.group] ??= []).push(s.id.slice(5));
    expect(byGroup).toEqual({
      combat: ['blunt', 'blade-long', 'blade-short', 'spear', 'aiming', 'reloading'],
      survival: ['first-aid', 'cooking', 'farming', 'foraging', 'fishing', 'trapping'],
      crafting: ['carpentry', 'mechanics', 'electrical', 'tailoring', 'metalworking'],
      movement: ['sprinting', 'nimble', 'sneaking', 'lightfoot', 'strength', 'fitness'],
    });
  });

  it('zawiera uzgodnione moodle z polaryzacją', async () => {
    const bundle = buildContentBundle([await readPackDir(BASE_PACK_DIR)]);
    const pol = (p: string) =>
      Object.values(bundle.moodles)
        .filter((m) => m.polarity === p)
        .map((m) => m.id.slice(5))
        .sort();
    expect(pol('negative')).toEqual(
      [
        'hunger',
        'thirst',
        'fatigue',
        'pain',
        'bleeding',
        'injured',
        'sick',
        'infection',
        'panic',
        'stress',
        'boredom',
        'unhappy',
        'cold',
        'hot',
        'wet',
        'heavy-load',
        'drunk',
      ].sort(),
    );
    expect(pol('positive')).toEqual(['comfortable', 'well-fed']);
  });

  it('ContentBundle ma wszystkie mapy, worldSettings i jest zamrożony', async () => {
    const bundle = buildContentBundle([await readPackDir(BASE_PACK_DIR)]);
    for (const key of [
      'items',
      'recipes',
      'skills',
      'traits',
      'professions',
      'moodles',
      'lootTables',
      'zombieTypes',
      'containers',
      'tiles',
      'gameModes',
    ] as const) {
      expect(Object.keys(bundle[key]).length).toBeGreaterThan(0);
    }
    expect(bundle.worldSettings.dayLengthMinutes).toBe(60);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.items['base:kitchen-knife'])).toBe(true);
    expect(Object.isFrozen(bundle.items['base:kitchen-knife']?.tags)).toBe(true);
    expect(() => {
      (bundle.worldSettings as { dayLengthMinutes: number }).dayLengthMinutes = 1;
    }).toThrow(TypeError);
  });

  it('buildContentBundle łączy mod z bazą, a błędny mod rzuca ContentValidationError', async () => {
    const base = await readPackDir(BASE_PACK_DIR);
    const mod = memPack(
      'my-mod',
      {
        'overrides/knife.json': {
          op: 'merge',
          type: 'item',
          target: 'base:kitchen-knife',
          data: { weightKg: 0.25 },
        },
      },
      { dependencies: [{ id: 'base' }] },
    );
    expect(buildContentBundle([base, mod]).items['base:kitchen-knife']?.weightKg).toBe(0.25);
    expect(buildContentBundle([base, mod]).mods.map((m) => m.id)).toEqual(['base', 'my-mod']);

    const broken = memPack('my-mod', {
      'overrides/x.json': { op: 'remove', type: 'item', target: 'base:nope' },
    });
    expect(() => buildContentBundle([base, broken])).toThrow(ContentValidationError);
  });
});
