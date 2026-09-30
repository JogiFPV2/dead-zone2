import { describe, expect, it } from 'vitest';
import { ITEM_KINDS, ItemSchema } from '../schemas/item/item.js';

const base = { name: 'item.t.x.name', weightKg: 1 };
const durability = { max: 10 };

const valid: Record<string, unknown> = {
  weapon_melee: {
    melee: {
      category: 'blunt',
      skill: 't:blunt',
      damage: { min: 1, max: 2 },
      rangeTiles: 1,
      attacksPerSec: 1,
      staminaCost: 1,
      durability,
    },
  },
  weapon_ranged: {
    ranged: {
      category: 'pistol',
      skill: 't:aiming',
      ammo: 't:ammo',
      feed: { type: 'internal', capacity: 6 },
      damage: { min: 1, max: 2 },
      rangeTiles: 20,
      accuracy: 0.5,
      shotsPerSec: 1,
      reloadSec: 2,
      shotNoise: { radiusTiles: 40 },
      durability,
    },
  },
  ammo: { ammo: { caliber: '9mm' } },
  magazine: { magazine: { ammo: 't:ammo', capacity: 10 } },
  food: { food: { nutrition: { hunger: -10 }, spoilage: { freshMin: 10, rottenMin: 20 } } },
  drink: { drink: { perUse: { thirst: -10 }, uses: 3 } },
  container: { bag: { capacityKg: 10, weightReductionPct: 40, slots: ['back'] } },
  clothing: { clothing: { slot: 'torso_outer' } },
  medical: { medical: { effects: ['stop_bleeding'], durationMin: 2 } },
  tool: { tool: {} },
  literature: {
    literature: {
      format: 'book',
      readMin: 60,
      skillBook: { skill: 't:carpentry', multiplier: 2, minLevel: 0, maxLevel: 2 },
      unlocksRecipes: ['t:crate'],
    },
  },
  material: {},
  placeable: { placeable: { containerType: 't:crate' } },
  misc: {},
};

const sample = (kind: string, extra: Record<string, unknown> = {}) => ({
  id: `t:${kind.replace('_', '-')}`,
  kind,
  ...base,
  ...(valid[kind] as object),
  ...extra,
});

describe('ItemSchema', () => {
  it('ma poprawną próbkę dla każdego rodzaju', () => {
    expect(Object.keys(valid).sort()).toEqual([...ITEM_KINDS].sort());
  });

  it.each(ITEM_KINDS)('akceptuje %s i uzupełnia domyślne', (kind) => {
    const res = ItemSchema.safeParse(sample(kind));
    expect(res.error?.issues).toBeUndefined();
    expect(res.data?.tags).toEqual([]);
    expect(res.data?.maxStack).toBe(1);
  });

  it('odrzuca nieznany rodzaj i brak weightKg', () => {
    expect(ItemSchema.safeParse(sample('misc', { kind: 'spell' })).success).toBe(false);
    expect(ItemSchema.safeParse({ id: 't:x', kind: 'misc', name: 'item.t.x.name' }).success).toBe(
      false,
    );
  });

  it('odrzuca nieznane pola (strict) i złe id', () => {
    expect(ItemSchema.safeParse(sample('misc', { weight: 2 })).success).toBe(false);
    expect(ItemSchema.safeParse(sample('misc', { id: 'x' })).success).toBe(false);
  });

  it('pilnuje weightReductionPct 0–100', () => {
    const bag = { capacityKg: 10, weightReductionPct: 120, slots: ['back'] };
    expect(ItemSchema.safeParse(sample('container', { bag })).success).toBe(false);
  });

  it('psucie: freshMin ≤ rottenMin', () => {
    const food = { nutrition: {}, spoilage: { freshMin: 50, rottenMin: 10 } };
    const res = ItemSchema.safeParse(sample('food', { food }));
    expect(res.error?.issues[0]?.path).toEqual(['food', 'spoilage', 'rottenMin']);
  });

  it('książka: minLevel ≤ maxLevel', () => {
    const literature = {
      format: 'book',
      readMin: 60,
      skillBook: { skill: 't:carpentry', multiplier: 2, minLevel: 5, maxLevel: 2 },
    };
    expect(ItemSchema.safeParse(sample('literature', { literature })).success).toBe(false);
  });
});
