import { describe, expect, it } from 'vitest';
import { LootTableSchema } from '../schemas/loot-table.js';
import { NutritionSchema } from '../schemas/item/nutrition.js';
import { validatePacks } from '../validate/validate-packs.js';
import { material, miniBase } from './helpers.js';

const table = (weight: number, extra: Record<string, unknown> = {}) => ({
  id: 'base:t',
  rolls: { min: 1, max: 1 },
  entries: [{ item: 'base:plank', weight, ...extra }],
});

describe('rozszerzenia schematów dla Etapu 2–3', () => {
  it('loot: waga całkowita (pickWeighted w Symulacji), rzadkość domyślnie common', () => {
    expect(LootTableSchema.parse(table(3)).entries[0]?.rarity).toBe('common');
    expect(LootTableSchema.safeParse(table(1.5)).success).toBe(false);
    expect(LootTableSchema.safeParse(table(2, { rarity: 'legendary' })).success).toBe(false);
    expect(LootTableSchema.parse(table(1, { rarity: 'very_rare' })).entries[0]?.rarity).toBe(
      'very_rare',
    );
  });

  it('jedzenie: makroskładniki w gramach, domyślnie 0', () => {
    expect(NutritionSchema.parse({ calories: 100 })).toMatchObject({ proteinG: 0, fatG: 0 });
    expect(NutritionSchema.safeParse({ carbsG: -1 }).success).toBe(false);
  });

  it('pudełko amunicji musi wskazywać przedmiot rodzaju ammo', () => {
    const box = (ammo: string) => ({
      id: 'base:box',
      kind: 'ammo_box',
      name: 'item.base.box.name',
      weightKg: 0.5,
      ammoBox: { ammo, count: 20 },
    });
    const ammo = {
      id: 'base:round',
      kind: 'ammo',
      name: 'item.base.round.name',
      weightKg: 0.01,
      ammo: { caliber: '9mm' },
    };
    const ok = validatePacks([miniBase({ 'items/a.json': [ammo, box('base:round')] })]);
    expect(ok.errors).toEqual([]);
    const wrong = validatePacks([miniBase({ 'items/a.json': box('base:plank') })]);
    expect(wrong.errors).toEqual([
      expect.objectContaining({ code: 'wrong_kind', path: '$.ammoBox.ammo' }),
    ]);
    const missing = validatePacks([
      miniBase({ 'items/a.json': [material('base:x'), box('base:nope')] }),
    ]);
    expect(missing.errors.map((e) => e.code)).toEqual(['missing_ref']);
  });
});
