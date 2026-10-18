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
    /**
     * Odpoczynek (`rest`, siedząc): sesja `sessionMin`, tylko przy zmęczeniu ≥ `minFatigue`.
     * Na podłodze `fatigueRest` × `floorMul`; na siedzisku / kanapie / łóżku w pełni.
     */
    rest: z
      .strictObject({
        fatigueRest: stat(6),
        boredomReduction: stat(0),
        stressReduction: stat(4),
        sessionMin: minutes(30),
        minFatigue: stat(10),
        floorMul: z.number().min(0).max(1).default(0.5),
      })
      .prefault({}),
    /** Nauka (książki umiejętności i przepisów, VHS z XP, radio): tylko gdy zmęczenie < `maxFatigue`. */
    learning: z.strictObject({ maxFatigue: stat(60) }).prefault({}),
    /** Radio (`listenRadio`, stacja z tagiem `radioTag`; z `power` potrzebuje prądu). */
    radio: z
      .strictObject({
        fatigueRest: stat(3),
        boredomReduction: stat(15),
        stressReduction: stat(10),
        sessionMin: minutes(30),
      })
      .prefault({}),
    radioTag: TagSchema.default('base:station-radio'),
    /** Kasety VHS wymagają magnetowidu (`vcrTag`) obok telewizora, gdy `requireVcr`. */
    vcrTag: TagSchema.default('base:station-vcr'),
    requireVcr: z.boolean().default(true),
    tvTag: TagSchema.default('base:station-tv'),
    tvRadiusTiles: num(1.5, 10),
  })
  .prefault({});

export type LeisureSettings = z.infer<typeof LeisureSettingsSchema>;
