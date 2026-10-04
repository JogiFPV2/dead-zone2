import { z } from 'zod';
import { ExtSchema, ItemRefSchema, TagSchema } from './common/index.js';

/**
 * Definicja tagu przedmiotów (`tags/`). Id to sam tag, np. `base:wood-plank`.
 * `iconItem` — przedmiot, którego ikonę UI pokazuje zamiast zastępczej kostki tam, gdzie
 * receptura żąda tagu. Walidator krzyżowy sprawdza, że przedmiot istnieje i ma ten tag.
 */
export const TagDefSchema = z.strictObject({
  id: TagSchema,
  iconItem: ItemRefSchema.optional(),
  ext: ExtSchema,
});

export type TagDef = z.infer<typeof TagDefSchema>;
