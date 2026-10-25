import { describe, expect, it } from 'vitest';
import { AiSettingsSchema } from './ai-settings.js';
import { DEFAULT_AI_STOP_GAP_M } from './ai-stop-gap.js';
import {
  CombatSettingsSchema,
  DEFAULT_ZOMBIE_CAR_REACH_M,
  DEFAULT_ZOMBIE_HIT_CHANCE,
} from './combat-settings.js';
import combat from '../../data/base/world-settings/combat.json' with { type: 'json' };
import ai from '../../data/base/world-settings/ai.json' with { type: 'json' };

describe('worldSettings.combat.zombie + ai.stopGapM', () => {
  it('stałe domyślne', () => {
    expect(DEFAULT_ZOMBIE_HIT_CHANCE).toBe(0.7);
    expect(DEFAULT_ZOMBIE_CAR_REACH_M).toBe(0.9);
    expect(DEFAULT_AI_STOP_GAP_M).toBe(0.15);
  });

  it('schemat nie wstawia domyślnych', () => {
    expect(CombatSettingsSchema.parse({})).toEqual({});
    expect(CombatSettingsSchema.parse({ zombie: {} })).toEqual({ zombie: {} });
    expect(AiSettingsSchema.parse({}).stopGapM).toBeUndefined();
  });

  it('zakresy i strict', () => {
    const bad = [{ hitChance: 1.1 }, { hitChance: -0.1 }, { carReachM: 0 }, { extra: 1 }];
    for (const zombie of bad)
      expect(CombatSettingsSchema.safeParse({ zombie }).success).toBe(false);
    expect(AiSettingsSchema.safeParse({ stopGapM: -0.01 }).success).toBe(false);
    expect(AiSettingsSchema.parse({ stopGapM: 0 }).stopGapM).toBe(0);
  });

  it('paczka base = stałe', () => {
    expect(CombatSettingsSchema.parse(combat.combat)).toEqual({
      zombie: { hitChance: DEFAULT_ZOMBIE_HIT_CHANCE, carReachM: DEFAULT_ZOMBIE_CAR_REACH_M },
    });
    expect(AiSettingsSchema.parse(ai.ai).stopGapM).toBe(DEFAULT_AI_STOP_GAP_M);
  });
});
