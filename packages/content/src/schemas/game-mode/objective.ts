import { z } from 'zod';
import { NAMESPACE_PATTERN } from '../common/index.js';
import { ZoneRefSchema, type ZoneRef } from './zone-ref.js';

/** Lokalna nazwa NPC w trybie, np. `survivor` (kebab-case, bez namespace). */
export const LocalNameSchema = z
  .string()
  .regex(NAMESPACE_PATTERN, 'nazwa lokalna w kebab-case, np. `survivor`');

/**
 * Deklaratywny warunek wygranej/przegranej trybu (nigdy kod). Symulacja sprawdza go co tick
 * na stanie gry; `all`/`any` łączą warunki.
 */
export type ModeCondition =
  | { type: 'surviveDays'; days: number }
  | { type: 'extractNpc'; npcId: string; targetZone: ZoneRef }
  | { type: 'npcDead'; npcId: string }
  | { type: 'playerDead' }
  | { type: 'timeLimitDays'; days: number }
  | { type: 'all'; conditions: ModeCondition[] }
  | { type: 'any'; conditions: ModeCondition[] };

const days = z.number().int().min(1).max(3650);

export const ModeConditionSchema: z.ZodType<ModeCondition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('surviveDays'), days }),
    z.strictObject({
      type: z.literal('extractNpc'),
      npcId: LocalNameSchema,
      targetZone: ZoneRefSchema,
    }),
    z.strictObject({ type: z.literal('npcDead'), npcId: LocalNameSchema }),
    z.strictObject({ type: z.literal('playerDead') }),
    z.strictObject({ type: z.literal('timeLimitDays'), days }),
    z.strictObject({ type: z.literal('all'), conditions: z.array(ModeConditionSchema).min(1) }),
    z.strictObject({ type: z.literal('any'), conditions: z.array(ModeConditionSchema).min(1) }),
  ]),
);

/** `win` brak = gra bez końca (wynik liczy się do śmierci); `lose` = dowolny warunek kończy grę. */
export const ObjectiveSchema = z.strictObject({
  win: ModeConditionSchema.optional(),
  lose: z.array(ModeConditionSchema).min(1),
});

export type Objective = z.infer<typeof ObjectiveSchema>;
