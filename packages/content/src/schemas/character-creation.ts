import { z } from 'zod';
import { AppearancePartRefSchema, PaletteRefSchema } from './common/index.js';

const ColorId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Wybrana część: id i kolor (id z palety kanału) dla każdego kanału barwienia części. */
export const AppearanceChoiceSchema = z.strictObject({
  part: AppearancePartRefSchema,
  colors: z.partialRecord(z.enum(['primary', 'secondary']), ColorId).default({}),
});

/** Wygląd postaci (zapisywany w stanie postaci): kolor skóry i część w każdym slocie. */
export const AppearanceSchema = z.strictObject({
  skin: ColorId,
  parts: z.strictObject({
    head: AppearanceChoiceSchema,
    top: AppearanceChoiceSchema,
    bottom: AppearanceChoiceSchema,
    shoes: AppearanceChoiceSchema,
  }),
});

/**
 * Tworzenie postaci. Pula = `startPoints` + `profession.points` − Σ `trait.cost` − koszt
 * umiejętności (poziom N kosztuje `skillPointCost[N-1]`, łącznie suma do N, maks.
 * `maxSkillLevelAtStart` ponad bonus zawodu). Pula nie może zejść poniżej 0.
 */
export const CharacterCreationSchema = z
  .strictObject({
    startPoints: z.number().int().min(0).max(100).default(8),
    maxSkillLevelAtStart: z.number().int().min(0).max(10).default(3),
    skillPointCost: z.array(z.number().int().min(1).max(20)).max(10).default([1, 2, 3]),
    name: z
      .strictObject({
        minLen: z.number().int().min(1).max(64).default(2),
        maxLen: z.number().int().min(1).max(64).default(24),
      })
      .prefault({}),
    /** Paleta koloru skóry. */
    skinPalette: PaletteRefSchema.default('base:skin'),
    /** Wygląd startowy; brak = pierwsze opcje każdego slotu. */
    defaultAppearance: AppearanceSchema.optional(),
  })
  .prefault({});

export type AppearanceChoice = z.infer<typeof AppearanceChoiceSchema>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export type CharacterCreation = z.infer<typeof CharacterCreationSchema>;
