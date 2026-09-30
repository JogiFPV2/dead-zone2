import { z } from 'zod';

/** Wpływ spożycia na statystyki. Ujemny `hunger` = zaspokaja głód. Wartości w punktach statystyk 0..100. */
export const NutritionSchema = z.strictObject({
  calories: z.number().min(0).default(0),
  hunger: z.number().min(-100).max(100).default(0),
  thirst: z.number().min(-100).max(100).default(0),
  boredom: z.number().min(-100).max(100).default(0),
  unhappiness: z.number().min(-100).max(100).default(0),
  stress: z.number().min(-100).max(100).default(0),
  /** Szansa zatrucia / choroby 0..1 (np. surowe mięso, brudna woda). */
  sicknessChance: z.number().min(0).max(1).default(0),
});

export type Nutrition = z.infer<typeof NutritionSchema>;
