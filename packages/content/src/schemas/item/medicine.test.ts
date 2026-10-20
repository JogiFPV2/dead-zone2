import { describe, expect, it } from 'vitest';
import { ItemSchema } from './item.js';
import {
  DEFAULT_FOOD_SPOILED_POISON_LOAD,
  DEFAULT_FOOD_SPOILED_SICKNESS_CHANCE,
} from './food-spoiled.js';
import { DEFAULT_MEDICINE_DURATION_MIN, DEFAULT_MEDICINE_REDUCE_SICKNESS } from './medicine.js';
import pharmacy from '../../../data/base/items/medical-pharmacy.json' with { type: 'json' };

const pill = {
  id: 'base:test-pill',
  name: 'item.base.test-pill.name',
  weightKg: 0.05,
  tags: [],
  kind: 'medical',
  medical: { effects: ['reduce_sickness'], durationMin: 60 },
};
const food = {
  id: 'base:test-food',
  name: 'item.base.test-food.name',
  weightKg: 0.3,
  tags: [],
  kind: 'food',
  food: { nutrition: { calories: 100 } },
};

describe('medicine + food.spoiled*', () => {
  it('stałe domyślne', () => {
    expect(DEFAULT_MEDICINE_REDUCE_SICKNESS).toBe(30);
    expect(DEFAULT_MEDICINE_DURATION_MIN).toBe(60);
    expect(DEFAULT_FOOD_SPOILED_SICKNESS_CHANCE).toBe(0.25);
    expect(DEFAULT_FOOD_SPOILED_POISON_LOAD).toBe(15);
  });

  it('medicine opcjonalne i bez wstawiania domyślnych', () => {
    const r = ItemSchema.parse(pill);
    expect(r.medicine).toBeUndefined();
    const m = ItemSchema.parse({ ...pill, medicine: { reduceSickness: 30, durationMin: 60 } });
    expect(m.medicine).toEqual({ reduceSickness: 30, durationMin: 60 });
  });

  it('medicine waliduje zakresy i strict', () => {
    const bad = [
      { reduceSickness: 101, durationMin: 60 },
      { reduceSickness: -1, durationMin: 60 },
      { reduceSickness: 30, durationMin: 0 },
      { reduceSickness: 30, durationMin: 60, extra: 1 },
    ];
    for (const medicine of bad)
      expect(ItemSchema.safeParse({ ...pill, medicine }).success).toBe(false);
  });

  it('food.spoiled* opcjonalne i z zakresami', () => {
    const r = ItemSchema.parse(food);
    expect(r.kind === 'food' && r.food.spoiledSicknessChance).toBeUndefined();
    const ok = { ...food, food: { ...food.food, spoiledSicknessChance: 1, spoiledPoisonLoad: 0 } };
    expect(ItemSchema.safeParse(ok).success).toBe(true);
    for (const f of [{ spoiledSicknessChance: 1.1 }, { spoiledPoisonLoad: -1 }]) {
      expect(ItemSchema.safeParse({ ...food, food: { ...food.food, ...f } }).success).toBe(false);
    }
  });

  it('antybiotyki i witaminy mają medicine', () => {
    const ids = pharmacy.filter((i) => 'medicine' in i).map((i) => i.id);
    expect(ids).toEqual(['base:antibiotics', 'base:vitamins']);
  });
});
