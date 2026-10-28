import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TREE_CROWN_DENSITY,
  DEFAULT_TREE_LEAF_CLUSTERS,
  DEFAULT_TREE_WIND_SWAY,
  TREE_HABITATS,
  TreeSpeciesSchema,
} from '../schemas/tree-species.js';
import { baseBundle } from './base-bundle.js';

const minimal = {
  id: 'base:t',
  name: 'tree.base.t.name',
  leafType: 'broadleaf',
  heightM: { min: 5, max: 10 },
  crownRadiusM: { min: 1, max: 2 },
  trunk: { radiusM: 0.2 },
  colors: { summer: [{ hex: '#336633' }], autumn: [{ hex: '#aa6633' }] },
};

describe('gatunki drzew', () => {
  it('schemat: domyślne wartości', () => {
    const t = TreeSpeciesSchema.parse(minimal);
    expect(t).toMatchObject({
      shrub: false,
      crownDensity: DEFAULT_TREE_CROWN_DENSITY,
      leafClusters: DEFAULT_TREE_LEAF_CLUSTERS,
      windSway: DEFAULT_TREE_WIND_SWAY,
      habitats: {},
      colors: { winter: [], summer: [{ hex: '#336633', weight: 1 }] },
      trunk: { color: '#5a4636' },
    });
  });

  it('schemat: odrzuca złe wartości i nieznane pola', () => {
    const bad = (o: object) => TreeSpeciesSchema.safeParse({ ...minimal, ...o }).success;
    expect(bad({ leafType: 'palm' })).toBe(false);
    expect(bad({ heightM: { min: 10, max: 5 } })).toBe(false);
    expect(bad({ crownDensity: 1.2 })).toBe(false);
    expect(bad({ leafClusters: { min: 9, max: 3 } })).toBe(false);
    expect(bad({ colors: { summer: [], autumn: [{ hex: '#aa6633' }] } })).toBe(false);
    expect(bad({ colors: { summer: [{ hex: '#ABC' }], autumn: [{ hex: '#aa6633' }] } })).toBe(
      false,
    );
    expect(bad({ habitats: { desert: 1 } })).toBe(false);
    expect(bad({ foo: 1 })).toBe(false);
  });

  it('paczka bazowa: różnorodność gatunków', async () => {
    const all = Object.values((await baseBundle()).treeSpecies);
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    const leaf = new Set(all.map((t) => t.leafType));
    expect(leaf).toEqual(new Set(['broadleaf', 'conifer']));
    for (const id of ['base:pine', 'base:birch', 'base:oak'])
      expect(all.map((t) => t.id)).toContain(id);
    for (const t of all) {
      expect(t.colors.summer.length, t.id).toBeGreaterThan(0);
      expect(t.colors.autumn.length, t.id).toBeGreaterThan(0);
      // Iglaste zimą zielone, liściaste bez liści.
      expect(t.colors.winter.length > 0, t.id).toBe(t.leafType === 'conifer');
      expect(t.crownRadiusM.max, t.id).toBeLessThan(t.heightM.max);
      if (t.leafType === 'broadleaf')
        expect(
          t.colors.autumn.map((c) => c.hex),
          t.id,
        ).not.toEqual(t.colors.summer.map((c) => c.hex));
    }
  });

  it('paczka bazowa: każde siedlisko ma ≥2 gatunki, żaden nie przekracza 60% wagi', async () => {
    const all = Object.values((await baseBundle()).treeSpecies);
    for (const h of TREE_HABITATS) {
      const w = all.map((t) => t.habitats[h] ?? 0).filter((x) => x > 0);
      const sum = w.reduce((a, b) => a + b, 0);
      expect(w.length, h).toBeGreaterThanOrEqual(2);
      expect(Math.max(...w) / sum, h).toBeLessThanOrEqual(0.6);
    }
  });
});
