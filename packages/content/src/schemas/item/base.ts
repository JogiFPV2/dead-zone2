import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  TagListSchema,
  WeightKgSchema,
} from '../common/index.js';
import { ImprovisedWeaponSchema } from './improvised-weapon.js';
import { ThrowableSchema } from './throwable.js';

/**
 * Pola wspólne dla wszystkich rodzajów przedmiotów.
 * Każdy plik rodzaju (weapon-melee.ts, food.ts, …) rozszerza ten kształt o `kind` i swój blok.
 */
export const itemBaseShape = {
  id: ContentIdSchema,
  name: I18nKeySchema,
  description: I18nKeySchema.optional(),
  /** Waga jednej sztuki. */
  weightKg: WeightKgSchema,
  tags: TagListSchema,
  /** Maksymalny stos w jednym slocie (1 = nie stackuje się). */
  maxStack: z.number().int().min(1).max(1000).default(1),
  icon: z.string().optional(),
  model: z.string().optional(),
  /** Każdy przedmiot można opcjonalnie rzucić (butelka, kamień → hałas jako wabik). */
  throwable: ThrowableSchema.optional(),
  /** Każdy przedmiot w ręku jest bronią; blok nadpisuje słabe wartości domyślne (`meleeStatsFor`). */
  improvisedWeapon: ImprovisedWeaponSchema.optional(),
  ext: ExtSchema,
} as const;
