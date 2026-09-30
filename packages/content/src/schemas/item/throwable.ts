import { z } from 'zod';
import { ItemRefSchema, NoiseSchema, TilesSchema } from '../common/index.js';

/** Zachowanie przy rzucie: zasięg, obrażenia, hałas przy uderzeniu, czy się rozbija. */
export const ThrowableSchema = z.strictObject({
  rangeTiles: TilesSchema,
  damage: z.number().min(0).default(0),
  impactNoise: NoiseSchema,
  breaksOnImpact: z.boolean().default(false),
  /** Co zostaje po rozbiciu (np. potłuczone szkło). */
  brokenInto: ItemRefSchema.optional(),
});

export type Throwable = z.infer<typeof ThrowableSchema>;
