import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  TagListSchema,
  WeightKgSchema,
} from '../common/index.js';
import { LootCategorySchema } from '../loot-category.js';
import { ImprovisedWeaponSchema } from './improvised-weapon.js';
import { MedicineSchema } from './medicine.js';
import { WindowCoverSchema } from './window-cover.js';
import { ThrowableSchema } from './throwable.js';
import { WaterContainerSchema, WaterVesselSchema } from './water-container.js';

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
  /**
   * Nie zadaje obrażeń (chusteczka, papier, ubranie, bandaż): zamach w ręku tylko lekko pcha zombie.
   * Ma pierwszeństwo przed `improvisedWeapon` i wartościami domyślnymi z wagi.
   */
  harmless: z.boolean().optional(),
  /** Kategoria dla lootu schowków; brak = wyliczona z `kind` i tagów (`lootCategoryOf`). */
  lootCategory: LootCategorySchema.optional(),
  /** Pojemnik na wodę (butelka): pojemność w litrach (`item/water-container.ts`). */
  waterContainer: WaterContainerSchema.optional(),
  /** Naczynie na wodę do podlewania (`item/water-container.ts`). */
  waterVessel: WaterVesselSchema.optional(),
  /** Lek na chorobę (`item/medicine.ts`); domyślne w `DEFAULT_MEDICINE_*`. */
  medicine: MedicineSchema.optional(),
  /** Można nim zasłonić okno (`item/window-cover.ts`); domyślne w `DEFAULT_WINDOW_COVER_*`. */
  windowCover: WindowCoverSchema.optional(),
  ext: ExtSchema,
} as const;
