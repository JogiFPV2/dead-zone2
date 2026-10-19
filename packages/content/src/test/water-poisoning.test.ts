import { describe, expect, it } from 'vitest';
import { WaterPoisoningSchema, WaterSettingsSchema, type WaterPoisoning } from '../index.js';
import { baseBundle } from './base-bundle.js';
import { SIM_POISONING } from './water-poisoning-sim.js';

describe('worldSettings.water.poisoning', () => {
  it('domyślne wartości schematu = POISONING z sim (te same pola)', () => {
    const p: WaterPoisoning = WaterPoisoningSchema.parse({});
    expect(p).toEqual(SIM_POISONING);
    expect(WaterSettingsSchema.parse(undefined).poisoning).toBeUndefined();
  });

  it('paczka bazowa (world-settings/water.json) = POISONING z sim', async () => {
    expect((await baseBundle()).worldSettings.water.poisoning).toEqual(SIM_POISONING);
  });

  it('mod zmienia jedno pole, reszta domyślna', () => {
    expect(WaterPoisoningSchema.parse({ dose: 50 })).toEqual({ ...SIM_POISONING, dose: 50 });
  });

  it('odrzuca złe wartości i nieznane pola', () => {
    for (const bad of [
      { taintedChance: 1.5 },
      { taintedChance: -0.1 },
      { dose: -1 },
      { dose: 101 },
      { risePerHour: -1 },
      { healthLossPerMin: -0.1 },
      { minHealth: 200 },
      { vomit: true },
    ])
      expect(WaterPoisoningSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});
