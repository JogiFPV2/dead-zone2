import { z } from 'zod';

/**
 * Chód, bieg i skradanie postaci gracza. 1,5 m/s chodu: mapa 8192 m to ok. 91 min marszu,
 * bieg × 2,5 = 3,75 m/s (ok. 36 min), skradanie × 0,5. Prędkości zombie są w typach zombie
 * (wartości bezwzględne w m/s), nie zależą od tych mnożników.
 */
export const MovementSettingsSchema = z
  .strictObject({
    /** Prędkość chodu w m/s (1 kafel = 1 m). */
    walkSpeedMps: z.number().positive().max(10).default(1.5),
    /** Bieg: × prędkość chodu. */
    runSpeedMul: z.number().min(1).max(5).default(2.5),
    /** Skradanie: × prędkość chodu. */
    sneakSpeedMul: z.number().positive().max(1).default(0.5),
  })
  .prefault({});

export type MovementSettings = z.infer<typeof MovementSettingsSchema>;
