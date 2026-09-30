import { dayOf, gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';

/** Per-tick output of the clock system for the per-minute systems. */
export interface MinuteTicks {
  /** Absolute game minutes to process this tick, oldest first (usually none or one). */
  first: number;
  count: number;
}

/**
 * Pipeline step 2: game clock. Survival works in whole game minutes (rates in the data are per
 * game minute), so the per-minute systems run when the minute changes (every 50 ticks for a
 * 60-minute day). Emits `dayPassed` at midnight.
 */
export function clockSystem(w: SimWorld, out: MinuteTicks): void {
  const now = gameMinuteAt(w.clock, w.tick);
  const s = w.survival;
  const last = s ? s.lastMinute : gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
  out.first = last + 1;
  out.count = Math.max(0, now - last);
  if (s) s.lastMinute = now;
  if (out.count > 0 && dayOf(now) !== dayOf(last)) {
    w.events.push({ type: 'dayPassed', tick: w.tick, day: dayOf(now) });
  }
}
