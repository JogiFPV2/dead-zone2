import { z } from 'zod';
import { FractionSchema } from './common/index.js';

/** Wartość statystyki 0–100 (zatrucie, zdrowie). */
const Stat = z.number().min(0).max(100);
/** Tempo na godzinę gry (≥ 0). */
const PerHour = z.number().min(0).max(1000);

export const WATER_POISONING_DEFAULTS = {
  taintedChance: 0.4,
  dose: 35,
  risePerHour: 20,
  recoverPerHour: 4,
  nauseaFrom: 20,
  unhappinessPerHour: 4,
  healthLossFrom: 70,
  healthLossPerMin: 0.02,
  minHealth: 10,
};

/**
 * Zatrucie brudną wodą (Symulacja, docs 9.60): łyk brudnej wody (butelka z
 * `drink.perUse.sicknessChance` albo zbiornik `tainted`) losuje zatrucie z szansą
 * `taintedChance` (gdy butelka nie ma własnej) × modyfikator cech. Trafienie dodaje `dose` do
 * zaległego zatrucia, które przechodzi w `poison` w tempie `risePerHour`, potem spada o
 * `recoverPerHour`. Od `nauseaFrom` rośnie przygnębienie (`unhappinessPerHour`), od
 * `healthLossFrom` spada zdrowie o `healthLossPerMin` na minutę gry, ale nie poniżej `minHealth`.
 */
export const WaterPoisoningSchema = z.strictObject({
  taintedChance: FractionSchema.default(WATER_POISONING_DEFAULTS.taintedChance),
  dose: Stat.default(WATER_POISONING_DEFAULTS.dose),
  risePerHour: PerHour.default(WATER_POISONING_DEFAULTS.risePerHour),
  recoverPerHour: PerHour.default(WATER_POISONING_DEFAULTS.recoverPerHour),
  nauseaFrom: Stat.default(WATER_POISONING_DEFAULTS.nauseaFrom),
  unhappinessPerHour: PerHour.default(WATER_POISONING_DEFAULTS.unhappinessPerHour),
  healthLossFrom: Stat.default(WATER_POISONING_DEFAULTS.healthLossFrom),
  healthLossPerMin: z.number().min(0).max(100).default(WATER_POISONING_DEFAULTS.healthLossPerMin),
  minHealth: Stat.default(WATER_POISONING_DEFAULTS.minHealth),
});

export type WaterPoisoning = z.infer<typeof WaterPoisoningSchema>;
