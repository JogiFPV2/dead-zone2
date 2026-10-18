import { z } from 'zod';
import { FractionSchema, TilesSchema } from './common/index.js';

const BURN_DEFAULTS = {
  enabled: true,
  stations: ['base:station-fire'],
  skill: 'base:cooking',
  chance: 0.25,
  chancePerSkillLevel: 0.05,
  nutritionMultiplier: 0.5,
  unhappiness: 10,
};

/**
 * Przypalanie (docs 9.52): wynik-jedzenie receptury na stacji z `stations` przypala się z szansą
 * max(0, `chance` − `chancePerSkillLevel` × poziom `skill`). Przypalone (`burnt`) daje
 * `nutritionMultiplier` wartości odżywczej i +`unhappiness` za całą porcję.
 */
const BurnSchema = z
  .strictObject({
    enabled: z.boolean().default(BURN_DEFAULTS.enabled),
    stations: z.array(z.string().min(1)).default(BURN_DEFAULTS.stations),
    skill: z.string().min(1).default(BURN_DEFAULTS.skill),
    chance: FractionSchema.default(BURN_DEFAULTS.chance),
    chancePerSkillLevel: FractionSchema.default(BURN_DEFAULTS.chancePerSkillLevel),
    nutritionMultiplier: FractionSchema.default(BURN_DEFAULTS.nutritionMultiplier),
    unhappiness: z.number().min(0).max(100).default(BURN_DEFAULTS.unhappiness),
  })
  .default(BURN_DEFAULTS);

/**
 * Crafting: składniki z ekwipunku i ze schowków w promieniu `nearbyRadiusTiles` (1 kafel = 1 m).
 * Czas receptury: `durationMin` × mnożnik stacji × max(`minTimeMultiplier`,
 * 1 − `timeReductionPerSkillLevel` × poziomy ponad wymagany).
 */
export const CraftingSettingsSchema = z
  .strictObject({
    nearbyRadiusTiles: TilesSchema.default(3),
    timeReductionPerSkillLevel: FractionSchema.default(0.05),
    minTimeMultiplier: FractionSchema.default(0.5),
    burn: BurnSchema,
  })
  .prefault({});

export type CraftingSettings = z.infer<typeof CraftingSettingsSchema>;
