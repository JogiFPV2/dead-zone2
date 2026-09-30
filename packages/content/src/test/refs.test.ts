import { describe, expect, it } from 'vitest';
import { validatePacks } from '../validate/validate-packs.js';
import { miniBase, trait } from './helpers.js';

const codes = (r: ReturnType<typeof validatePacks>) => r.errors.map((e) => e.code);

describe('referencje krzyżowe', () => {
  it('wykrywa brakujące referencje receptury (składnik, narzędzie, umiejętność, wynik)', () => {
    const r = validatePacks([
      miniBase({
        'recipes/r.json': {
          id: 'base:crate',
          name: 'recipe.base.crate.name',
          category: 'building',
          ingredients: [{ item: 'base:plank', count: 4 }, { item: 'base:nails' }],
          tools: [{ tag: 'base:tool-hammer' }],
          skills: [
            { skill: 'base:carpentry', level: 1 },
            { skill: 'base:woodwork', level: 1 },
          ],
          durationMin: 30,
          results: [{ item: 'base:crate' }],
        },
      }),
    ]);
    expect(r.errors.map((e) => [e.code, e.path])).toEqual([
      ['missing_ref', '$.ingredients[1].item'],
      ['missing_ref', '$.skills[1].skill'],
      ['missing_ref', '$.results[0].item'],
      ['missing_tag', '$.tools[0].tag'],
    ]);
    expect(r.errors[0]?.file).toBe('recipes/r.json');
  });

  it('wykrywa brakujące wpisy loot table, odblokowania książek i konflikty cech', () => {
    const r = validatePacks([
      miniBase({
        'loot-tables/t.json': {
          id: 'base:t',
          rolls: { min: 1, max: 1 },
          entries: [{ item: 'base:ghost', weight: 1 }],
        },
        'items/books.json': {
          id: 'base:mag',
          kind: 'literature',
          name: 'item.base.mag.name',
          weightKg: 0.2,
          literature: { format: 'magazine', readMin: 10, unlocksRecipes: ['base:nope'] },
        },
        'traits/t.json': [trait('base:a', { conflicts: ['base:b'] })],
      }),
    ]);
    expect(r.errors.map((e) => `${e.file} ${e.path}`)).toEqual([
      'items/books.json $.literature.unlocksRecipes[0]',
      'traits/t.json $[0].conflicts[0]',
      'loot-tables/t.json $.entries[0].item',
    ]);
  });

  it('wykrywa referencje w warunkach modyfikatorów', () => {
    const r = validatePacks([
      miniBase({
        'traits/t.json': trait('base:a', {
          modifiers: [
            {
              stat: 'aim-accuracy',
              op: 'mul',
              value: 0.8,
              when: { moodle: 'base:panic', minLevel: 2 },
            },
          ],
        }),
      }),
    ]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'missing_ref', path: '$.modifiers[0].when.moodle' }),
    ]);
  });

  it('zawód nie może nadawać wykluczających się cech', () => {
    const r = validatePacks([
      miniBase({
        'traits/t.json': [trait('base:a', { conflicts: ['base:b'] }), trait('base:b')],
        'professions/p.json': {
          id: 'base:p',
          name: 'profession.base.p.name',
          points: 0,
          freeTraits: ['base:b', 'base:a'],
        },
      }),
    ]);
    expect(r.errors).toEqual([
      expect.objectContaining({ code: 'trait_conflict', path: '$.freeTraits[0]' }),
    ]);
  });

  it('wykrywa cykl zagnieżdżonych loot tables', () => {
    const t = (id: string, next: string) => ({
      id,
      rolls: { min: 1, max: 1 },
      entries: [{ table: next, weight: 1 }],
    });
    const r = validatePacks([
      miniBase({ 'loot-tables/c.json': [t('base:a', 'base:b'), t('base:b', 'base:a')] }),
    ]);
    expect(codes(r)).toEqual(['loot_cycle']);
  });
});
