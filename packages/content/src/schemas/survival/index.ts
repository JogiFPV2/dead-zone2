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
import { HygieneSettingsSchema } from './hygiene.js';
import { LeisureSettingsSchema } from './leisure.js';
import { SleepSettingsSchema } from './sleep.js';
import { TemperatureSettingsSchema, WetnessSettingsSchema } from './temperature.js';
import { WoundPenaltiesSchema } from './wound-penalties.js';
import { WoundSettingsSchema } from './wounds.js';

export * from './needs.js';
export * from './nutrition.js';
export * from './temperature.js';
export * from './mind.js';
export * from './sleep.js';
export * from './leisure.js';
export * from './hygiene.js';
export * from './wounds.js';
export * from './wound-penalties.js';
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
    /** Czytanie, TV, VHS: odpoczynek od zmęczenia, nuda i stres za sesję. */
    leisure: LeisureSettingsSchema,
    /** Brud, mycie (umywalka, prysznic, wanna) i picie z kranu; potrzebna woda w sieci. */
    hygiene: HygieneSettingsSchema,
    health: HealthSettingsSchema,
    wounds: WoundSettingsSchema,
    /** Kary z ran do ruchu, ataku, tempa akcji i widzenia (do balansu z Symulacją). */
    woundPenalties: WoundPenaltiesSchema,
    infection: InfectionSettingsSchema,
  })
  .prefault({});

export type SurvivalSettings = z.infer<typeof SurvivalSettingsSchema>;
