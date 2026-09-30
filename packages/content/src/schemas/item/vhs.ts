import { z } from 'zod';
import { RealSecondsSchema, SkillRefSchema, TagSchema } from '../common/index.js';
import { itemBaseShape } from './base.js';

/** XP z obejrzenia kasety w jednej umiejętności. */
export const VhsSkillSchema = z.strictObject({
  skill: SkillRefSchema,
  xp: z.number().positive().max(10000),
});

/**
 * Kaseta VHS: oglądana na telewizorze (placeable z tagiem `tvTag` i zasilaniem) przez `watchSec`
 * sekund rzeczywistych; daje XP w 1–3 umiejętnościach, domyślnie raz na postać.
 */
export const VhsItemSchema = z.strictObject({
  ...itemBaseShape,
  kind: z.literal('vhs'),
  vhs: z.strictObject({
    skills: z.array(VhsSkillSchema).min(1).max(3),
    watchSec: RealSecondsSchema.default(30),
    oncePerCharacter: z.boolean().default(true),
    tvTag: TagSchema.default('base:station-tv'),
  }),
});

export type VhsItem = z.infer<typeof VhsItemSchema>;
