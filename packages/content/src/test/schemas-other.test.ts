import { describe, expect, it } from 'vitest';
import { LootTableSchema } from '../schemas/loot-table.js';
import { ModManifestSchema } from '../schemas/mod-manifest.js';
import { RecipeSchema } from '../schemas/recipe/recipe.js';
import { SkillSchema } from '../schemas/skill.js';
import { WorldSettingsSchema } from '../schemas/world-settings.js';
import { skill } from './helpers.js';

describe('pozostałe schematy', () => {
  it('umiejętność: dokładnie 10 niemalejących progów XP', () => {
    expect(SkillSchema.safeParse(skill('base:x')).success).toBe(true);
    expect(SkillSchema.safeParse({ ...skill('base:x'), xpPerLevel: [1, 2, 3] }).success).toBe(
      false,
    );
    expect(
      SkillSchema.safeParse({ ...skill('base:x'), xpPerLevel: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0.5] })
        .success,
    ).toBe(false);
    expect(SkillSchema.safeParse({ ...skill('base:x'), group: 'magic' }).success).toBe(false);
  });
  it('receptura wymaga składnika i wyniku; składnik to item albo tag, nie oba', () => {
    const r = {
      id: 'base:r',
      name: 'recipe.base.r.name',
      category: 'carpentry',
      ingredients: [{ item: 'base:plank', count: 2 }],
      durationMin: 10,
      results: [{ item: 'base:crate' }],
    };
    expect(RecipeSchema.safeParse(r).success).toBe(true);
    expect(RecipeSchema.safeParse({ ...r, ingredients: [] }).success).toBe(false);
    expect(
      RecipeSchema.safeParse({ ...r, ingredients: [{ item: 'base:a', tag: 'base:b' }] }).success,
    ).toBe(false);
  });
  it('loot table: min ≤ max', () => {
    const t = { id: 'base:t', rolls: { min: 3, max: 1 }, entries: [{ item: 'base:a', weight: 1 }] };
    expect(LootTableSchema.safeParse(t).success).toBe(false);
  });
  it('manifest: semver i namespace', () => {
    expect(ModManifestSchema.safeParse({ id: 'my-mod', name: 'x', version: '1.2.3' }).success).toBe(
      true,
    );
    expect(ModManifestSchema.safeParse({ id: 'My_Mod', name: 'x', version: '1.2.3' }).success).toBe(
      false,
    );
    expect(ModManifestSchema.safeParse({ id: 'my-mod', name: 'x', version: 'v1' }).success).toBe(
      false,
    );
  });
});

describe('WorldSettingsSchema', () => {
  it('dayLengthMinutes domyślnie 60', () => {
    expect(WorldSettingsSchema.parse({}).dayLengthMinutes).toBe(60);
    expect(WorldSettingsSchema.safeParse({ dayLengthMinutes: 0 }).success).toBe(false);
  });
});
