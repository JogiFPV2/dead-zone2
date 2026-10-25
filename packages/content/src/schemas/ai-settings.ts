import { z } from 'zod';
import { AiStopGapSchema } from './ai-stop-gap.js';
import { RealSecondsSchema, TilesSchema } from './common/index.js';

/**
 * Zachowanie zombie (`worldSettings.ai`). Gubienie tropu: goniący zombie traci gracza, gdy przez
 * `lostTrackSec` (± `lostTrackSpread`) go nie widzi i nie słyszy, a gracz jest dalej niż
 * `lostTrackDistM` (1 kafel = 1 m). Gdy gracz zniknie za rogiem, w budynku (brak linii wzroku)
 * albo w gęstych krzakach (strefa `bushes` / `cover`), czas × `lostTrackCoverMul`. Potem zombie
 * idzie do ostatniego znanego miejsca, rozgląda się `searchSec` i wraca do błąkania.
 */
export const AiSettingsSchema = z
  .strictObject({
    /** Sekundy (czas rzeczywisty przy ×1) bez wzroku i słuchu gracza, po których trop się urywa. */
    lostTrackSec: RealSecondsSchema.default(12),
    /** Rozrzut `lostTrackSec` (±ułamek, losowany przy każdym odświeżeniu tropu). */
    lostTrackSpread: z.number().min(0).max(0.9).default(0.2),
    /** Bliżej niż tyle metrów (kafli) zombie nie gubi tropu (czuje gracza tuż obok). */
    lostTrackDistM: TilesSchema.default(3),
    /** Mnożnik czasu gubienia, gdy gracz jest poza linią wzroku albo w krzakach. */
    lostTrackCoverMul: z.number().min(0).max(1).default(0.6),
    /** Ile sekund zombie rozgląda się w ostatnim znanym miejscu (losowo z przedziału). */
    searchSec: z
      .strictObject({ min: RealSecondsSchema, max: RealSecondsSchema })
      .refine((r) => r.min <= r.max, { message: 'searchSec.min > max' })
      .default({ min: 2, max: 5 }),
    /** Odstęp zatrzymania przed celem (m); brak = `DEFAULT_AI_STOP_GAP_M`. */
    stopGapM: AiStopGapSchema.optional(),
  })
  .prefault({});

export type AiSettings = z.infer<typeof AiSettingsSchema>;
