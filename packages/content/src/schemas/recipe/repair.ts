import { z } from 'zod';
import { ItemRefSchema, TagSchema } from '../common/index.js';

const restorePct = z.number().int().min(1).max(100);

/**
 * Naprawa: receptura przywraca `restorePct` % maksymalnej trwałości przedmiotu `target`
 * (id albo tag). Przedmiot nie jest zużywany; `ingredients` to materiały naprawy (taśma, nici).
 */
export const RecipeRepairSchema = z.union([
  z.strictObject({ item: ItemRefSchema, restorePct }),
  z.strictObject({ tag: TagSchema, restorePct }),
]);

export type RecipeRepair = z.infer<typeof RecipeRepairSchema>;
