import { z } from 'zod';
import { NoiseSchema, TagSchema, TilesSchema } from '../common/index.js';

/** Odbiornik prądu (telewizor): działa, gdy w zasięgu jest włączone źródło z mocą ≥ `consumesW`. */
export const PowerConsumerSchema = z.strictObject({
  consumesW: z.number().positive().max(100000),
});

/**
 * Źródło prądu (generator): zasila odbiorniki w promieniu `radiusTiles` do sumy `outputW`.
 * Paliwo: przedmioty z tagiem `fuelTag`, każdy daje `litersPerFuelItem` l do zbiornika
 * `tankLiters`, spalanie `litersPerHour` na godzinę gry. Pracujący generator hałasuje (`noise`).
 */
export const PowerSourceSchema = z.strictObject({
  outputW: z.number().positive().max(100000),
  radiusTiles: TilesSchema,
  fuelTag: TagSchema,
  litersPerFuelItem: z.number().positive().max(100),
  tankLiters: z.number().positive().max(1000),
  litersPerHour: z.number().positive().max(100),
  noise: NoiseSchema,
});

export type PowerConsumer = z.infer<typeof PowerConsumerSchema>;
export type PowerSource = z.infer<typeof PowerSourceSchema>;
