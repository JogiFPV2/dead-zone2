import { z } from 'zod';
import { FractionSchema, ItemRefSchema } from '../common/index.js';

/** Trwałość: pula punktów, szansa utraty punktu na użycie, co zostaje po zniszczeniu. */
export const DurabilitySchema = z.strictObject({
  max: z.number().int().min(1).max(10000),
  lossChancePerUse: FractionSchema.default(1),
  brokenInto: ItemRefSchema.optional(),
  repairable: z.boolean().default(false),
});

export type Durability = z.infer<typeof DurabilitySchema>;
