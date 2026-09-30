import { z } from 'zod';
import { FractionSchema, IntRangeSchema, TilesSchema } from '../common/index.js';
import { LocalNameSchema } from './objective.js';

/** Horda ustawiona na starcie wokół strefy (np. pilnująca willi). */
export const HordePlacementSchema = z
  .strictObject({
    zone: LocalNameSchema,
    count: IntRangeSchema,
    /** Pierścień wokół środka strefy, w kaflach. */
    minRadiusTiles: TilesSchema.default(0),
    maxRadiusTiles: TilesSchema,
    /** `guard` = wraca na miejsce po wywabieniu, `wander` = rozchodzi się. */
    behavior: z.enum(['guard', 'wander']).default('guard'),
    /** Po ilu sekundach bez bodźca horda `guard` wraca do strefy. */
    returnAfterSec: z.number().min(0).max(3600).optional(),
  })
  .refine((h) => h.minRadiusTiles <= h.maxRadiusTiles, {
    message: 'minRadiusTiles musi być ≤ maxRadiusTiles',
    path: ['maxRadiusTiles'],
  });

export const ZombiePresetSchema = z.strictObject({
  /** Mnożnik gęstości zombie z mapy (1 = domyślnie). */
  populationMultiplier: z.number().min(0).max(10).default(1),
  /** Twardy limit aktywnych zombie w świecie w tym trybie. */
  maxActive: z.number().int().min(0).max(5000),
  hordes: z.array(HordePlacementSchema).default([]),
  respawn: z
    .strictObject({
      enabled: z.boolean(),
      /** Część początkowej populacji odradzana na dobę gry (0..1). */
      perDay: FractionSchema.default(0),
      /** Nie odradzaj bliżej gracza niż tyle kafli. */
      minDistanceTiles: TilesSchema.default(60),
    })
    .default({ enabled: false, perDay: 0, minDistanceTiles: 60 }),
});

export const WorldPresetSchema = z.strictObject({
  /** Start: dzień gry (od 1) i godzina 0–23. */
  start: z.strictObject({
    day: z.number().int().min(1).default(1),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59).default(0),
  }),
  zombies: ZombiePresetSchema,
});

export type HordePlacement = z.infer<typeof HordePlacementSchema>;
export type WorldPreset = z.infer<typeof WorldPresetSchema>;
