import type { ClockView } from '@deadzone/protocol';
import { wrapMinute } from './day-cycle.js';

/**
 * Continuous minute of day from the sim clock view: `minuteOfDay` plus the ticks elapsed since
 * `minuteStartTick` (from the latest snapshot tick, fractional between ticks). Clamped to at
 * most 2 minutes ahead so a late view does not run the sky away.
 */
export function clockMinute(clock: ClockView, tick: number): number {
  const elapsed = (tick - clock.minuteStartTick) / Math.max(1, clock.ticksPerGameMinute);
  return wrapMinute(clock.minuteOfDay + Math.min(2, Math.max(0, elapsed)));
}

/** Dev override `?time=HH:MM[&timescale=N]`: fixed, or N game minutes per real second. */
export function overrideMinute(start: number, timescale: number, elapsedMs: number): number {
  return wrapMinute(start + (timescale * elapsedMs) / 1000);
}

/** `HH:MM` (00:00–23:59) → minute of day; anything else → undefined. */
export function parseTimeParam(v: string | null): number | undefined {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

export const formatMinute = (minute: number): string => {
  const m = Math.floor(wrapMinute(minute));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
