/** Moodle view model and pure rules (spec §3.2 StatusChip, §5 MoodleVM). */

export type Polarity = 'neg' | 'pos';
export type MoodleLevel = 0 | 1 | 2 | 3 | 4;
/** Levels that are rendered. Level 0 = no element at all. */
export type VisibleMoodleLevel = Exclude<MoodleLevel, 0>;

export const POLARITIES = ['neg', 'pos'] as const satisfies readonly Polarity[];
export const VISIBLE_LEVELS = [1, 2, 3, 4] as const satisfies readonly VisibleMoodleLevel[];

export interface MoodleVM {
  id: string;
  /** Display name in normal case, e.g. "Ból" (uppercased by CSS). */
  label: string;
  polarity: Polarity;
  level: MoodleLevel;
  description?: string;
  /** When the moodle appeared (any monotonic clock); tie-breaker for ordering. */
  since: number;
}

/** `@deadzone/content` uses `negative|positive`; the HUD uses the short form from the spec. */
export const toPolarity = (p: 'negative' | 'positive'): Polarity =>
  p === 'negative' ? 'neg' : 'pos';

/** Level ≥ 2 appends the number (`Ból 2`); level 1 shows the bare name. */
export const moodleLabel = (label: string, level: VisibleMoodleLevel): string =>
  level >= 2 ? `${label} ${level}` : label;

export const isVisible = (m: MoodleVM): m is MoodleVM & { level: VisibleMoodleLevel } =>
  m.level > 0;

/** Negatives first, then positives; inside a group level desc, then `since` asc. Drops level 0. */
export function sortMoodles(
  moodles: readonly MoodleVM[],
): (MoodleVM & { level: VisibleMoodleLevel })[] {
  return moodles.filter(isVisible).sort((a, b) => {
    if (a.polarity !== b.polarity) return a.polarity === 'neg' ? -1 : 1;
    if (a.level !== b.level) return b.level - a.level;
    return a.since - b.since;
  });
}

/** Splits a sorted list into visible chips and the "+N" overflow count. */
export function planOverflow<T>(
  sorted: readonly T[],
  maxVisible: number,
): { visible: T[]; overflow: number } {
  if (sorted.length <= maxVisible) return { visible: [...sorted], overflow: 0 };
  // The "+N" chip takes one of the slots.
  const keep = Math.max(0, maxVisible - 1);
  return { visible: sorted.slice(0, keep), overflow: sorted.length - keep };
}
