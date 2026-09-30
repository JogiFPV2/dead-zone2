import { describe, expect, it } from 'vitest';
import type { LiteratureItem } from '../schemas/item/literature.js';
import { baseBundle } from './base-bundle.js';

const books = async () =>
  Object.values((await baseBundle()).items).filter(
    (i): i is LiteratureItem => i.kind === 'literature',
  );

describe('katalog receptur i książek w data/base', () => {
  it('ma ~30 receptur we wszystkich grupach, z czasem, XP i umiejętnościami', async () => {
    const recipes = Object.values((await baseBundle()).recipes);
    expect(recipes.length).toBeGreaterThanOrEqual(30);
    const groups = new Set(recipes.map((r) => r.category));
    for (const g of [
      'survival',
      'medical',
      'carpentry',
      'weapons',
      'cooking',
      'tailoring',
      'metalworking',
      'electrical',
    ] as const) {
      expect(groups.has(g), g).toBe(true);
    }
    for (const r of recipes) {
      expect(r.durationMin, r.id).toBeGreaterThan(0);
      expect(r.xp.length, r.id).toBeGreaterThan(0);
    }
    const ids = recipes.map((r) => r.id);
    for (const id of ['make-bandage', 'boil-water', 'build-campfire', 'saw-planks'])
      expect(ids).toContain(`base:${id}`);
  });

  it('receptury naprawy mają cel, stacje dają przedmioty z tagiem', async () => {
    const b = await baseBundle();
    const repairs = Object.values(b.recipes).filter((r) => r.repair);
    expect(repairs.map((r) => r.id).sort()).toEqual(
      ['base:repair-clothing', 'base:tape-repair-bat', 'base:tape-repair-weapon'].sort(),
    );
    const tags = new Set(Object.values(b.items).flatMap((i) => i.tags));
    for (const r of Object.values(b.recipes)) if (r.station) expect(tags.has(r.station)).toBe(true);
  });

  it('każda receptura do nauczenia ma źródło: książkę, zawód albo cechę', async () => {
    const b = await baseBundle();
    const sources = new Set([
      ...(await books()).flatMap((i) => i.literature.unlocksRecipes),
      ...Object.values(b.professions).flatMap((p) => p.knownRecipes),
      ...Object.values(b.traits).flatMap((t) => t.knownRecipes),
    ]);
    const learned = Object.values(b.recipes).filter((r) => r.requiresLearning);
    expect(learned.length).toBeGreaterThanOrEqual(10);
    for (const r of learned) expect(sources.has(r.id), r.id).toBe(true);
  });

  it('serie książek: 5 tomów na umiejętność, ciągłe poziomy i rosnący mnożnik XP', async () => {
    const bySkill = new Map<string, LiteratureItem['literature']['skillBook'][]>();
    for (const b of await books()) {
      const sb = b.literature.skillBook;
      if (sb && b.tags.includes('base:skill-book'))
        bySkill.set(sb.skill, [...(bySkill.get(sb.skill) ?? []), sb]);
    }
    expect(bySkill.size).toBeGreaterThanOrEqual(6);
    for (const [skill, vols] of bySkill) {
      const sorted = vols.sort((a, c) => a!.minLevel - c!.minLevel);
      expect(sorted.length, skill).toBe(5);
      sorted.forEach((v, i) => {
        if (i === 0) return expect(v!.minLevel).toBe(0);
        expect(v!.minLevel).toBe(sorted[i - 1]!.maxLevel + 1);
        expect(v!.multiplier).toBeGreaterThan(sorted[i - 1]!.multiplier);
      });
    }
    const mags = (await books()).filter((b) => b.literature.format === 'magazine');
    expect(
      mags.filter((m) => m.literature.unlocksRecipes.length > 0).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('każda książka i magazyn trafia do lootu księgarni, domu i szkoły', async () => {
    const b = await baseBundle();
    const reach = (id: string, seen = new Set<string>()): Set<string> => {
      for (const e of b.lootTables[id]?.entries ?? []) {
        if ('item' in e) seen.add(e.item);
        else reach(e.table, seen);
      }
      return seen;
    };
    const lit = (await books()).map((i) => i.id);
    const bookstore = reach('base:bookstore');
    for (const id of lit) expect(bookstore.has(id), id).toBe(true);
    for (const t of ['base:living-room', 'base:bedroom', 'base:school']) {
      const got = reach(t);
      expect(
        lit.some((id) => got.has(id)),
        t,
      ).toBe(true);
    }
    expect(b.lootTables['base:bookstore']?.rooms).toEqual(['base:room-bookstore']);
  });
});
