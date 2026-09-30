import { describe, expect, it } from 'vitest';
import { baseBundle } from './base-bundle.js';

describe('stacje w data/base', () => {
  it('base: 4 stacje po 3 poziomy, każda ma receptury na poziomach 2 i 3', async () => {
    const b = await baseBundle();
    expect(Object.keys(b.stations).sort()).toEqual([
      'base:station-electronics',
      'base:station-fire',
      'base:station-mechanic',
      'base:station-workbench',
    ]);
    const recipes = Object.values(b.recipes);
    for (const s of Object.values(b.stations)) {
      expect(s.levels.map((l) => l.level)).toEqual([1, 2, 3]);
      for (const lvl of [2, 3])
        expect(
          recipes.some((r) => r.station?.id === s.id && r.station.minLevel === lvl),
          `${s.id} ${lvl}`,
        ).toBe(true);
    }
    const combine = recipes.filter((r) => r.kind === 'combine');
    expect(combine.length).toBeGreaterThanOrEqual(8);
    expect(combine.map((r) => r.id)).toContain('base:craft-nailed-stick');
    expect(recipes.filter((r) => r.station).length).toBeGreaterThanOrEqual(18);
  });

  it('poziomy mają recepturę ulepszenia i bonus czasu; promień składników 3 kafle', async () => {
    const b = await baseBundle();
    for (const s of Object.values(b.stations)) {
      expect(s.levels.map((l) => l.craftTimeMultiplier)).toEqual([1, 0.8, 0.65]);
      for (const l of s.levels) expect(b.recipes[l.recipe]?.category, l.recipe).toBe('stations');
    }
    expect(b.worldSettings.crafting.nearbyRadiusTiles).toBe(3);
  });
});
