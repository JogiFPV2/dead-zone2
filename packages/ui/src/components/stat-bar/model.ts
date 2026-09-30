/** StatBar rules (spec §3.7). */

export type StatId = 'health' | 'thirst' | 'hunger' | 'energy';
export type StatBarState = 'normal' | 'low' | 'critical';

export const STAT_IDS = [
  'health',
  'thirst',
  'hunger',
  'energy',
] as const satisfies readonly StatId[];

export interface StatThresholds {
  /** value ≤ low → `low` (default 30). */
  low: number;
  /** value ≤ critical → `critical` (default 15). */
  critical: number;
}

export const DEFAULT_THRESHOLDS: StatThresholds = { low: 30, critical: 15 };

/** Drain = drop of more than DRAIN_DELTA within DRAIN_WINDOW_MS; ghost slides in DRAIN_GHOST_MS. */
export const DRAIN_DELTA = 5;
export const DRAIN_WINDOW_MS = 1000;
export const DRAIN_GHOST_MS = 600;

export const clampStat = (v: number): number =>
  Math.min(100, Math.max(0, Number.isFinite(v) ? v : 0));

export function statBarState(value: number, t: StatThresholds = DEFAULT_THRESHOLDS): StatBarState {
  const v = clampStat(value);
  if (v <= t.critical) return 'critical';
  if (v <= t.low) return 'low';
  return 'normal';
}

/**
 * Tracks recent samples and reports the value to start a drain ghost from,
 * or `undefined` when the drop in the last second is ≤ DRAIN_DELTA.
 */
export class DrainDetector {
  private samples: { t: number; v: number }[] = [];

  push(value: number, now: number): number | undefined {
    this.samples = this.samples.filter((s) => now - s.t <= DRAIN_WINDOW_MS);
    const peak = this.samples.reduce((m, s) => Math.max(m, s.v), -Infinity);
    this.samples.push({ t: now, v: value });
    if (peak - value > DRAIN_DELTA) {
      // One-shot: restart the window from the new value.
      this.samples = [{ t: now, v: value }];
      return peak;
    }
    return undefined;
  }
}
