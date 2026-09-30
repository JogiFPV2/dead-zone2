import { z } from 'zod';
import { ConditionSchema } from './condition.js';
import { StatIdSchema } from './stat.js';

/**
 * Modyfikator statystyki (cechy, zawody, moodle): `add` dodaje, `mul` mnoży.
 * `when` — opcjonalny warunek, np. `{ "moodle": "base:panic", "minLevel": 2 }`.
 */
export const StatModifierSchema = z.strictObject({
  stat: StatIdSchema,
  op: z.enum(['add', 'mul']),
  value: z.number(),
  when: ConditionSchema.optional(),
});

export type StatModifier = z.infer<typeof StatModifierSchema>;
