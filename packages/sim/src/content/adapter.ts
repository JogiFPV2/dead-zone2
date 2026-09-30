import type { ContentBundle } from '@deadzone/content';

/**
 * What the sim reads from a `ContentBundle` (a full bundle is assignable). Kept structural so
 * tests can pass a hand-made fixture and the sim never imports content at runtime (no zod).
 */
export type SimContent = Pick<ContentBundle, 'worldSettings' | 'moodles' | 'items'>;
export type SurvivalSettings = ContentBundle['worldSettings']['survival'];
type MoodleDef = ContentBundle['moodles'][string];
type ModifierDef = MoodleDef['levels'][number]['modifiers'][number];
export type ConditionDef = NonNullable<ModifierDef['when']>;

/** Rate stats the survival systems read from the modifier cache (index = slot). */
export const MOD_STATS = [
  'hunger-rate',
  'thirst-rate',
  'fatigue-rate',
  'endurance-regen',
  'healing-rate',
  'move-speed',
] as const;
export type ModStat = (typeof MOD_STATS)[number];
export const ModSlot = Object.fromEntries(MOD_STATS.map((s, i) => [s, i])) as Record<
  ModStat,
  number
>;

export interface CompiledModifier {
  slot: number;
  op: 'add' | 'mul';
  value: number;
  when: ConditionDef | undefined;
}

export interface CompiledMoodle {
  id: string;
  /** Content stat id, e.g. `hunger`, `body-temperature-c`. */
  stat: string;
  rising: boolean;
  maxLevel: number;
  /** f32-rounded thresholds, index = level − 1. */
  enterAt: number[];
  exitAt: number[];
  /** Modifiers of each level (only rate stats in MOD_STATS; others are for later systems). */
  modifiers: CompiledModifier[][];
}

/** Content prepared once per sim: sorted, numeric indices, f32 thresholds. */
export interface ContentIndex {
  dayLengthMinutes: number;
  survival: SurvivalSettings;
  /** Sorted by id (numeric index = position; part of the state hash). */
  moodles: CompiledMoodle[];
  moodleIndex: ReadonlyMap<string, number>;
  /** Moodle indices that count as "Cold" for sleep quality (body temperature, falling). */
  coldMoodles: number[];
  /** Medical items with `stop_bleeding` (valid `bandage.itemId`). */
  bandageItems: ReadonlySet<string>;
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function compileContent(content: SimContent): ContentIndex {
  const ids = Object.keys(content.moodles).sort(byId);
  const moodles: CompiledMoodle[] = ids.map((id) => {
    const m = content.moodles[id]!;
    return {
      id,
      stat: m.stat,
      rising: m.direction !== 'falling',
      maxLevel: m.levels.length,
      enterAt: m.levels.map((l) => Math.fround(l.enterAt)),
      exitAt: m.levels.map((l) => Math.fround(l.exitAt)),
      modifiers: m.levels.map((l) =>
        l.modifiers.flatMap((mod): CompiledModifier[] => {
          const slot = (ModSlot as Record<string, number | undefined>)[mod.stat];
          return slot === undefined ? [] : [{ slot, op: mod.op, value: mod.value, when: mod.when }];
        }),
      ),
    };
  });
  const bandageItems = new Set<string>();
  for (const id of Object.keys(content.items).sort(byId)) {
    const item = content.items[id]!;
    if (item.kind === 'medical' && item.medical.effects.includes('stop_bleeding')) {
      bandageItems.add(id);
    }
  }
  return {
    dayLengthMinutes: content.worldSettings.dayLengthMinutes,
    survival: content.worldSettings.survival,
    moodles,
    moodleIndex: new Map(ids.map((id, i) => [id, i])),
    coldMoodles: moodles.flatMap((m, i) =>
      m.stat === 'body-temperature-c' && !m.rising ? [i] : [],
    ),
    bandageItems,
  };
}
