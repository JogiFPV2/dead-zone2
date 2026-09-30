import { z } from 'zod';
import { frac, mul, num } from './num.js';

/** Wpływ jednego makroskładnika zjedzonego w ciągu ostatniej doby gry. */
const macro = (dailyTargetG: number, metMul: number, lowMul: number) =>
  z
    .strictObject({
      /** Dzienny cel w gramach; „niski” = poniżej `lowFraction` celu. */
      dailyTargetG: num(dailyTargetG, 2000),
      /** Mnożnik efektu, gdy cel jest spełniony. */
      metMul: mul(metMul),
      /** Mnożnik efektu przy niedoborze. */
      lowMul: mul(lowMul),
    })
    .prefault({});

/**
 * Kalorie, waga ciała i makroskładniki. Spalanie na minutę =
 * `dailyBurnKcal / 1440 × activity.<aktywność>.hunger`; bilans zmienia `body-weight-kg`.
 */
export const NutritionSettingsSchema = z
  .strictObject({
    dailyBurnKcal: num(2200),
    /** Nadwyżka lub deficyt, który zmienia wagę o 1 kg. */
    kcalPerKg: num(7700, 100000),
    startBodyWeightKg: num(80, 300),
    /** Progi pod cechy dynamiczne (niedowaga, nadwaga) i obrażenia z wycieńczenia. */
    underweightKg: num(65, 300),
    overweightKg: num(95, 300),
    emaciatedKg: num(50, 300),
    /** Sytość (moodle „Najedzony”): jedzenie przy głodzie 0 dodaje ją zamiast odejmować głód. */
    satiety: z
      .strictObject({
        perKcalWhenFull: num(0.05, 10),
        decayPerMin: num(0.035, 10),
        /** Mnożnik tempa głodu, gdy sytość > 0. */
        hungerRateMul: mul(0.75),
      })
      .prefault({}),
    macros: z
      .strictObject({
        lowFraction: frac(0.3),
        /** Białko: mnoży tempo gojenia ran i regenerację zdrowia. */
        protein: macro(70, 1.2, 0.8),
        /** Węglowodany: mnożą regenerację wytrzymałości. */
        carbs: macro(250, 1.15, 0.85),
        /** Tłuszcz: mnoży dodawaną sytość (dłużej syci). */
        fat: macro(70, 1.25, 0.9),
      })
      .prefault({}),
  })
  .prefault({});

export type NutritionSettings = z.infer<typeof NutritionSettingsSchema>;
