import { z } from 'zod';
import {
  FractionSchema,
  NoiseSchema,
  NumberRangeSchema,
  SkillRefSchema,
  TilesSchema,
} from '../common/index.js';
import { itemBaseShape } from './base.js';
import { DurabilitySchema } from './durability.js';

/** Kategorie broni białej z planu: improwizowana, krótka/długa ostra, tępa, długa (włócznie). */
export const MeleeCategorySchema = z.enum([
  'improvised',
  'blade_short',
  'blade_long',
  'blunt',
  'spear',
]);

export const MeleeStatsSchema = z.strictObject({
  category: MeleeCategorySchema,
  skill: SkillRefSchema,
  damage: NumberRangeSchema,
  rangeTiles: TilesSchema,
  /** Ataki na sekundę (czas rzeczywisty) przy poziomie 0. */
  attacksPerSec: z.number().positive().max(10),
  staminaCost: z.number().min(0),
  critChance: FractionSchema.default(0.05),
  knockback: z.number().min(0).default(0),
  /** Ile zombie trafia jeden zamach. */
  maxTargets: z.number().int().min(1).default(1),
  twoHanded: z.boolean().default(false),
  hitNoise: NoiseSchema.optional(),
  durability: DurabilitySchema,
});

export const WeaponMeleeItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('weapon_melee'),
  melee: MeleeStatsSchema,
});

export type MeleeCategory = z.infer<typeof MeleeCategorySchema>;
export type WeaponMeleeItem = z.infer<typeof WeaponMeleeItemSchema>;
