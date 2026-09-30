import { z } from 'zod';
import { ContentIdSchema, ExtSchema, I18nKeySchema, TagListSchema } from './common/index.js';

/** Cztery grupy umiejętności z planu. */
export const SkillGroupSchema = z.enum(['combat', 'survival', 'crafting', 'movement']);

export const SKILL_MAX_LEVEL = 10;

export const SkillSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  description: I18nKeySchema.optional(),
  group: SkillGroupSchema,
  tags: TagListSchema,
  /** XP potrzebne na kolejne poziomy 1..10 (dokładnie 10 rosnących liczb). */
  xpPerLevel: z
    .array(z.number().positive())
    .length(SKILL_MAX_LEVEL)
    .refine((xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]!), {
      message: 'xpPerLevel musi być niemalejące',
    }),
  /** Poziom startowy dla każdej postaci (np. siła/kondycja 5). */
  startingLevel: z.number().int().min(0).max(SKILL_MAX_LEVEL).default(0),
  /** Umiejętność pasywna (siła, kondycja) — XP z wysiłku, nie z akcji. */
  passive: z.boolean().default(false),
  icon: z.string().optional(),
  ext: ExtSchema,
});

export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Skill = z.infer<typeof SkillSchema>;
