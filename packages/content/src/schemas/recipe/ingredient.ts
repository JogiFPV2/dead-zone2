import { z } from 'zod';
import { ItemRefSchema, TagSchema } from '../common/index.js';

const count = z.number().int().min(1).max(1000).default(1);

/** Składnik zużywany przez recepturę (id albo tag). */
export const IngredientSchema = z.union([
  z.strictObject({ item: ItemRefSchema, count }),
  z.strictObject({ tag: TagSchema, count }),
]);

export type Ingredient = z.infer<typeof IngredientSchema>;
