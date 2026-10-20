import { z } from 'zod';

/** Domyślny zasięg ciosu zombie w metrach, liczony od krawędzi ciał. */
export const DEFAULT_ZOMBIE_ATTACK_REACH_M = 0.3;
export const MAX_ZOMBIE_ATTACK_REACH_M = 1.5;

/** Domyślny czas zamachu przed ciosem (ms, losowany z zakresu). */
export const DEFAULT_ZOMBIE_WINDUP_MS = Object.freeze({ min: 500, max: 800 });

/** Zasięg ciosu (m), odstęp między krawędziami ciał zombie i celu. */
export const ZombieAttackReachSchema = z.number().positive().max(MAX_ZOMBIE_ATTACK_REACH_M);

/** Zakres czasu zamachu w ms (liczby całkowite > 0, min ≤ max). */
export const ZombieWindupMsSchema = z
  .strictObject({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  })
  .refine((r) => r.min <= r.max, { message: 'windupMs.min musi być ≤ windupMs.max' });

export type ZombieWindupMs = z.infer<typeof ZombieWindupMsSchema>;
