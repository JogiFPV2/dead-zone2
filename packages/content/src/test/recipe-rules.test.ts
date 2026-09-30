import { describe, expect, it } from 'vitest';
import { RecipeSchema } from '../schemas/recipe/recipe.js';
import { validatePacks } from '../validate/validate-packs.js';
import { material, miniBase, trait } from './helpers.js';

const recipe = (extra: Record<string, unknown> = {}) => ({
  id: 'base:r',
  name: 'recipe.base.r.name',
  category: 'carpentry',
  ingredients: [{ item: 'base:plank' }],
  durationMin: 5,
  results: [{ item: 'base:branch' }],
  ...extra,
});

const run = (files: Record<string, unknown>) =>
  validatePacks([miniBase(files)]).errors.map((e) => [e.code, e.path]);

describe('receptury: naprawa, stacje i nauka', () => {
  it('bez wyników tylko jako naprawa (item albo tag i procent)', () => {
    expect(RecipeSchema.safeParse(recipe({ results: [] })).success).toBe(false);
    const repair = { tag: 'base:wood', restorePct: 30 };
    expect(RecipeSchema.safeParse(recipe({ results: [], repair })).success).toBe(true);
    expect(RecipeSchema.safeParse(recipe({ repair: { ...repair, restorePct: 0 } })).success).toBe(
      false,
    );
    expect(
      RecipeSchema.safeParse(recipe({ repair: { item: 'base:a', tag: 'base:b', restorePct: 5 } }))
        .success,
    ).toBe(false);
  });

  it('cel naprawy i stacja muszą istnieć (referencja albo tag przedmiotu)', () => {
    expect(
      run({
        'recipes/r.json': recipe({
          results: [],
          repair: { item: 'base:nope', restorePct: 20 },
          station: 'base:station-fire',
        }),
      }),
    ).toEqual([
      ['missing_ref', '$.repair.item'],
      ['missing_tag', '$.station'],
    ]);
    const fire = material('base:campfire', ['base:station-fire']);
    expect(
      run({
        'recipes/r.json': recipe({ station: 'base:station-fire' }),
        'items/fire.json': fire,
      }),
    ).toEqual([]);
  });

  it('receptura do nauczenia bez źródła to błąd; zawód, cecha lub książka ją odblokowują', () => {
    const learn = recipe({ requiresLearning: true });
    expect(run({ 'recipes/r.json': learn })).toEqual([
      ['unlearnable_recipe', '$.requiresLearning'],
    ]);
    expect(
      run({
        'recipes/r.json': learn,
        'traits/t.json': trait('base:t', { knownRecipes: ['base:r'] }),
      }),
    ).toEqual([]);
    const profession = {
      id: 'base:p',
      name: 'profession.base.p.name',
      points: 0,
      knownRecipes: ['base:r'],
    };
    expect(run({ 'recipes/r.json': learn, 'professions/p.json': profession })).toEqual([]);
  });
});
