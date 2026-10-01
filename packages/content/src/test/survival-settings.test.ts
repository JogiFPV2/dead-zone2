import { describe, expect, it } from 'vitest';
import { SurvivalSettingsSchema } from '../schemas/survival/index.js';
import { WorldSettingsSchema } from '../schemas/world-settings.js';
import { validatePacks } from '../validate/validate-packs.js';
import { baseBundle } from './base-bundle.js';
import { memPack, miniBase } from './helpers.js';

describe('SurvivalSettingsSchema', () => {
  it('ma komplet wartości domyślnych, więc pusty plik jest poprawny', () => {
    const s = SurvivalSettingsSchema.parse({});
    expect(s.needs.hungerPerMin).toBeGreaterThan(0);
    expect(s.wounds.types.bite.zombieInfectionChance).toBeGreaterThan(0);
    expect(WorldSettingsSchema.parse({}).survival).toEqual(s);
  });

  it('odrzuca nieznane pola, ujemne tempa i odwrócone przedziały', () => {
    expect(SurvivalSettingsSchema.safeParse({ needs: { hunger: 1 } }).success).toBe(false);
    expect(SurvivalSettingsSchema.safeParse({ needs: { thirstPerMin: -1 } }).success).toBe(false);
    const bad = { infection: { deathAfterMin: { min: 500, max: 100 } } };
    expect(SurvivalSettingsSchema.safeParse(bad).error?.issues[0]?.path).toEqual([
      'infection',
      'deathAfterMin',
      'max',
    ]);
  });

  it('mod zmienia jedno pole, reszta zostaje z bazy', () => {
    const base = miniBase();
    base.files.push({ path: 'world-settings.json', json: { dayLengthMinutes: 60 } });
    const mod = memPack(
      'my-mod',
      { 'world-settings.json': { survival: { needs: { thirstPerMin: 0.05 } } } },
      { dependencies: [{ id: 'base' }] },
    );
    const r = validatePacks([base, mod]);
    expect(r.errors).toEqual([]);
    expect(r.worldSettings.survival.needs.thirstPerMin).toBe(0.05);
    expect(r.worldSettings.survival.needs.hungerPerMin).toBe(0.0175);
  });
});

describe('fragmenty world-settings/*.json', () => {
  it('łączą się po world-settings.json, a błąd wskazuje plik fragmentu', () => {
    const pack = miniBase({
      'world-settings/b.json': { survival: { sleep: { maxDurationMin: 600 } } },
      'world-settings/a.json': { survival: { sleep: { maxDurationMin: 500, wakeAtFatigue: 5 } } },
    });
    pack.files.push({ path: 'world-settings.json', json: { dayLengthMinutes: 90 } });
    const r = validatePacks([pack]);
    expect(r.errors).toEqual([]);
    expect(r.worldSettings.dayLengthMinutes).toBe(90);
    expect(r.worldSettings.survival.sleep).toMatchObject({ maxDurationMin: 600, wakeAtFatigue: 5 });

    const broken = miniBase({ 'world-settings/x.json': { survival: { panic: { radius: 3 } } } });
    const errors = validatePacks([broken]).errors;
    expect(errors).toEqual([expect.objectContaining({ file: 'world-settings/x.json' })]);
  });

  it('paczka bazowa ma przetrwanie w fragmentach i dzieli je po kategoriach', async () => {
    const b = await baseBundle();
    expect(Object.keys(b.worldSettings.survival).sort()).toEqual(
      [
        'activity',
        'boredom',
        'health',
        'infection',
        'leisure',
        'needs',
        'nutrition',
        'panic',
        'sleep',
        'stress',
        'temperature',
        'unhappiness',
        'wetness',
        'wounds',
        'woundPenalties',
      ].sort(),
    );
    expect(b.worldSettings.loot.rarityWeightPct.rare).toBe(100);
  });
});
