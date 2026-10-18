import { z } from 'zod';
import { FractionSchema, TilesSchema } from './common/index.js';

const LURE_DEFAULTS = {
  enabled: true,
  maxSky: 0.3,
  radiusTiles: 25,
  volume: 0.3,
  lingerSec: 20,
};

/**
 * Zapalone światło w oknie w nocy wabi zombie (docs 9.53). Gdy niebo ≤ `maxSky` (noc, zmierzch),
 * każde okno pokoju z zapalonym włącznikiem (lampy z prądem, zasłony odsłonięte, okno nie w pełni
 * zabite deskami) daje co cykl myślenia zombie „bodziec” jak hałas: promień `radiusTiles`, siła
 * `volume`, zombie zostaje przy oknie `lingerSec` s. Nie budzi śpiących.
 */
const LureSchema = z
  .strictObject({
    enabled: z.boolean().default(LURE_DEFAULTS.enabled),
    maxSky: FractionSchema.default(LURE_DEFAULTS.maxSky),
    radiusTiles: TilesSchema.default(LURE_DEFAULTS.radiusTiles),
    volume: FractionSchema.default(LURE_DEFAULTS.volume),
    lingerSec: z.number().min(0).max(600).default(LURE_DEFAULTS.lingerSec),
  })
  .default(LURE_DEFAULTS);

/**
 * Oświetlenie pokoi (Symulacja, docs 9.53): włącznik (obiekt z tagiem `switchTag`) steruje
 * lampami `placeable.light` z `requiresPower` w tym samym pokoju (ten sam `room` i budynek na tym
 * piętrze); domyślnie zgaszone. Lampy w pokojach bez włącznika świecą przy prądzie jak dotąd.
 * Zasłony: każde okno pokoju (menu okna).
 */
export const LightingSettingsSchema = z
  .strictObject({
    switchTag: z.string().min(1).default('base:light-switch'),
    lure: LureSchema,
  })
  .prefault({});

export type LightingSettings = z.infer<typeof LightingSettingsSchema>;
