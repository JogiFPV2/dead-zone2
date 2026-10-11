import { describe, expect, it } from 'vitest';
import { lootCategoryOf } from '../loot/loot-category-of.js';
import { OUTDOOR_OK_TAG } from '../validate/maps/check-map-indoor.js';
import { baseBundle } from './base-bundle.js';

describe('kategorie lootu i meble na dworze', () => {
  it('na dworze stoją tylko schowki z base:outdoor-ok, meble domowe go nie mają', async () => {
    const b = await baseBundle();
    for (const id of ['trash-bin', 'dumpster', 'firewood-pile', 'crate', 'wooden-crate'])
      expect(b.containers[`base:${id}`]?.tags, id).toContain(OUTDOOR_OK_TAG);
    expect(b.items['base:bench']?.tags).toContain(OUTDOOR_OK_TAG);
    const indoor = Object.values(b.containers).filter((c) =>
      ['fridge', 'freezer', 'cabinet', 'counter', 'shelf'].includes(c.category),
    );
    expect(indoor.filter((c) => c.tags.includes(OUTDOOR_OK_TAG)).map((c) => c.id)).toEqual([]);
  });

  it('lootCategoryOf: reguły z rodzaju i tagów, jawne lootCategory wygrywa', async () => {
    const b = await baseBundle();
    const cat = (id: string) => lootCategoryOf(b.items[`base:${id}`]!);
    expect(cat('canned-beans')).toBe('food-canned');
    expect(cat('jarred-vegetables')).toBe('food-canned');
    expect(cat('carrot')).toBe('food-fresh');
    expect(cat('water-bottle')).toBe('drink');
    expect(cat('frying-pan')).toBe('cookware');
    expect(cat('kitchen-knife')).toBe('weapon');
    expect(cat('hammer')).toBe('tool');
    expect(cat('baseball-bat')).toBe('sport');
    expect(cat('matches')).toBe('household');
    expect(cat('flashlight')).toBe('electronics');
    expect(cat('radio')).toBe('electronics');
    expect(cat('pistol')).toBe('firearm');
    expect(cat('ammo-box-9mm')).toBe('ammo');
    expect(cat('vhs-cooking-basics')).toBe('vhs');
    expect(cat('broken-bottle')).toBe('junk');
    expect(cat('gas-can')).toBe('vehicle');
  });
});
