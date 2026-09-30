import { z } from 'zod';
import { FractionSchema, GameMinutesSchema, TagSchema, TilesSchema } from '../common/index.js';

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

/**
 * Światło noszone w ręce (latarka, lampa kempingowa): stożek `coneDeg` (360 = dookoła),
 * bateria z tagiem `batteryTag` wystarcza na `batteryLifeMin` minut gry świecenia.
 */
export const HeldLightSchema = z.strictObject({
  radiusTiles: TilesSchema,
  intensity: FractionSchema.default(1),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/, 'kolor w postaci #rrggbb (małe litery)')
    .default('#ffffff'),
  coneDeg: z.number().min(10).max(360).default(360),
  batteryTag: TagSchema.optional(),
  batteryLifeMin: GameMinutesSchema.optional(),
});

export type HeldLight = z.infer<typeof HeldLightSchema>;
