import { z } from 'zod';
import { TilesSchema } from './units.js';

/** Hałas przyciągający zombie: zasięg w kaflach i głośność 0..1. */
export const NoiseSchema = z.strictObject({
  radiusTiles: TilesSchema,
  volume: z.number().min(0).max(1).default(1),
});

export type Noise = z.infer<typeof NoiseSchema>;
