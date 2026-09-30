import { z } from 'zod';
import { ItemRefSchema } from '../common/index.js';

export const RecipeResultSchema = z.strictObject({
  item: ItemRefSchema,
  count: z.number().int().min(1).max(1000).default(1),
});

export type RecipeResult = z.infer<typeof RecipeResultSchema>;
