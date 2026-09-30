import { z } from 'zod';
import { GameMinutesSchema, ItemRefSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';
import { NutritionSchema } from './nutrition.js';
import { SpoilageSchema } from './spoilage.js';

export const DrinkItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('drink'),
  drink: z.strictObject({
    /** Efekt jednego łyku / porcji. */
    perUse: NutritionSchema,
    uses: z.number().int().min(1).max(100),
    /** Czas jednego łyku (minuty gry). */
    drinkMin: GameMinutesSchema.default(0.5),
    spoilage: SpoilageSchema.optional(),
    /** Alkohol: 0..1 na porcję (moodle „Pijany”). */
    alcohol: z.number().min(0).max(1).default(0),
    /** Pusty pojemnik po wypiciu (można napełnić). */
    emptyInto: ItemRefSchema.optional(),
  }),
});

export type DrinkItem = z.infer<typeof DrinkItemSchema>;
