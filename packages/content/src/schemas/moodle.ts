import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  StatIdSchema,
  StatModifierSchema,
  TagListSchema,
} from './common/index.js';

export const MOODLE_MAX_LEVEL = 4;

/**
 * Jeden poziom moodla (1..maxLevel). Poziom 0 = ukryty, nie ma wpisu.
 * Histereza: poziom włącza się przy `enterAt`, wyłącza dopiero przy `exitAt`,
 * żeby chip nie migał na granicy progu.
 */
export const MoodleLevelSchema = z.strictObject({
  /** Klucz etykiety chipa w HUD, np. `moodle.base.hunger.level-2`. */
  label: I18nKeySchema,
  description: I18nKeySchema.optional(),
  enterAt: z.number(),
  exitAt: z.number(),
  /** Efekty aktywne na tym poziomie. */
  modifiers: z.array(StatModifierSchema).default([]),
});

/**
 * Moodle = chip statusu w HUD. Stała decyzja (Designer buduje z tego chipy):
 * `polarity` negative|positive, `maxLevel` 1–4, `levels[i]` to poziom i+1.
 * `direction: rising` — poziom rośnie, gdy statystyka rośnie (głód); `falling` — gdy maleje (np. zdrowie).
 */
export const MoodleSchema = z
  .strictObject({
    id: ContentIdSchema,
    name: I18nKeySchema,
    description: I18nKeySchema.optional(),
    polarity: z.enum(['negative', 'positive']),
    maxLevel: z.number().int().min(1).max(MOODLE_MAX_LEVEL),
    /** Statystyka sterująca moodlem, np. `hunger`, `infection`, `carry-load`. */
    stat: StatIdSchema,
    direction: z.enum(['rising', 'falling']).default('rising'),
    levels: z.array(MoodleLevelSchema).min(1).max(MOODLE_MAX_LEVEL),
    icon: z.string().optional(),
    tags: TagListSchema,
    ext: ExtSchema,
  })
  .superRefine((m, ctx) => {
    if (m.levels.length !== m.maxLevel) {
      ctx.addIssue({
        code: 'custom',
        message: `levels musi mieć dokładnie maxLevel (${m.maxLevel}) wpisów, jest ${m.levels.length}`,
        path: ['levels'],
      });
    }
    const rising = m.direction === 'rising';
    m.levels.forEach((lvl, i) => {
      const hysteresisOk = rising ? lvl.exitAt <= lvl.enterAt : lvl.exitAt >= lvl.enterAt;
      if (!hysteresisOk) {
        ctx.addIssue({
          code: 'custom',
          message: `exitAt musi być ${rising ? '≤' : '≥'} enterAt (histereza, poziom ${i + 1})`,
          path: ['levels', i, 'exitAt'],
        });
      }
      const prev = m.levels[i - 1];
      if (prev && !(rising ? lvl.enterAt > prev.enterAt : lvl.enterAt < prev.enterAt)) {
        ctx.addIssue({
          code: 'custom',
          message: `progi enterAt muszą być ${rising ? 'rosnące' : 'malejące'} (poziom ${i + 1})`,
          path: ['levels', i, 'enterAt'],
        });
      }
    });
  });

export type MoodleLevel = z.infer<typeof MoodleLevelSchema>;
export type Moodle = z.infer<typeof MoodleSchema>;
