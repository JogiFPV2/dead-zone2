import { z } from 'zod';
import {
  ContentIdSchema,
  ExtSchema,
  I18nKeySchema,
  PaletteRefSchema,
  TagListSchema,
} from './common/index.js';

/**
 * Sloty wyglądu. Na start `head` to gotowy wariant głowy (twarz i fryzura w jednym modelu
 * Quaternius). Lista jest rozszerzalna: osobne `face`, `hair` czy `beard` można dodać później
 * (enum, `REQUIRED_APPEARANCE_SLOTS`, `AppearanceSchema.parts` i `SLOT_PALETTE` w walidatorze).
 */
export const APPEARANCE_SLOTS = ['head', 'top', 'bottom', 'shoes'] as const;
export const REQUIRED_APPEARANCE_SLOTS = ['head', 'top', 'bottom', 'shoes'] as const;
export const AppearanceSlotSchema = z.enum(APPEARANCE_SLOTS);
export const TintChannelSchema = z.enum(['primary', 'secondary']);

/** Kanał barwienia modelu i paleta, z której gracz wybiera kolor. */
export const TintSchema = z.strictObject({ channel: TintChannelSchema, palette: PaletteRefSchema });

/**
 * Część wyglądu postaci (głowa, góra, dół, buty). Kanał `primary` głowy to kolor włosów (paleta hair),
 * skórę barwi `Appearance.skin`. `modelRef` to klucz assetu
 * (modele modularne CC0 dostarcza Silnik), np. `char/hair-short`. `bodyTypes` to opcjonalne tagi
 * sylwetki; puste = pasuje do każdej.
 */
export const AppearancePartSchema = z.strictObject({
  id: ContentIdSchema,
  name: I18nKeySchema,
  slot: AppearanceSlotSchema,
  modelRef: z.string().regex(/^[a-z0-9]+([/_-][a-z0-9]+)*$/, 'klucz assetu, np. char/hair-short'),
  tints: z
    .array(TintSchema)
    .max(2)
    .default([])
    .refine((t) => new Set(t.map((x) => x.channel)).size === t.length, {
      message: 'kanał barwienia powtórzony',
    }),
  bodyTypes: TagListSchema,
  icon: z.string().optional(),
  ext: ExtSchema,
});

export type AppearanceSlot = z.infer<typeof AppearanceSlotSchema>;
export type TintChannel = z.infer<typeof TintChannelSchema>;
export type AppearancePart = z.infer<typeof AppearancePartSchema>;
