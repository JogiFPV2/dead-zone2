import { z } from 'zod';
import { GameMinutesSchema, ItemRefSchema, TagSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';
import { NutritionSchema } from './nutrition.js';
import { SpoilageSchema } from './spoilage.js';

export const FoodItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('food'),
  food: z.strictObject({
    nutrition: NutritionSchema,
    /** Brak = nie psuje się (konserwy przed otwarciem). */
    spoilage: SpoilageSchema.optional(),
    /** Na ile porcji dzieli się przedmiot. */
    portions: z.number().int().min(1).default(1),
    /** Czas zjedzenia jednej porcji (minuty gry). */
    eatMin: GameMinutesSchema.default(1),
    /** Tag narzędzia potrzebnego do otwarcia (np. otwieracz). */
    openWith: TagSchema.optional(),
    /** Co powstaje po otwarciu (otwarta konserwa psuje się). */
    openedInto: ItemRefSchema.optional(),
    cooking: z
      .strictObject({ durationMin: GameMinutesSchema, cookedInto: ItemRefSchema })
      .optional(),
    /** Pusty pojemnik po zjedzeniu. */
    emptyInto: ItemRefSchema.optional(),
  }),
});

export type FoodItem = z.infer<typeof FoodItemSchema>;
