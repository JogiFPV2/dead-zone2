import { describe, expect, it } from 'vitest';
import { meleeStatsFor } from '../combat/index.js';
import { ImprovisedWeaponSchema, ItemSchema } from '../schemas/index.js';

describe('schemat improvisedWeapon', () => {
  it('schemat: poprawny blok przechodzi z domyślnymi polami, zły odpada', () => {
    const ok = ImprovisedWeaponSchema.parse({
      damage: { min: 2, max: 4 },
      rangeTiles: 0.8,
      attackSpeed: 1,
      durability: 10,
      breakChancePct: 20,
    });
    expect(ok).toMatchObject({ damageType: 'blunt', twoHanded: false });
    const bad = (patch: object) => ImprovisedWeaponSchema.safeParse({ ...ok, ...patch }).success;
    expect(bad({ breakChancePct: 120 })).toBe(false);
    expect(bad({ damage: { min: 5, max: 2 } })).toBe(false);
    expect(bad({ damageType: 'fire' })).toBe(false);
    expect(bad({ durability: 0 })).toBe(false);
    expect(bad({ attacksPerSec: 1 })).toBe(false);
  });

  it('blok działa na każdym rodzaju przedmiotu', () => {
    const item = ItemSchema.parse({
      id: 'test:pot',
      name: 'item.test.pot.name',
      kind: 'misc',
      weightKg: 1,
      improvisedWeapon: {
        damage: { min: 3, max: 6 },
        rangeTiles: 0.7,
        attackSpeed: 1,
        durability: 9,
        breakChancePct: 10,
        damageType: 'sharp',
      },
    });
    expect(meleeStatsFor(item)).toMatchObject({
      source: 'improvised',
      skill: 'base:blade-short',
      damageType: 'sharp',
      staminaCost: 1.8,
    });
  });
});
