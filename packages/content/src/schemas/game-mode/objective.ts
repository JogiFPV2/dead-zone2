import { z } from 'zod';
import { NAMESPACE_PATTERN } from '../common/index.js';

/** Lokalna nazwa strefy albo NPC w trybie, np. `villa`, `survivor` (kebab-case, bez namespace). */
export const LocalNameSchema = z
  .string()
  .regex(NAMESPACE_PATTERN, 'nazwa lokalna w kebab-case, np. `villa`');

/**
 * Deklaratywny warunek wygranej/przegranej trybu (nigdy kod). Symulacja sprawdza go co tick
 * na stanie gry; `all`/`any` łączą warunki.
 */
export type ModeCondition =
  | { type: 'surviveDays'; days: number }
  | { type: 'extractNpc'; npcId: string; targetZone: string }
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
      targetZone: LocalNameSchema,
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

/** Wszystkie nazwy NPC i stref użyte w warunku (do sprawdzenia, że są zadeklarowane). */
export function conditionNames(c: ModeCondition): { npcs: string[]; zones: string[] } {
  if (c.type === 'all' || c.type === 'any') {
    const parts = c.conditions.map(conditionNames);
    return { npcs: parts.flatMap((p) => p.npcs), zones: parts.flatMap((p) => p.zones) };
  }
  if (c.type === 'extractNpc') return { npcs: [c.npcId], zones: [c.targetZone] };
  if (c.type === 'npcDead') return { npcs: [c.npcId], zones: [] };
  return { npcs: [], zones: [] };
}

export type Objective = z.infer<typeof ObjectiveSchema>;
