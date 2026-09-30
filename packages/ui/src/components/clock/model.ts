/** Clock + day counter (spec §3.8). Data = sim `ClockView` (`day`, `minuteOfDay`). */

export interface ClockVM {
  /** 0..1439 (wrapped if outside). */
  minuteOfDay: number;
  /** Day of the game, from 1. */
  day: number;
}

const DAY_MINUTES = 24 * 60;
const pad = (n: number): string => String(n).padStart(2, '0');

/** `HH:MM`, 24 h. */
export function formatClock(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** `Dzień 12` (uppercased by CSS). */
export const dayLabel = (day: number): string => `Dzień ${Math.max(1, Math.floor(day))}`;
