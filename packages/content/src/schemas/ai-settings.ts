import { z } from 'zod';
import { RealSecondsSchema, TilesSchema } from './common/index.js';

/**
 * Zachowanie zombie (`worldSettings.ai`). Gubienie tropu: goniący zombie traci gracza dopiero,
 * gdy przez `lostTrackSec` go nie widzi i nie słyszy, a gracz jest dalej niż `lostTrackDistM`
 * (1 kafel = 1 m). Wtedy idzie do ostatniego znanego miejsca, rozgląda się i wraca do błąkania.
 */
export const AiSettingsSchema = z
  .strictObject({
    /** Sekundy (czas rzeczywisty przy ×1) bez wzroku i słuchu gracza, po których trop się urywa. */
    lostTrackSec: RealSecondsSchema.default(10),
    /** Bliżej niż tyle metrów (kafli) zombie nie gubi tropu, nawet gdy gracza nie widzi ani nie słyszy. */
    lostTrackDistM: TilesSchema.default(25),
  })
  .prefault({});

export type AiSettings = z.infer<typeof AiSettingsSchema>;
