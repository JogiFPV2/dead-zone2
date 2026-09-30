import { z } from 'zod';
import { GameMinutesSchema, ItemRefSchema } from '../common/index.js';

/**
 * Psucie się (minuty gry): świeże do `freshMin`, potem nieświeże do `rottenMin`, potem zepsute.
 * Lodówka spowalnia psucie mnożnikiem `spoilageMultiplier` z definicji schowka (container-type).
 */
export const SpoilageSchema = z
  .strictObject({
    freshMin: GameMinutesSchema,
    rottenMin: GameMinutesSchema,
    rottenInto: ItemRefSchema.optional(),
  })
  .refine((s) => s.freshMin <= s.rottenMin, {
    message: 'freshMin musi być ≤ rottenMin',
    path: ['rottenMin'],
  });

export type Spoilage = z.infer<typeof SpoilageSchema>;
