import { z } from 'zod';
import { frac, minutes, num, stat } from './num.js';

/** Rodzaje ran z dokumentu architektury Symulacji (złamania w późniejszym etapie). */
export const WOUND_TYPES = ['scratch', 'laceration', 'bite', 'deep'] as const;
export type WoundType = (typeof WOUND_TYPES)[number];

const wound = (
  bleeding: number,
  pain: number,
  healMin: number,
  clotsAfterMin: number,
  zombieInfectionChance: number,
) =>
  z
    .strictObject({
      /** Krwawienie świeżej rany (stat `bleeding` sumuje rany, 0–100). */
      bleeding: stat(bleeding),
      pain: stat(pain),
      /** Czas gojenia bez opatrunku, w minutach gry. */
      healMin: minutes(healMin),
      /** Samo przestaje krwawić po tym czasie; 0 = nigdy bez opatrunku. */
      clotsAfterMin: minutes(clotsAfterMin),
      /** Szansa zakażenia wirusem, gdy ranę zadał zombie. */
      zombieInfectionChance: frac(zombieInfectionChance),
    })
    .prefault({});

/** Rany: krwawienie, ból, gojenie, opatrunki i zakażenie brudem (osobne od wirusa). */
export const WoundSettingsSchema = z
  .strictObject({
    types: z
      .strictObject({
        scratch: wound(10, 10, 600, 20, 0.1),
        laceration: wound(30, 25, 2160, 180, 0.3),
        bite: wound(45, 40, 4320, 0, 0.9),
        deep: wound(60, 50, 5760, 0, 0),
      })
      .prefault({}),
    /** Utrata zdrowia na minutę gry za każdy punkt krwawienia. */
    healthLossPerBleedingPerMin: num(0.01, 1),
    bandage: z
      .strictObject({
        /** Czysty opatrunek mnoży krwawienie (0 = tamuje). */
        bleedingMul: frac(0),
        /** Po tym czasie opatrunek jest brudny. */
        dirtyAfterMin: minutes(480),
        dirtyBleedingMul: frac(0.25),
        /** Mnożnik tempa gojenia z opatrunkiem. */
        healMul: num(1.5, 10),
      })
      .prefault({}),
    /** Zakażenie brudem: szansa na minutę gry (odkażenie ją zeruje i leczy zakażenie). */
    dirtInfection: z
      .strictObject({
        unbandagedChancePerMin: frac(0.0005),
        dirtyBandageChancePerMin: frac(0.001),
        painAdd: stat(15),
        healMul: frac(0.5),
        healthLossPerMin: num(0.01, 10),
      })
      .prefault({}),
  })
  .prefault({});

export type WoundSettings = z.infer<typeof WoundSettingsSchema>;
