import { z } from 'zod';
import { MoodleRefSchema, SkillRefSchema, TraitRefSchema } from './ref.js';
import { SkillLevelSchema } from './units.js';
import { StatIdSchema } from './stat.js';

/**
 * Deklaratywny warunek (nigdy kod). Symulacja interpretuje go na bieżącym stanie postaci.
 * Dokładnie jeden rodzaj na obiekt; `all`/`any` pozwalają łączyć.
 */
export type Condition =
  | { moodle: string; minLevel: number }
  | { skill: string; minLevel: number }
  | { trait: string }
  | { stat: string; op: 'gte' | 'lte'; value: number }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ moodle: MoodleRefSchema, minLevel: z.number().int().min(1).max(4) }),
    z.strictObject({ skill: SkillRefSchema, minLevel: SkillLevelSchema }),
    z.strictObject({ trait: TraitRefSchema }),
    z.strictObject({ stat: StatIdSchema, op: z.enum(['gte', 'lte']), value: z.number() }),
    z.strictObject({ all: z.array(ConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1) }),
    z.strictObject({ not: ConditionSchema }),
  ]),
);
