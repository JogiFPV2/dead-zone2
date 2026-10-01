import { z } from 'zod';
import { FractionSchema } from './common/index.js';

/**
 * Hałas między piętrami budynku. Dźwięk z piętra z słychać też na z ± 1 (i dalej): efektywny
 * zasięg × `floorMul` za każde piętro różnicy (strop tłumi), najwyżej `maxFloors` pięter od
 * źródła. Ściany liczy się jak dotąd (× `wallMul` w Symulacji) na piętrze słuchacza.
 */
export const NoiseSettingsSchema = z
  .strictObject({
    /** Mnożnik zasięgu hałasu za każde piętro (strop) między źródłem a słuchaczem; 0 = nie przechodzi. */
    floorMul: FractionSchema.default(0.5),
    /** Najwięcej pięter różnicy, na których hałas jeszcze słychać (0 = tylko to samo piętro). */
    maxFloors: z.number().int().min(0).max(16).default(2),
  })
  .prefault({});

export type NoiseSettings = z.infer<typeof NoiseSettingsSchema>;
