import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  ItemRefSchema,
  RecipeRefSchema,
  SkillBonusSchema,
  StatModifierSchema,
  TagListSchema,
  TraitRefSchema,
} from './common/index.js';

export const StartingItemSchema = z.strictObject({
  item: ItemRefSchema,
  count: z.number().int().min(1).default(1),
});

export const ProfessionSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  description: I18nKeySchema.optional(),
  tags: TagListSchema,
  /** Punkty do wydania na cechy (ujemne = zawód „mocny”, zabiera punkty). */
  points: z.number().int().min(-20).max(20),
  skillBonuses: z.array(SkillBonusSchema).default([]),
  modifiers: z.array(StatModifierSchema).default([]),
  /** Cechy nadawane za darmo (zwykle `selectable: false`). */
  freeTraits: z.array(TraitRefSchema).default([]),
  knownRecipes: z.array(RecipeRefSchema).default([]),
  startingItems: z.array(StartingItemSchema).default([]),
  icon: z.string().optional(),
  ext: ExtSchema,
});

export type StartingItem = z.infer<typeof StartingItemSchema>;
export type Profession = z.infer<typeof ProfessionSchema>;
