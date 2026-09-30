import { z } from 'zod';
import { ContentIdSchema } from './id.js';

/**
 * Statystyki postaci znane silnikowi. Wartości „stanu” są w skali 0–100,
 * pozostałe opisane nazwą (`-kg`, `-tiles`, mnożniki bez jednostki).
 */
export const CORE_STATS = [
  // stan 0–100
  'health',
  'hunger',
  'thirst',
  'fatigue',
  'endurance',
  'pain',
  'stress',
  'panic',
  'boredom',
  'unhappiness',
  'sickness',
  'infection',
  'wetness',
  'drunkenness',
  'bleeding',
  'injury',
  'comfort',
  'satiety',
  // wartości fizyczne
  'body-temperature-c',
  'body-weight-kg',
  'carry-capacity-kg',
  'carry-load',
  // tempo i mnożniki
  'hunger-rate',
  'thirst-rate',
  'fatigue-rate',
  'endurance-regen',
  'healing-rate',
  'move-speed',
  'sprint-speed',
  'sight-range-tiles',
  'hearing-range-tiles',
  'footstep-noise',
  'search-speed',
  'reading-speed',
  'crafting-speed',
  'melee-damage',
  'aim-accuracy',
  'scratch-resistance',
  'bite-resistance',
  'infection-resistance',
  'panic-resistance',
  'xp-gain',
  /** Mnożnik szansy zatrucia jedzeniem (cechy żołądka). */
  'food-sickness-chance',
  /** Mnożnik zużycia broni i narzędzi. */
  'weapon-wear',
  // liczniki przebiegu gry (do `gainedWhen`/`lostWhen` cech)
  'zombies-killed',
] as const;

export const CoreStatSchema = z.enum(CORE_STATS);

/** Statystyka: z listy silnika albo własna modów w postaci id (`my-mod:sanity`). */
export const StatIdSchema = z.union([CoreStatSchema, ContentIdSchema]);

export type CoreStat = z.infer<typeof CoreStatSchema>;
export type StatId = z.infer<typeof StatIdSchema>;
