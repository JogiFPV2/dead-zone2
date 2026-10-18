import { describe, expect, it } from 'vitest';
import { baseBundle } from '../test/base-bundle.js';
import { BUILDING_KINDS, LocksSettingsSchema } from '../schemas/index.js';
import { exteriorLockedChanceFor } from './exterior-locked-chance.js';

describe('exteriorLockedChanceFor', () => {
  it('wpis z mapy, a rodzaj spoza mapy / nieznany / brak — exteriorLockedChance', () => {
    const s = { exteriorLockedChance: 0.3, exteriorLockedChanceByBuilding: { shop: 0.7, gate: 0 } };
    expect(exteriorLockedChanceFor(s, 'shop')).toBe(0.7);
    expect(exteriorLockedChanceFor(s, 'gate')).toBe(0);
    expect(exteriorLockedChanceFor(s, 'house')).toBe(0.3);
    expect(exteriorLockedChanceFor(s, 'spaceship')).toBe(0.3);
    expect(exteriorLockedChanceFor(s, undefined)).toBe(0.3);
    expect(exteriorLockedChanceFor({ exteriorLockedChance: 0.1 }, 'shop')).toBe(0.1);
  });

  it('schemat: mapa opcjonalna, tylko znane rodzaje i szanse 0–1', () => {
    expect(LocksSettingsSchema.parse({}).exteriorLockedChanceByBuilding).toBeUndefined();
    expect(
      LocksSettingsSchema.safeParse({ exteriorLockedChanceByBuilding: { house: 0.4 } }).success,
    ).toBe(true);
    expect(
      LocksSettingsSchema.safeParse({ exteriorLockedChanceByBuilding: { castle: 0.4 } }).success,
    ).toBe(false);
    expect(
      LocksSettingsSchema.safeParse({ exteriorLockedChanceByBuilding: { house: 1.2 } }).success,
    ).toBe(false);
  });

  it('dane bazowe: domy 0,4, sklepy i usługi 0,7, garaże 0,5, publiczne 0,2, bramy 0,1', async () => {
    const locks = (await baseBundle()).worldSettings.openings.locks;
    const at = (k: string | undefined) => exteriorLockedChanceFor(locks, k);
    expect(locks.exteriorLockedChance).toBe(0.4);
    expect(at('house')).toBe(0.4);
    for (const k of ['shop', 'pharmacy', 'fuel', 'gym', 'office', 'industrial'])
      expect(at(k), k).toBe(0.7);
    expect(at('garage')).toBe(0.5);
    for (const k of ['hospital', 'school', 'police']) expect(at(k), k).toBe(0.2);
    expect(at('gate')).toBe(0.1);
    expect(at('ruin')).toBe(0);
    expect(at(undefined)).toBe(0.4);
    const listed = Object.keys(locks.exteriorLockedChanceByBuilding ?? {}).sort();
    expect(listed).toEqual([...BUILDING_KINDS, 'gate'].sort());
  });
});
