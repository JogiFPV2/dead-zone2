import { describe, expect, it } from 'vitest';
import { ContentIdSchema } from '../schemas/common/id.js';
import { ItemSchema } from '../schemas/item/item.js';
import { knife } from './helpers.js';

describe('ContentIdSchema', () => {
  it.each(['base:canned-beans', 'my-mod:axe2', 'a:b'])('przyjmuje %s', (id) => {
    expect(ContentIdSchema.safeParse(id).success).toBe(true);
  });
  it.each([
    'knife',
    'base:Knife',
    'base:canned_beans',
    'base:item/knife',
    'base:-x',
    ':x',
    'base:a--b',
  ])('odrzuca %s', (id) => {
    expect(ContentIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('ItemSchema', () => {
  it('przyjmuje broń białą i uzupełnia domyślne', () => {
    const item = ItemSchema.parse(knife);
    expect(item.kind).toBe('weapon_melee');
    expect(item.maxStack).toBe(1);
    if (item.kind === 'weapon_melee') expect(item.melee.durability.lossChancePerUse).toBe(1);
  });

  it('rozróżnia po kind i wymaga bloku danego rodzaju', () => {
    const res = ItemSchema.safeParse({ ...knife, kind: 'food' });
    expect(res.success).toBe(false);
  });

  it('odrzuca nieznany kind i nieznane pola', () => {
    expect(ItemSchema.safeParse({ ...knife, kind: 'laser' }).success).toBe(false);
    expect(ItemSchema.safeParse({ ...knife, weight: 1 }).success).toBe(false);
  });

  it('przyjmuje plecak z redukcją wagi w % i odrzuca redukcję > 100', () => {
    const bag = {
      id: 'base:bag',
      kind: 'container',
      name: 'item.base.bag.name',
      weightKg: 1,
      bag: { capacityKg: 20, weightReductionPct: 30, slots: ['back'] },
    };
    expect(ItemSchema.safeParse(bag).success).toBe(true);
    expect(
      ItemSchema.safeParse({ ...bag, bag: { ...bag.bag, weightReductionPct: 150 } }).success,
    ).toBe(false);
  });

  it('broń palna z magazynkiem albo wewnętrznym zasilaniem', () => {
    const gun = {
      id: 'base:gun',
      kind: 'weapon_ranged',
      name: 'item.base.gun.name',
      weightKg: 1,
      ranged: {
        category: 'pistol',
        skill: 'base:aiming',
        ammo: 'base:ammo',
        feed: { type: 'magazine', magazine: 'base:mag' },
        damage: { min: 5, max: 10 },
        rangeTiles: 20,
        accuracy: 0.5,
        shotsPerSec: 2,
        reloadSec: 2,
        shotNoise: { radiusTiles: 40 },
        durability: { max: 100 },
      },
    };
    expect(ItemSchema.safeParse(gun).success).toBe(true);
    const bad = { ...gun, ranged: { ...gun.ranged, feed: { type: 'internal' } } };
    expect(ItemSchema.safeParse(bad).success).toBe(false);
  });

  it('psucie: freshMin ≤ rottenMin', () => {
    const food = (spoilage: object) => ({
      id: 'base:x',
      kind: 'food',
      name: 'item.base.x.name',
      weightKg: 0.1,
      food: { nutrition: { hunger: -10 }, spoilage },
    });
    expect(ItemSchema.safeParse(food({ freshMin: 10, rottenMin: 20 })).success).toBe(true);
    expect(ItemSchema.safeParse(food({ freshMin: 30, rottenMin: 20 })).success).toBe(false);
  });
});
