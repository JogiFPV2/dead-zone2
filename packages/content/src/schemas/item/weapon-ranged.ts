import { z } from 'zod';
import {
  FractionSchema,
  ItemRefSchema,
  NoiseSchema,
  NumberRangeSchema,
  RealSecondsSchema,
  SkillRefSchema,
  TilesSchema,
} from '../common/index.js';
import { itemBaseShape } from './base.js';
import { DurabilitySchema } from './durability.js';

export const RangedCategorySchema = z.enum(['pistol', 'revolver', 'shotgun', 'rifle']);

/** Zasilanie: wewnętrzny magazynek/bęben albo wymienny magazynek (osobny przedmiot `magazine`). */
export const FeedSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('internal'), capacity: z.number().int().min(1).max(100) }),
  z.strictObject({ type: z.literal('magazine'), magazine: ItemRefSchema }),
]);

export const RangedStatsSchema = z.strictObject({
  category: RangedCategorySchema,
  skill: SkillRefSchema,
  ammo: ItemRefSchema,
  feed: FeedSchema,
  damage: NumberRangeSchema,
  rangeTiles: TilesSchema,
  /** Celność bazowa 0..1 (rośnie z umiejętnością). */
  accuracy: FractionSchema,
  /** Strzały na sekundę (czas rzeczywisty). */
  shotsPerSec: z.number().positive().max(20),
  /** Śruciny na strzał (strzelba > 1). */
  projectiles: z.number().int().min(1).default(1),
  reloadSec: RealSecondsSchema,
  /**
   * Ładowanie po jednym naboju (tylko `feed.type = internal`, np. pompka): sekundy na nabój,
   * każdy nabój to osobny krok (przerywa go strzał). Brak = całość naraz po `reloadSec`.
   * Usuwanie zacięcia zawsze trwa `reloadSec`.
   */
  loadSecPerRound: RealSecondsSchema.optional(),
  jamChance: FractionSchema.default(0),
  shotNoise: NoiseSchema,
  twoHanded: z.boolean().default(false),
  durability: DurabilitySchema,
});

export const WeaponRangedItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('weapon_ranged'),
  ranged: RangedStatsSchema,
});

export type RangedCategory = z.infer<typeof RangedCategorySchema>;
export type WeaponRangedItem = z.infer<typeof WeaponRangedItemSchema>;
