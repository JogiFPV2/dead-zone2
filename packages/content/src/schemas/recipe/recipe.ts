import { z } from 'zod';
import {
  ContentIdSchema,
  GameMinutesSchema,
  ExtSchema,
  I18nKeySchema,
  SkillRequirementSchema,
  TagListSchema,
  TagSchema,
  XpRewardSchema,
} from '../common/index.js';
import { IngredientSchema } from './ingredient.js';
import { RecipeResultSchema } from './result.js';
import { ToolRequirementSchema } from './tool-requirement.js';

export const RecipeCategorySchema = z.enum([
  'general',
  'cooking',
  'medical',
  'carpentry',
  'tailoring',
  'metalworking',
  'electrical',
  'mechanics',
  'weapons',
  'survival',
]);

export const RecipeSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  description: I18nKeySchema.optional(),
  category: RecipeCategorySchema,
  tags: TagListSchema,
  ingredients: z.array(IngredientSchema).min(1),
  tools: z.array(ToolRequirementSchema).default([]),
  skills: z.array(SkillRequirementSchema).default([]),
  /** Czas wykonania w minutach gry (przy poziomie wymaganym). */
  durationMin: GameMinutesSchema,
  results: z.array(RecipeResultSchema).min(1),
  xp: z.array(XpRewardSchema).default([]),
  /** true = trzeba ją poznać (książka, magazyn, zawód); false = znana od startu. */
  requiresLearning: z.boolean().default(false),
  /** Wymagane otoczenie, np. `base:station/fire`, `base:station/workbench`. */
  station: TagSchema.optional(),
  ext: ExtSchema,
});

export type RecipeCategory = z.infer<typeof RecipeCategorySchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
