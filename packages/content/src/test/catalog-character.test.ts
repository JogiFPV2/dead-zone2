import { describe, expect, it } from 'vitest';
import { baseBundle } from './base-bundle.js';

describe('katalog postaci: zawody i cechy w data/base', () => {
  it('ma ~15 zawodów i ~40 cech z kluczami i18n', async () => {
    const b = await baseBundle();
    const professions = Object.values(b.professions);
    const traits = Object.values(b.traits);
    expect(professions.length).toBeGreaterThanOrEqual(15);
    expect(traits.length).toBeGreaterThanOrEqual(40);
    for (const p of professions) expect(p.name).toBe(`profession.base.${p.id.slice(5)}.name`);
    for (const t of traits) expect(t.name).toBe(`trait.base.${t.id.slice(5)}.name`);
    expect(professions.map((p) => p.id)).toEqual(
      expect.arrayContaining(['base:unemployed', 'base:veteran', 'base:park-ranger']),
    );
  });

  it('koszt cechy zgadza się z polaryzacją, a bilans zawodów jest w rozsądnym zakresie', async () => {
    const b = await baseBundle();
    for (const t of Object.values(b.traits)) {
      if (t.polarity === 'positive' && t.selectable) expect(t.cost, t.id).toBeGreaterThan(0);
      if (t.polarity === 'negative') expect(t.cost, t.id).toBeLessThan(0);
      if (!t.selectable) expect(t.cost, t.id).toBe(0);
    }
    const points = Object.values(b.professions).map((p) => p.points);
    expect(Math.max(...points)).toBe(8);
    expect(Math.min(...points)).toBeGreaterThanOrEqual(-8);
    const traits = Object.values(b.traits);
    expect(traits.filter((t) => t.selectable && t.cost > 0).length).toBeGreaterThanOrEqual(15);
    expect(traits.filter((t) => t.cost < 0).length).toBeGreaterThanOrEqual(15);
  });

  it('konflikty cech są czyste: istniejące cele, bez siebie samej, np. silny ↔ słaby', async () => {
    const b = await baseBundle();
    const conflict = (a: string, c: string) =>
      (b.traits[a]?.conflicts.includes(c) ?? false) ||
      (b.traits[c]?.conflicts.includes(a) ?? false);
    for (const t of Object.values(b.traits)) {
      for (const c of t.conflicts) {
        expect(b.traits[c], `${t.id} → ${c}`).toBeDefined();
        expect(c).not.toBe(t.id);
      }
    }
    for (const [a, c] of [
      ['base:strong', 'base:weak'],
      ['base:athletic', 'base:unfit'],
      ['base:fast-learner', 'base:slow-learner'],
      ['base:overweight', 'base:underweight'],
      ['base:keen-ears', 'base:hard-of-hearing'],
    ] as const) {
      expect(conflict(a, c), `${a} × ${c}`).toBe(true);
    }
  });

  it('darmowe cechy zawodów nie kolidują ze sobą i istnieją', async () => {
    const b = await baseBundle();
    for (const p of Object.values(b.professions)) {
      for (const [i, a] of p.freeTraits.entries()) {
        const ta = b.traits[a];
        expect(ta, `${p.id}: ${a}`).toBeDefined();
        for (const c of p.freeTraits.slice(i + 1)) {
          expect(ta?.conflicts.includes(c) || b.traits[c]?.conflicts.includes(a)).toBe(false);
        }
      }
    }
  });

  it('cechy dynamiczne: waga z odżywiania i lęk przed krwią znikający od zabójstw', async () => {
    const b = await baseBundle();
    expect(b.traits['base:overweight']?.gainedWhen).toMatchObject({
      stat: 'body-weight-kg',
      op: 'gte',
    });
    expect(b.traits['base:overweight']?.lostWhen?.op).toBe('lte');
    expect(b.traits['base:underweight']?.gainedWhen).toMatchObject({
      stat: 'body-weight-kg',
      op: 'lte',
    });
    expect(b.traits['base:hemophobic']?.lostWhen).toMatchObject({ stat: 'zombies-killed' });
    expect(b.traits['base:hardened']?.gainedWhen?.stat).toBe('zombies-killed');
    const dynamic = Object.values(b.traits).filter((t) => t.gainedWhen || t.lostWhen);
    expect(dynamic.length).toBeGreaterThanOrEqual(4);
    // Histereza: próg utraty wagi leży po drugiej stronie progu zdobycia.
    const ow = b.traits['base:overweight']!;
    expect(ow.lostWhen!.value).toBeLessThan(ow.gainedWhen!.value);
  });

  it('cechy mają modyfikatory jako dane, w tym warunkowe i mnożniki XP', async () => {
    const traits = Object.values((await baseBundle()).traits);
    expect(traits.some((t) => t.modifiers.some((m) => m.when !== undefined))).toBe(true);
    expect(traits.filter((t) => t.xpMultipliers.length > 0).length).toBeGreaterThanOrEqual(4);
    for (const t of traits) {
      const effects = t.modifiers.length + t.skillBonuses.length + t.xpMultipliers.length;
      expect(effects, t.id).toBeGreaterThan(0);
    }
  });
});
