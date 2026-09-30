import { z } from 'zod';
import { GameMinutesSchema, StatIdSchema } from '../common/index.js';

/**
 * Warunek zdobycia/utraty cechy w trakcie gry, np. `body-weight-kg >= 100` przez 3 dni → „Otyłość”.
 * Symulacja interpretuje `stat`; schemat pilnuje tylko kształtu.
 */
export const TraitConditionSchema = z.strictObject({
  stat: StatIdSchema,
  op: z.enum(['gte', 'lte']),
  value: z.number(),
  /** Jak długo (minuty gry) warunek musi trwać nieprzerwanie. */
  sustainedMin: GameMinutesSchema.default(0),
});

export type TraitCondition = z.infer<typeof TraitConditionSchema>;
