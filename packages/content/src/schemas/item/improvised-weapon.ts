import { z } from 'zod';
import { NumberRangeSchema, SkillRefSchema, TilesSchema } from '../common/index.js';

/** Rodzaj obrażeń improwizowanej broni: tępa (deska, garnek) albo ostra (piła, odłamek szkła). */
export const MeleeDamageTypeSchema = z.enum(['blunt', 'sharp']);

/**
 * Przedmiot, który nie jest bronią, a da się nim walczyć (jak w Project Zomboid). Te same jednostki co
 * `melee` broni z katalogu: `attackSpeed` = ataki na sekundę (czas rzeczywisty), `durability` = punkty
 * trwałości, `breakChancePct` = szansa 0–100 na utratę punktu trwałości przy trafieniu (0 punktów =
 * przedmiot się psuje). Bez bloku przedmiot dostaje słabe wartości domyślne z `meleeStatsFor`.
 */
export const ImprovisedWeaponSchema = z.strictObject({
  damage: NumberRangeSchema,
  rangeTiles: TilesSchema.max(3),
  attackSpeed: z.number().positive().max(10),
  durability: z.number().int().min(1).max(10000),
  breakChancePct: z.number().min(0).max(100),
  /** Umiejętność dostająca XP; domyślnie `base:blunt` (tępa) albo `base:blade-short` (ostra). */
  skill: SkillRefSchema.optional(),
  damageType: MeleeDamageTypeSchema.default('blunt'),
  twoHanded: z.boolean().default(false),
  /** Koszt staminy zamachu; domyślnie z wagi przedmiotu. */
  staminaCost: z.number().min(0).optional(),
});

export type MeleeDamageType = z.infer<typeof MeleeDamageTypeSchema>;
export type ImprovisedWeapon = z.infer<typeof ImprovisedWeaponSchema>;
