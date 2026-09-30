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
import { RecipeRepairSchema } from './repair.js';
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

export const RecipeSchema = z
  .strictObject({
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
    /** Produkty; puste tylko w recepturze naprawy. */
    results: z.array(RecipeResultSchema).default([]),
    xp: z.array(XpRewardSchema).default([]),
    /** true = trzeba ją poznać (książka, magazyn, zawód); false = znana od startu. */
    requiresLearning: z.boolean().default(false),
    /** Wymagane otoczenie, np. `base:station-fire`, `base:station-workbench`. */
    station: TagSchema.optional(),
    /** Receptura naprawy (np. taśma na broń); wtedy `results` może być puste. */
    repair: RecipeRepairSchema.optional(),
    ext: ExtSchema,
  })
  .refine((r) => r.results.length > 0 || r.repair !== undefined, {
    message: 'receptura musi mieć `results` albo `repair`',
    path: ['results'],
  });

export type RecipeCategory = z.infer<typeof RecipeCategorySchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
