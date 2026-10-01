import { z } from 'zod';
import { FractionSchema, TilesSchema } from './common/index.js';

const spread = z.number().min(0).max(1);

/**
 * Broń palna — strojenie Symulacji (statystyki broni są w `ranged` przedmiotu). Trafienie:
 * szansa = `accuracy` × (1 − `hitFalloffAtRange` × odległość / `rangeTiles`) × (1 − kara
 * `attackPower` z ran); każda śrucina losuje osobno. `spread`: odchylenie kierunku strzału
 * (≈ radiany) wg kategorii.
 */
export const FirearmsSettingsSchema = z
  .strictObject({
    hitFalloffAtRange: FractionSchema.default(0.6),
    spread: z
      .strictObject({
        pistol: spread.default(0.03),
        revolver: spread.default(0.03),
        shotgun: spread.default(0.12),
        rifle: spread.default(0.015),
      })
      .prefault({}),
    /** Promień pocisku przy sprawdzaniu trafienia (dodawany do promienia zombie). */
    projectileRadiusTiles: TilesSchema.default(0.15),
    /** Ładowanie magazynka: sekundy na nabój. */
    magazineLoadSecPerRound: z.number().min(0).max(10).default(0.4),
  })
  .prefault({});

export type FirearmsSettings = z.infer<typeof FirearmsSettingsSchema>;
