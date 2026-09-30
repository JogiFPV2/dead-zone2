import { z } from 'zod';
import {
  GameMinutesSchema,
  FractionSchema,
  ItemRefSchema,
  SkillRequirementSchema,
} from '../common/index.js';
import { itemBaseShape } from './base.js';

export const MedicalEffectSchema = z.enum([
  'stop_bleeding',
  'disinfect',
  'pain_relief',
  'heal_wound',
  'splint',
  'remove_splinter',
  'reduce_sickness',
]);

export const MedicalItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('medical'),
  medical: z.strictObject({
    effects: z.array(MedicalEffectSchema).min(1),
    /** Siła działania 0..1 (skalowana umiejętnością pierwszej pomocy). */
    potency: FractionSchema.default(0.5),
    durationMin: GameMinutesSchema,
    uses: z.number().int().min(1).default(1),
    requires: SkillRequirementSchema.optional(),
    /** Np. zakrwawiony bandaż po zdjęciu. */
    usedInto: ItemRefSchema.optional(),
  }),
});

export type MedicalEffect = z.infer<typeof MedicalEffectSchema>;
export type MedicalItem = z.infer<typeof MedicalItemSchema>;
