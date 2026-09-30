import { z } from 'zod';
import { TilesSchema } from './common/index.js';

/** Crafting: składniki z ekwipunku i ze schowków w promieniu `nearbyRadiusTiles` (1 kafel = 1 m). */
export const CraftingSettingsSchema = z
  .strictObject({ nearbyRadiusTiles: TilesSchema.default(3) })
  .default({ nearbyRadiusTiles: 3 });

export type CraftingSettings = z.infer<typeof CraftingSettingsSchema>;
