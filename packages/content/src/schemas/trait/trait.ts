import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  RecipeRefSchema,
  SkillBonusSchema,
  StatModifierSchema,
  TagListSchema,
  TraitRefSchema,
  XpMultiplierSchema,
} from '../common/index.js';
import { TraitConditionSchema } from './condition.js';

/**
 * Cecha postaci. Konwencja punktów: `cost` > 0 — cecha pozytywna, kosztuje punkty;
 * `cost` < 0 — negatywna, daje punkty przy tworzeniu postaci.
 */
export const TraitSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: I18nKeySchema,
    description: I18nKeySchema.optional(),
    polarity: z.enum(['positive', 'negative', 'neutral']),
    cost: z.number().int().min(-20).max(20),
    tags: TagListSchema,
    /** Cechy wykluczające się (sprawdzane w obie strony przez walidator). */
    conflicts: z.array(TraitRefSchema).default([]),
    modifiers: z.array(StatModifierSchema).default([]),
    skillBonuses: z.array(SkillBonusSchema).default([]),
    xpMultipliers: z.array(XpMultiplierSchema).default([]),
    knownRecipes: z.array(RecipeRefSchema).default([]),
    /** Czy można ją wybrać w kreatorze postaci (false = tylko z zawodu albo z gry). */
    selectable: z.boolean().default(true),
    /** Dynamiczne cechy: kiedy się pojawia / znika w trakcie gry. */
    gainedWhen: TraitConditionSchema.optional(),
    lostWhen: TraitConditionSchema.optional(),
    icon: z.string().optional(),
    ext: ExtSchema,
  })
  .refine((t) => !t.conflicts.includes(t.id), {
    message: 'cecha nie może kolidować sama ze sobą',
    path: ['conflicts'],
  });

export type Trait = z.infer<typeof TraitSchema>;
