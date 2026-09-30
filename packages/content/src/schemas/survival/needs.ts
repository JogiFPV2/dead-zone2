import { z } from 'zod';
import { mul, num } from './num.js';

/**
 * Bazowe tempo potrzeb postaci w bezruchu (punkty 0–100 na minutę gry). Przy
 * `dayLengthMinutes = 60` minuta gry to 2,5 s rzeczywiste (50 ticków po 50 ms).
 * Cechy i moodle mnożą je statystykami `hunger-rate`, `thirst-rate`, `fatigue-rate`.
 */
export const NeedsSchema = z
  .strictObject({
    hungerPerMin: num(0.0175, 10),
    thirstPerMin: num(0.035, 10),
    /** Zmęczenie na jawie (sen je zmniejsza, patrz `sleep`). */
    fatiguePerMin: num(0.047, 10),
  })
  .prefault({});

/** Mnożniki potrzeb dla jednej aktywności; wytrzymałość to zmiana w punktach na minutę gry. */
const activity = (hunger: number, thirst: number, fatigue: number, endurancePerMin: number) =>
  z
    .strictObject({
      hunger: mul(hunger),
      thirst: mul(thirst),
      fatigue: mul(fatigue),
      /** > 0 regeneracja, < 0 zużycie (stat `endurance-regen` mnoży tylko regenerację). */
      endurancePerMin: z.number().min(-100).max(100).default(endurancePerMin),
    })
    .prefault({});

/**
 * Aktywność mnoży potrzeby i spalanie kalorii (`nutrition.dailyBurnKcal × hunger`).
 * Zamachy bronią dodatkowo kosztują `melee.staminaCost` wytrzymałości za cios.
 */
export const ActivitySchema = z
  .strictObject({
    idle: activity(1, 1, 1, 2.5),
    walking: activity(1.25, 1.3, 1.2, 1.5),
    sneaking: activity(1.2, 1.2, 1.3, 1),
    running: activity(1.8, 2.2, 2, -2),
    sprinting: activity(2.6, 3.2, 3, -6),
    fighting: activity(2.2, 2.6, 2.6, 0),
    sleeping: activity(0.5, 0.6, 0, 4),
  })
  .prefault({});

export type Needs = z.infer<typeof NeedsSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityKind = keyof Activity;
