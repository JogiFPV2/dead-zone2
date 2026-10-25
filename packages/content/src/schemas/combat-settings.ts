import { z } from 'zod';

/** Domyślna szansa trafienia ciosu zombie (0–1). */
export const DEFAULT_ZOMBIE_HIT_CHANCE = 0.7;
/** Domyślny zasięg ciosu zombie w gracza w aucie (m, od krawędzi ciała do karoserii). */
export const DEFAULT_ZOMBIE_CAR_REACH_M = 0.9;

/** Walka zombie (`worldSettings.combat.zombie`). Schemat nie wstawia domyślnych. */
export const ZombieCombatSettingsSchema = z.strictObject({
  hitChance: z.number().min(0).max(1).optional(),
  carReachM: z.number().positive().optional(),
});

/** Walka (`worldSettings.combat`); brak pola = sim bierze `DEFAULT_*`. */
export const CombatSettingsSchema = z.strictObject({
  zombie: ZombieCombatSettingsSchema.optional(),
});

export type CombatSettings = z.infer<typeof CombatSettingsSchema>;
