import { z } from 'zod';
import { FractionSchema, TilesSchema } from './common/index.js';

const spread = z.number().min(0).max(1);

/**
 * Broń palna — strojenie Symulacji (statystyki broni są w `ranged` przedmiotu). Trafienie:
 * szansa = `accuracy` × (1 − `hitFalloffAtRange` × odległość / `rangeTiles`) × (1 − kara
 * `attackPower` z ran) × (1 + `accuracyPerSkillLevel` × poziom celowania); każda śrucina losuje osobno. `spread`: odchylenie kierunku strzału
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
    /**
     * Efektywny rozrzut = `spread[kategoria]` × min(`max`, 1 + `moving` × ruch + `running` × bieg
     * + `exhaustion` × (1 − wytrzymałość/100) + `fatigue` × zmęczenie/100 + `panic` × panika/100).
     * Ruch = prędkość / prędkość chodu (0..1), bieg = to samo przy chodzie `run` (dokłada się do
     * ruchu). Ten sam rozrzut idzie do strzału i do widoku `combat.spread`.
     */
    spreadModifiers: z
      .strictObject({
        moving: z.number().min(0).max(10).default(0.8),
        running: z.number().min(0).max(10).default(1),
        exhaustion: z.number().min(0).max(10).default(0.6),
        fatigue: z.number().min(0).max(10).default(0.4),
        panic: z.number().min(0).max(10).default(0.6),
        max: z.number().min(1).max(20).default(4),
      })
      .prefault({}),
    /** Promień pocisku przy sprawdzaniu trafienia (dodawany do promienia zombie). */
    projectileRadiusTiles: TilesSchema.default(0.15),
    /** Ładowanie magazynka: sekundy na nabój. */
    magazineLoadSecPerRound: z.number().min(0).max(10).default(0.4),
    /** Celność × (1 + to × poziom umiejętności `ranged.skill`). */
    accuracyPerSkillLevel: z.number().min(0).max(1).default(0.04),
    /** Czas przeładowania × max(0,5; 1 − to × poziom `base:reloading`). */
    reloadTimeReductionPerLevel: FractionSchema.default(0.04),
    /** XP do `ranged.skill` za trafienie (śrucina liczy się raz na strzał). */
    xpPerHit: z.number().min(0).max(100).default(2),
    /** XP do `base:reloading` za skończone przeładowanie. */
    xpPerReload: z.number().min(0).max(100).default(1),
  })
  .prefault({});

export type FirearmsSettings = z.infer<typeof FirearmsSettingsSchema>;
