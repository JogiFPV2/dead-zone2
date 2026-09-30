import { z } from 'zod';
import { FractionSchema, TilesSchema } from '../common/index.js';

/** Światło obiektu świata (lampa, latarnia). Obiekt mapy jest światłem, gdy jego definicja ma ten blok. */
export const LightSchema = z.strictObject({
  radiusTiles: TilesSchema,
  intensity: FractionSchema.default(1),
  /** Kolor `#rrggbb`. */
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/, 'kolor w postaci #rrggbb (małe litery)')
    .default('#ffffff'),
  /** Świeci tylko przy zasilaniu (elektryczność później). */
  requiresPower: z.boolean().default(true),
});

export type Light = z.infer<typeof LightSchema>;
