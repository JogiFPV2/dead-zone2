import { describe, expect, it } from 'vitest';
import { LootTableSchema } from '../schemas/loot-table.js';
import {
  MAX_TRAIL_POINTS,
  MIN_TRAIL_SPACING_M,
  PlayerMapSettingsSchema,
} from '../schemas/map-markers-settings.js';
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
      category: 'building',
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

describe('mapa gracza: odstęp śladu', () => {
  it(`trailSpacingM: minimum ${MIN_TRAIL_SPACING_M} m (Serwer odrzuca gęstszy ślad)`, () => {
    const parse = (trailSpacingM: number) => PlayerMapSettingsSchema.safeParse({ trailSpacingM });
    expect(PlayerMapSettingsSchema.parse(undefined).trailSpacingM).toBe(16);
    expect(parse(16).success).toBe(true);
    expect(parse(32).success).toBe(true);
    expect(parse(15.9).success).toBe(false);
    expect(parse(8).success).toBe(false);
    expect(parse(1).success).toBe(false);
    expect(WorldSettingsSchema.safeParse({ playerMap: { trailSpacingM: 16 } }).success).toBe(true);
    expect(WorldSettingsSchema.safeParse({ playerMap: { trailSpacingM: 10 } }).success).toBe(false);
  });
});

describe('mapa gracza: długość śladu', () => {
  it(`trailMaxPoints: najwyżej ${MAX_TRAIL_POINTS} (Serwer odrzuca dłuższy ślad)`, () => {
    const parse = (trailMaxPoints: number) => PlayerMapSettingsSchema.safeParse({ trailMaxPoints });
    expect(PlayerMapSettingsSchema.parse(undefined).trailMaxPoints).toBe(20_000);
    expect(parse(20_000).success).toBe(true);
    expect(parse(100).success).toBe(true);
    expect(parse(20_001).success).toBe(false);
    expect(parse(100_000).success).toBe(false);
    expect(WorldSettingsSchema.safeParse({ playerMap: { trailMaxPoints: 20_001 } }).success).toBe(
      false,
    );
  });
});
