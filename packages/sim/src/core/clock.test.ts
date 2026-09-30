import { describe, expect, it } from 'vitest';
import { survivalSim, TICKS_PER_MIN } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { createSim } from '../sim.js';
import { createClock, dayOf, gameMinuteAt, minuteOfDay, minuteStartTick } from './clock.js';

describe('clock', () => {
  it('60-minute day: 72 000 ticks per day, 50 ticks per game minute, starts day 1 09:00', () => {
    const c = createClock(60);
    expect(c.ticksPerDay).toBe(72_000);
    expect(gameMinuteAt(c, 0)).toBe(9 * 60);
    expect(gameMinuteAt(c, 49)).toBe(540);
    expect(gameMinuteAt(c, 50)).toBe(541);
    expect(minuteStartTick(c, 541)).toBe(50);
    expect(dayOf(1439)).toBe(1);
    expect(dayOf(1440)).toBe(2);
    expect(minuteOfDay(1440 + 61)).toBe(61);
  });

  it('odd day lengths still map every tick to one minute', () => {
    const c = createClock(0.75, { day: 3, hour: 23, minute: 59 }); // 900 ticks per day
    expect(c.startMinute).toBe(2 * 1440 + 23 * 60 + 59);
    for (let t = 0; t < 2000; t++) {
      const m = gameMinuteAt(c, t);
      expect(minuteStartTick(c, m)).toBeLessThanOrEqual(t);
      expect(minuteStartTick(c, m + 1)).toBeGreaterThan(t);
    }
  });

  it('uses worldSettings.dayLengthMinutes and emits dayPassed at midnight', () => {
    const sim = survivalSim(undefined, { clockStart: { day: 1, hour: 23, minute: 58 } });
    expect(sim.gameTime()).toEqual({ minute: 1438, day: 1, minuteOfDay: 1438 });
    for (let i = 0; i <= 2 * TICKS_PER_MIN; i++) sim.step();
    const passed = sim.drainEvents().filter((e) => e.type === 'dayPassed');
    expect(passed).toEqual([{ type: 'dayPassed', tick: 2 * TICKS_PER_MIN, day: 2 }]);
    expect(sim.gameTime().day).toBe(2);
  });

  it('works without content (default 60-minute day)', () => {
    const sim = createSim({ seed: 1, map: buildMap() });
    for (let i = 0; i < 100; i++) sim.step();
    expect(sim.gameTime().minute).toBe(541);
    expect(sim.getSurvival()).toBeUndefined();
    expect(sim.fastForwardBlocked()).toBe(false);
  });
});
