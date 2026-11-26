import { z } from 'zod';
import {
  GameMinutesSchema,
  RecipeRefSchema,
  SkillLevelSchema,
  SkillRefSchema,
} from '../common/index.js';
import { itemBaseShape } from './base.js';

/** Książka umiejętności: mnożnik XP w przedziale poziomów, np. tom 1 dla poziomów 0–2. */
export const SkillBookSchema = z
  .strictObject({
    skill: SkillRefSchema,
    multiplier: z.number().min(1).max(10),
    minLevel: SkillLevelSchema,
    maxLevel: SkillLevelSchema,
  })
  .refine((b) => b.minLevel <= b.maxLevel, {
    message: 'minLevel musi być ≤ maxLevel',
    path: ['maxLevel'],
  });

export const LiteratureItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('literature'),
  literature: z.strictObject({
    /** `game`: gra albo zabawka (karty, kostka Rubika, walkman) — „czytanie” to granie. */
    format: z.enum(['book', 'magazine', 'newspaper', 'comic', 'map', 'game']),
    readMin: GameMinutesSchema,
    skillBook: SkillBookSchema.optional(),
    /** Receptury odblokowane po przeczytaniu (magazyny). */
    unlocksRecipes: z.array(RecipeRefSchema).default([]),
    boredomReduction: z.number().min(0).max(100).default(0),
    stressReduction: z.number().min(0).max(100).default(0),
  }),
});

export type SkillBook = z.infer<typeof SkillBookSchema>;
export type LiteratureItem = z.infer<typeof LiteratureItemSchema>;
