import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  ItemRefSchema,
  RecipeRefSchema,
  TagListSchema,
} from './common/index.js';

export const STATION_MAX_LEVEL = 3;
export const StationLevelSchema = z.number().int().min(1).max(STATION_MAX_LEVEL);

/**
 * Poziom stacji: stawiany przedmiot (`placeable.station = { id, level }`) i receptura, która go
 * buduje (poziom 1) albo ulepsza z poprzedniego poziomu (zużywa przedmiot poziomu N−1).
 * Przedmiot poziomu można też znaleźć w lootcie albo na mapie jako obiekt.
 */
export const StationLevelDefSchema = z.strictObject({
  level: StationLevelSchema,
  item: ItemRefSchema,
  recipe: RecipeRefSchema,
  /** Mnożnik czasu receptur przy tej stacji na tym poziomie (np. 0.8 = −20%). */
  craftTimeMultiplier: z.number().positive().max(2).default(1),
});

/** Stacja rzemieślnicza (warsztat stolarski, stół mechanika, piec, stół elektronika). */
export const StationSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  description: I18nKeySchema.optional(),
  category: z.enum(['carpentry', 'mechanics', 'cooking', 'electronics']),
  tags: TagListSchema,
  /** Poziomy 1..n po kolei (n ≤ 3); ciągłość i ścieżkę ulepszeń sprawdza walidator. */
  levels: z.array(StationLevelDefSchema).min(1).max(STATION_MAX_LEVEL),
  icon: z.string().optional(),
  ext: ExtSchema,
});

export type StationLevelDef = z.infer<typeof StationLevelDefSchema>;
export type Station = z.infer<typeof StationSchema>;
