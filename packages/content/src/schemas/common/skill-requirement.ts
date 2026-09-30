import { z } from 'zod';
import { SkillRefSchema } from './ref.js';
import { SkillLevelSchema } from './units.js';

/** Wymagany poziom umiejętności. */
export const SkillRequirementSchema = z.strictObject({
  skill: SkillRefSchema,
  level: SkillLevelSchema,
});

/** Premia do umiejętności (zawód, cecha): +N poziomów na starcie. */
export const SkillBonusSchema = z.strictObject({
  skill: SkillRefSchema,
  levels: z.number().int().min(-10).max(10),
});

/** Nagroda XP za akcję. */
export const XpRewardSchema = z.strictObject({
  skill: SkillRefSchema,
  amount: z.number().min(0),
});

/** Mnożnik XP dla umiejętności (książka, cecha). */
export const XpMultiplierSchema = z.strictObject({
  skill: SkillRefSchema,
  multiplier: z.number().min(0).max(10),
});

export type SkillRequirement = z.infer<typeof SkillRequirementSchema>;
export type SkillBonus = z.infer<typeof SkillBonusSchema>;
export type XpReward = z.infer<typeof XpRewardSchema>;
export type XpMultiplier = z.infer<typeof XpMultiplierSchema>;
