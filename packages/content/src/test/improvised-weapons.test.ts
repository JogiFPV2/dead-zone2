import { describe, expect, it } from 'vitest';
import { defaultMeleeStats, meleeStatsFor, type MeleeStatsView } from '../combat/index.js';
import { baseBundle } from './base-bundle.js';

const dps = (s: MeleeStatsView) => ((s.damage.min + s.damage.max) / 2) * s.attackSpeed;

/** Improwizowana broń → odpowiadająca jej prawdziwa broń z katalogu (#14). */
const COUNTERPARTS: Record<string, string> = {
  'base:plank': 'base:baseball-bat',
  'base:wooden-stick': 'base:golf-club',
  'base:log': 'base:sledgehammer',
  'base:cooking-pot': 'base:frying-pan',
  'base:stone-hammer': 'base:hammer',
  'base:saw': 'base:machete',
  'base:scrap-metal': 'base:metal-pipe',
  'base:metal-sheet': 'base:machete',
  'base:flashlight': 'base:hammer',
  'base:camping-lantern': 'base:hammer',
  'base:welding-torch': 'base:crowbar',
  'base:glass-shards': 'base:kitchen-knife',
  'base:typewriter': 'base:sledgehammer',
  'base:chain': 'base:metal-pipe',
  'base:gas-can': 'base:crowbar',
  'base:radio': 'base:hammer',
  // improwizowana broń z katalogu
  'base:stone': 'base:hammer',
  'base:brick': 'base:hammer',
  'base:bottle': 'base:hammer',
  'base:broken-bottle': 'base:kitchen-knife',
  'base:frying-pan': 'base:crowbar',
  'base:rolling-pin': 'base:baseball-bat',
};

describe('improwizowana broń (jak w PZ)', () => {
  it('każdy przedmiot paczki bazowej ma statystyki ataku', async () => {
    const b = await baseBundle();
    for (const item of Object.values(b.items)) {
      const s = meleeStatsFor(item);
      // Przedmioty nieraniące (`harmless`: chusteczka, papier) tylko pchają.
      if (item.harmless) expect(s.damage.max, item.id).toBe(0);
      else expect(s.damage.max, item.id).toBeGreaterThan(0);
      expect(s.damage.min, item.id).toBeLessThanOrEqual(s.damage.max);
      expect(s.rangeTiles, item.id).toBeGreaterThan(0);
      expect(s.attackSpeed, item.id).toBeGreaterThan(0);
      expect(s.durability, item.id).toBeGreaterThanOrEqual(1);
      expect(s.breakChancePct, item.id).toBeGreaterThanOrEqual(0);
      expect(s.breakChancePct, item.id).toBeLessThanOrEqual(100);
      expect(b.skills[s.skill], `${item.id} → ${s.skill}`).toBeDefined();
      const expected =
        item.kind === 'weapon_melee' ? 'weapon' : item.improvisedWeapon ? 'improvised' : 'default';
      expect(s.source, item.id).toBe(expected);
      if (item.kind === 'weapon_melee') expect(item.improvisedWeapon, item.id).toBeUndefined();
      if (item.harmless) expect(item.improvisedWeapon, item.id).toBeUndefined();
    }
  });

  it('nieraniące: ubrania, bandaże, szmaty i gazetki nie zadają obrażeń, cegła tak', async () => {
    const b = await baseBundle();
    for (const id of [
      'base:t-shirt',
      'base:bandage',
      'base:rag',
      'base:mag-angler',
      'base:plastic-bag',
    ])
      expect(meleeStatsFor(b.items[id]!).damage, id).toEqual({ min: 0, max: 0 });
    expect(meleeStatsFor(b.items['base:brick']!).damage.max).toBeGreaterThan(0);
  });

  it('broń z katalogu zachowuje swoje statystyki', async () => {
    const b = await baseBundle();
    expect(meleeStatsFor(b.items['base:crowbar']!)).toMatchObject({
      damage: { min: 14, max: 22 },
      rangeTiles: 1.2,
      attackSpeed: 0.9,
      durability: 300,
      breakChancePct: 5,
      skill: 'base:blunt',
      source: 'weapon',
    });
    expect(meleeStatsFor(b.items['base:axe']!)).toMatchObject({
      damageType: 'sharp',
      twoHanded: true,
    });
  });

  it('improwizowana broń jest słabsza od odpowiadającej prawdziwej broni', async () => {
    const b = await baseBundle();
    const withBlock = Object.values(b.items)
      .filter((i) => i.improvisedWeapon)
      .map((i) => i.id);
    expect(withBlock.filter((id) => !COUNTERPARTS[id])).toEqual([]);
    for (const [id, refId] of Object.entries(COUNTERPARTS)) {
      const s = meleeStatsFor(b.items[id]!);
      const ref = meleeStatsFor(b.items[refId]!);
      expect(ref.source, refId).toBe('weapon');
      expect(s.damage.max, `${id} vs ${refId}`).toBeLessThanOrEqual(ref.damage.max);
      expect(dps(s), `${id} vs ${refId}`).toBeLessThan(dps(ref));
    }
  });

  it('wartości domyślne są słabe i rosną z wagą', async () => {
    const b = await baseBundle();
    const weakest = Math.min(
      ...Object.values(b.items)
        .filter((i) => i.kind === 'weapon_melee' && i.melee.category !== 'improvised')
        .map((i) => dps(meleeStatsFor(i))),
    );
    for (const kg of [0, 0.3, 1, 3, 8, 60])
      expect(dps(defaultMeleeStats(kg)), `${kg} kg`).toBeLessThan(weakest);
    expect(defaultMeleeStats(3).damage.max).toBeGreaterThan(defaultMeleeStats(0.2).damage.max);
    expect(defaultMeleeStats(12).twoHanded).toBe(true);
    expect(meleeStatsFor(b.items['base:pistol']!).source).toBe('default');
  });
});
