import type { MoodleVM } from '@deadzone/ui';

/** Positive statuses show for this long after they appear, then hide (HUD v3 spec). */
export const POSITIVE_STATUS_MS = 2500;
/** The ammo widget stays this long after the last change (draw, shot, reload). */
export const AMMO_SHOW_MS = 2500;
/** The camera zoom chip stays this long after Z / X. */
export const CAMERA_CHIP_MS = 1500;
/** Max status chips; the rest folds into „+N”. */
export const MAX_STATUS_CHIPS = 6;

/** HUD v3: only problems (negative level ≥ 1); positives only briefly after they appear. */
export function problemMoodles(list: readonly MoodleVM[], now: number): MoodleVM[] {
  return list.filter(
    (m) => m.level >= 1 && (m.polarity !== 'pos' || now - m.since < POSITIVE_STATUS_MS),
  );
}

export type HpLevel = 'ok' | 'warning' | 'danger';

/** HP bar colour: > 30 normal, ≤ 30 warning, ≤ 15 danger (pulse). */
export function hpLevel(hp: number): HpLevel {
  if (hp <= 15) return 'danger';
  if (hp <= 30) return 'warning';
  return 'ok';
}

/**
 * Show / hide timer keyed by a value: `update(key, now)` returns whether the element is
 * shown — for `holdMs` after the key last changed, or while `force` is set.
 */
export function createShowTimer(
  holdMs: number,
): (key: string, now: number, force?: boolean) => boolean {
  let last: string | undefined;
  let changedAt = -Infinity;
  return (key, now, force = false) => {
    if (key !== last) {
      // The first value (HUD start) does not count as a change.
      if (last !== undefined) changedAt = now;
      last = key;
    }
    return force || now - changedAt < holdMs;
  };
}
