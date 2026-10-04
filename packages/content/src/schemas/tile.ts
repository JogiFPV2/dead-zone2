import { z } from 'zod';
import { ContentIdSchema, ExtSchema, I18nKeySchema, TagListSchema } from './common/index.js';

/** Rodzaj elementu statycznego mapy: kafel podłogi, dachu albo krawędź (ściana, okno, drzwi). */
export const TILE_CATEGORIES = [
  'floor',
  'roof',
  'wall',
  'window',
  'door',
  'fence',
  'gate',
] as const;
export const TileCategorySchema = z.enum(TILE_CATEGORIES);

/**
 * Element statyczny mapy wskazywany z palety chunka (`floor`, `roof`) i z krawędzi (`wall`,
 * `window`, `door`). Stan dynamiczny (otwarte, rozbite, zabite deskami) sim trzyma poza chunkiem.
 */
export const TileSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  category: TileCategorySchema,
  tags: TagListSchema,
  model: z.string().optional(),
  ext: ExtSchema,
});

export type TileCategory = z.infer<typeof TileCategorySchema>;
export type Tile = z.infer<typeof TileSchema>;
