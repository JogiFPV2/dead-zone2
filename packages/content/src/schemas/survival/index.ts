import { z } from 'zod';
import { HealthSettingsSchema, InfectionSettingsSchema } from './health.js';
import {
  BoredomSettingsSchema,
  PanicSettingsSchema,
  StressSettingsSchema,
  UnhappinessSettingsSchema,
} from './mind.js';
import { ActivitySchema, NeedsSchema } from './needs.js';
import { NutritionSettingsSchema } from './nutrition.js';
import { SleepSettingsSchema } from './sleep.js';
import { TemperatureSettingsSchema, WetnessSettingsSchema } from './temperature.js';
import { WoundSettingsSchema } from './wounds.js';

export * from './needs.js';
export * from './nutrition.js';
export * from './temperature.js';
export * from './mind.js';
export * from './sleep.js';
export * from './wounds.js';
export * from './health.js';

/**
 * Stałe przetrwania dla `packages/sim` (`worldSettings.survival`). Tempa w punktach 0–100
 * na minutę gry; adapter Symulacji przelicza je raz na „na tick”.
 */
export const SurvivalSettingsSchema = z
  .strictObject({
    needs: NeedsSchema,
    activity: ActivitySchema,
    nutrition: NutritionSettingsSchema,
    temperature: TemperatureSettingsSchema,
    wetness: WetnessSettingsSchema,
    panic: PanicSettingsSchema,
    stress: StressSettingsSchema,
    boredom: BoredomSettingsSchema,
    unhappiness: UnhappinessSettingsSchema,
    sleep: SleepSettingsSchema,
    health: HealthSettingsSchema,
    wounds: WoundSettingsSchema,
    infection: InfectionSettingsSchema,
  })
  .prefault({});

export type SurvivalSettings = z.infer<typeof SurvivalSettingsSchema>;
