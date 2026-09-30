import { z } from 'zod';
import { frac, mul, num, stat } from './num.js';

/**
 * Panika rośnie od widocznych zombie w promieniu (bliskie liczą się mocniej), spada, gdy żadnego
 * nie widać. Stat `panic-resistance` i doświadczenie (przeżyte dni) zmniejszają przyrost.
 */
export const PanicSettingsSchema = z
  .strictObject({
    radiusTiles: num(14, 200),
    gainPerZombiePerMin: num(3.5, 100),
    closeRadiusTiles: num(4, 200),
    closeMultiplier: mul(2),
    maxGainPerMin: num(20, 100),
    decayPerMin: num(2.5, 100),
    /** Ułamek przyrostu odejmowany za każdy przeżyty dzień, najwyżej `maxExperienceReduction`. */
    experienceReductionPerDay: frac(0.03),
    maxExperienceReduction: frac(0.5),
  })
  .prefault({});

/** Stres: z paniki, bólu i głodu/pragnienia; opada powoli, gdy nic go nie podsyca. */
export const StressSettingsSchema = z
  .strictObject({
    /** Za każdy punkt paniki na minutę gry. */
    fromPanicPerMin: num(0.006, 1),
    /** Za każdy punkt bólu na minutę gry. */
    fromPainPerMin: num(0.004, 1),
    /** Gdy głód lub pragnienie ≥ `needsThreshold`. */
    fromNeedsPerMin: num(0.01, 10),
    needsThreshold: stat(50),
    decayPerMin: num(0.04, 10),
  })
  .prefault({});

/** Nuda rośnie w bezczynności, spada przy aktywności i czytaniu (`literature.boredomReduction`). */
export const BoredomSettingsSchema = z
  .strictObject({
    idleGainPerMin: num(0.05, 10),
    /** Mnożnik przyrostu na zewnątrz (więcej bodźców). */
    outdoorsMul: mul(0.5),
    activeDecayPerMin: num(0.03, 10),
  })
  .prefault({});

/** Niezadowolenie: z długiej nudy i stresu, opada samo bardzo powoli. */
export const UnhappinessSettingsSchema = z
  .strictObject({
    fromBoredomAbove: stat(55),
    boredomGainPerMin: num(0.02, 10),
    fromStressAbove: stat(50),
    stressGainPerMin: num(0.01, 10),
    decayPerMin: num(0.004, 10),
  })
  .prefault({});

export type PanicSettings = z.infer<typeof PanicSettingsSchema>;
export type StressSettings = z.infer<typeof StressSettingsSchema>;
export type BoredomSettings = z.infer<typeof BoredomSettingsSchema>;
export type UnhappinessSettings = z.infer<typeof UnhappinessSettingsSchema>;
