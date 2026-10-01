import { z } from 'zod';
import { FractionSchema, TilesSchema } from './common/index.js';

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
  })
  .prefault({});

export type CraftingSettings = z.infer<typeof CraftingSettingsSchema>;
