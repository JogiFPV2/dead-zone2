import { z } from 'zod';
import {
  ContentIdSchema,
  GameMinutesSchema,
  ExtSchema,
  I18nKeySchema,
  SkillRequirementSchema,
  StationRefSchema,
  TagListSchema,
  XpRewardSchema,
} from '../common/index.js';
import { StationLevelSchema } from '../station.js';
import { ApplianceSchema } from '../item/cooking.js';
import { IngredientSchema } from './ingredient.js';
import { RecipeRepairSchema } from './repair.js';
import { RecipeResultSchema } from './result.js';
import { ToolRequirementSchema } from './tool-requirement.js';

/** Grupa w oknie craftingu/warsztatu (UI); dziedzinę umiejętności opisują `skills` i `xp`. */
export const RecipeCategorySchema = z.enum([
  'weapons',
  'tools',
  'food',
  'medical',
  'building',
  'furniture',
  'electronics',
  'clothing',
  'materials',
  'stations',
]);

/**
 * `craft` = receptura przy stacji albo w rękach; `combine` = łączenie w ekwipunku
 * (najwyżej 4 części, czyli wpisy `ingredients`, bez stacji; narzędzia z ekwipunku dozwolone).
 */
export const RecipeKindSchema = z.enum(['craft', 'combine']);

/** Wymagana stacja i jej minimalny poziom. */
export const RecipeStationSchema = z.strictObject({
  id: StationRefSchema,
  minLevel: StationLevelSchema.default(1),
  /** Kuchenka: potrzebna część (palniki / piekarnik); stacje bez `placeable.cooking` zawsze pasują. */
  appliance: ApplianceSchema.optional(),
});

export const RecipeSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: I18nKeySchema,
    description: I18nKeySchema.optional(),
    kind: RecipeKindSchema.default('craft'),
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
    /** Stacja w pobliżu, np. `{ id: 'base:station-fire', minLevel: 2 }`. */
    station: RecipeStationSchema.optional(),
    /** Receptura naprawy (np. taśma na broń); wtedy `results` może być puste. */
    repair: RecipeRepairSchema.optional(),
    ext: ExtSchema,
  })
  .refine((r) => r.results.length > 0 || r.repair !== undefined, {
    message: 'receptura musi mieć `results` albo `repair`',
    path: ['results'],
  });

export type RecipeCategory = z.infer<typeof RecipeCategorySchema>;
export type RecipeKind = z.infer<typeof RecipeKindSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
