import { z } from 'zod';
import { TagSchema } from '../common/index.js';
import { minutes, num, stat } from './num.js';

/** Jedno mycie: czas (minuty gry), o ile spada brud, smutek i stres. */
const wash = (durationMin: number, dirt: number, unhappiness: number, stress: number) =>
  z
    .strictObject({
      durationMin: minutes(durationMin),
      dirt: stat(dirt),
      unhappiness: stat(unhappiness),
      stress: stat(stress),
    })
    .prefault({});

/**
 * Higiena i woda z sieci (`worldSettings.survival.hygiene`, docs 9.54). Brud 0–100 rośnie o
 * `dirtPerHour` (0 = wyłączone; baza ustawia własną wartość). Od `unhappyFromDirt` brud dokłada
 * smutku, liniowo do `unhappinessPerHourAtMax` przy 100. Mycie przy obiekcie z tagiem w zasięgu
 * `reachTiles`, tylko gdy jest woda w sieci (`no-water`): umywalka / zlew (`tapTag`): `wash` i
 * picie z kranu; prysznic (`showerTag`); wanna (`bathTag`).
 */
export const HygieneSettingsSchema = z
  .strictObject({
    dirtPerHour: num(0, 100),
    unhappyFromDirt: stat(50),
    unhappinessPerHourAtMax: num(3, 100),
    reachTiles: num(1.5, 10),
    tapTag: TagSchema.default('base:water-tap'),
    showerTag: TagSchema.default('base:shower'),
    bathTag: TagSchema.default('base:bath'),
    wash: wash(5, 30, 0, 0),
    shower: wash(10, 100, 5, 5),
    bath: wash(30, 100, 15, 15),
    /** Picie z kranu: czas łyku i o ile spada pragnienie. */
    drinkTap: z.strictObject({ durationMin: minutes(1), thirst: stat(30) }).prefault({}),
  })
  .prefault({});

export type HygieneSettings = z.infer<typeof HygieneSettingsSchema>;
