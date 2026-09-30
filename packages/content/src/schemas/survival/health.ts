import { z } from 'zod';
import { celsius, minuteRange, num, stat } from './num.js';

/** Obrażenia z niezaspokojonej potrzeby od progu statystyki. */
const deprivation = (fromStat: number, healthLossPerMin: number) =>
  z
    .strictObject({ fromStat: stat(fromStat), healthLossPerMin: num(healthLossPerMin, 100) })
    .prefault({});

/** Zdrowie ogólne (0–100): naturalna regeneracja i obrażenia z głodu i odwodnienia. */
export const HealthSettingsSchema = z
  .strictObject({
    regenPerMin: num(0.02, 10),
    /** Regeneracja stoi, gdy głód lub pragnienie przekroczą te progi. */
    regenMaxHunger: stat(50),
    regenMaxThirst: stat(50),
    starvation: deprivation(90, 0.035),
    dehydration: deprivation(90, 0.07),
  })
  .prefault({});

/**
 * Wirus zombie (nieuleczalny): po inkubacji objawy (gorączka, moodle „Chory”), potem śmierć
 * i przemiana. Stat `infection` rośnie liniowo 0 → 100 od zakażenia do śmierci.
 */
export const InfectionSettingsSchema = z
  .strictObject({
    incubationMin: minuteRange(360, 900),
    deathAfterMin: minuteRange(2160, 4320),
    /** Gorączka: ile °C dodaje przy `infection` = 100. */
    feverMaxC: celsius(2.5),
    /** Stat `sickness` = `infection` × ten mnożnik po inkubacji. */
    sicknessMul: num(1, 10),
  })
  .prefault({});

export type HealthSettings = z.infer<typeof HealthSettingsSchema>;
export type InfectionSettings = z.infer<typeof InfectionSettingsSchema>;
