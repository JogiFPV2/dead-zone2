import { z } from 'zod';
import {
  NoiseSchema,
  NumberRangeSchema,
  RealSecondsSchema,
  TagSchema,
  TilesSchema,
} from '../common/index.js';
import { itemBaseShape } from './base.js';

/** Jak wabik się uruchamia: pilotem z tagiem `remoteTag` w zasięgu albo zegarem ustawianym przez gracza. */
export const LureTriggerSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('remote'), remoteTag: TagSchema, rangeTiles: TilesSchema }),
  z.strictObject({ type: z.literal('timer'), delaySec: NumberRangeSchema }),
]);

/** Biegający wabik: po uruchomieniu biegnie w kierunku wybranym przez gracza. */
export const LureRunnerSchema = z.strictObject({
  distanceTiles: TilesSchema,
  speedTilesPerSec: z.number().positive().max(20).default(3),
  direction: z.enum(['player-set']).default('player-set'),
});

/**
 * Wabik: hałas przyciągający zombie. Czas w sekundach rzeczywistych (jak tempo walki).
 * `lingerSec`: jak długo zombie kręcą się w miejscu hałasu, zanim się rozejdą.
 */
export const LureItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('lure'),
  lure: z.strictObject({
    noise: NoiseSchema,
    durationSec: RealSecondsSchema,
    trigger: LureTriggerSchema,
    lingerSec: NumberRangeSchema,
    /** Zasilanie: tag baterii i ile uruchomień daje jedna bateria. */
    power: z
      .strictObject({ batteryTag: TagSchema, activationsPerBattery: z.number().int().min(1) })
      .optional(),
    runner: LureRunnerSchema.optional(),
    /** Stawiany na ziemi (elektroniczny) albo zużywany przy użyciu (biegający). */
    placeable: z.boolean().default(true),
    consumedOnUse: z.boolean().default(false),
  }),
});

export type LureTrigger = z.infer<typeof LureTriggerSchema>;
export type LureItem = z.infer<typeof LureItemSchema>;
