import { TICKS_PER_SECOND } from './constants.js';

export const MINUTES_PER_DAY = 1440;

/** Start of the game clock (default: day 1, 09:00 like the base survival mode). */
export interface ClockStart {
  day: number;
  hour: number;
  minute: number;
}

export const DEFAULT_CLOCK_START: ClockStart = { day: 1, hour: 9, minute: 0 };
/** `worldSettings.dayLengthMinutes` default (1 game day = 60 real minutes at ×1). */
export const DEFAULT_DAY_LENGTH_MINUTES = 60;

/**
 * Tick ↔ game time. Game minutes are absolute (minute 0 = day 1, 00:00). Everything is derived
 * from the tick with integer math, so the clock itself has no mutable state.
 */
export interface Clock {
  /** Ticks per game day (60 real minutes × 60 s × 20 Hz = 72 000). */
  readonly ticksPerDay: number;
  readonly startMinute: number;
}

export function createClock(
  dayLengthMinutes = DEFAULT_DAY_LENGTH_MINUTES,
  start: ClockStart = DEFAULT_CLOCK_START,
): Clock {
  const ticksPerDay = Math.max(1, Math.round(dayLengthMinutes * 60 * TICKS_PER_SECOND));
  const startMinute = (start.day - 1) * MINUTES_PER_DAY + start.hour * 60 + start.minute;
  return { ticksPerDay, startMinute };
}

/** Absolute game minute during `tick`. */
export const gameMinuteAt = (c: Clock, tick: number): number =>
  c.startMinute + Math.floor((tick * MINUTES_PER_DAY) / c.ticksPerDay);

/** First tick of absolute game minute `minute`. */
export const minuteStartTick = (c: Clock, minute: number): number =>
  Math.max(0, Math.ceil(((minute - c.startMinute) * c.ticksPerDay) / MINUTES_PER_DAY));

export const dayOf = (minute: number): number => Math.floor(minute / MINUTES_PER_DAY) + 1;
export const minuteOfDay = (minute: number): number => minute % MINUTES_PER_DAY;
/** Ticks per game minute (may be fractional for odd day lengths). */
export const ticksPerGameMinute = (c: Clock): number => c.ticksPerDay / MINUTES_PER_DAY;
