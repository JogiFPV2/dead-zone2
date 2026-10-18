import { z } from 'zod';

/** Jakość wody w zbiorniku: `clean` = pitna, `tainted` = brudna (do zagotowania przed piciem). */
export const WaterQualitySchema = z.enum(['clean', 'tainted']);

/**
 * Zbiornik wody w meblu (np. spłuczka toalety, jak w Project Zomboid): skończony zapas `capacityL`
 * litrów o jakości `quality`. `refillFromMains` = dopełnia się, dopóki działa woda w sieci; po
 * odcięciu wody zostaje tylko to, co w zbiorniku. Logika poboru po stronie symulacji.
 */
export const WaterTankSchema = z.strictObject({
  capacityL: z.number().positive().finite(),
  quality: WaterQualitySchema,
  refillFromMains: z.boolean().default(true),
});

export type WaterQuality = z.infer<typeof WaterQualitySchema>;
export type WaterTank = z.infer<typeof WaterTankSchema>;
