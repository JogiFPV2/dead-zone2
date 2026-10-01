import { z } from 'zod';
import { TagSchema } from '../common/index.js';
import { minutes, num, stat } from './num.js';

/**
 * Jedna sesja wypoczynku (czytanie, TV, VHS): ile punktów zmęczenia odpoczywa i o ile spada
 * nuda i stres (dodatkowo do `literature.boredomReduction` / `stressReduction` przy czytaniu).
 */
const session = (fatigueRest: number, boredomReduction: number, stressReduction: number) =>
  z
    .strictObject({
      fatigueRest: stat(fatigueRest),
      boredomReduction: stat(boredomReduction),
      stressReduction: stat(stressReduction),
    })
    .prefault({});

/**
 * Wypoczynek (`worldSettings.survival.leisure`). Telewizor: obiekt mapy albo postawiony
 * przedmiot `placeable` z tagiem `tvTag` i `power` w promieniu `tvRadiusTiles`; potrzebuje prądu.
 */
export const LeisureSettingsSchema = z
  .strictObject({
    read: session(5, 10, 8),
    tv: z
      .strictObject({
        fatigueRest: stat(6),
        boredomReduction: stat(25),
        stressReduction: stat(12),
        /** Długość sesji TV bez kasety (minuty gry). */
        sessionMin: minutes(30),
      })
      .prefault({}),
    vhs: session(8, 30, 15),
    tvTag: TagSchema.default('base:station-tv'),
    tvRadiusTiles: num(1.5, 10),
  })
  .prefault({});

export type LeisureSettings = z.infer<typeof LeisureSettingsSchema>;
