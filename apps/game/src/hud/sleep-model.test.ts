import type { ClockView, SleepView } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatRealSec,
  gameSpeedRatio,
  sleepScreenVM,
  wakeEstimate,
} from './sleep-model.js';
import { DEFAULT_SLEEP_SETTINGS, readSleepSettings } from './sleep-settings.js';

const sleep = (s: Partial<SleepView> = {}): SleepView => ({
  sleeping: true,
  sleepStartTick: 1000,
  surface: 'bed',
  restCap: 50,
  restGained: 0,
  realSec: 72,
  saveAfterRealSec: 120,
  saveReady: false,
  ...s,
});
const clock: ClockView = {
  day: 12,
  minuteOfDay: 22 * 60,
  ticksPerGameMinute: 50,
  minuteStartTick: 0,
  fastForwardBlocked: false,
  timeScale: 4,
};
const cfg = DEFAULT_SLEEP_SETTINGS;

describe('sleep model', () => {
  it('formats real seconds and the clock', () => {
    expect(formatRealSec(72)).toBe('1:12');
    expect(formatRealSec(120)).toBe('2:00');
    expect(formatClock(13 * 1440 + 6 * 60 + 10)).toBe('06:10');
    expect(formatClock(-10)).toBe('23:50');
  });

  it('game / real speed ratio from ticks per game minute and timeScale', () => {
    expect(gameSpeedRatio({ ticksPerGameMinute: 50, timeScale: 1 })).toBe(24);
    expect(gameSpeedRatio({ ticksPerGameMinute: 50, timeScale: 4 })).toBe(96);
    expect(gameSpeedRatio({ ticksPerGameMinute: 50 })).toBe(24);
  });

  it('wake estimate: place limit at the base rate before 10 game minutes', () => {
    const e = wakeEstimate(sleep(), 78, 1000, 50, cfg);
    expect(e.fatigueStart).toBe(78);
    expect(e.fatigueEnd).toBe(28);
    expect(e.remainingMin).toBeCloseTo(500); // 50 points at 0.1 / min
  });

  it('wake estimate: measured rate, wakeAtFatigue floor, max duration', () => {
    // 60 game minutes slept, 3 points gained → 0.05 / min.
    const e = wakeEstimate(sleep({ restGained: 3 }), 10, 1000 + 60 * 50, 50, cfg);
    expect(e.fatigueStart).toBe(13);
    expect(e.fatigueEnd).toBe(cfg.wakeAtFatigue);
    expect(e.remainingMin).toBeCloseTo(160);
    const slow = wakeEstimate(sleep({ restGained: 0.1 }), 90, 1000 + 600 * 50, 50, cfg);
    expect(slow.elapsedMin + slow.remainingMin).toBeCloseTo(cfg.maxDurationMin);
  });

  it('screen VM: ring, save box, rows, wake note', () => {
    const vm = sleepScreenVM({
      sleep: sleep({ restGained: 30 }),
      clock,
      fatigue: 48,
      hungerGain: 9.2,
      thirstGain: 14,
      threat: 0,
      tick: 1000 + 300 * 50,
      cfg,
    });
    expect(vm.title).toBe('Śpisz · Łóżko');
    expect(vm.safe).toBe(true);
    expect(vm.real).toEqual({ text: '1:12', total: '/ 2:00', pct: 0.6 });
    expect(vm.game.time).toBe('22:00');
    expect(vm.game.ratio).toBe('×96');
    expect(vm.game.from).toBe('17:00');
    expect(vm.save.ready).toBe(false);
    expect(vm.save.detail).toMatch(/^jeszcze 0:48/);
    expect(vm.rows.map((r) => [r.label, r.value])).toEqual([
      ['Zmęczenie', '78 → 28'],
      ['Zmęczenie teraz', '48'],
      ['Limit łóżka', '−50'],
      ['Głód i pragnienie', '+9 / +14'],
      ['Pobudka', '01:20 · Dzień 13'],
    ]);
    expect(vm.wakeNote).toEqual({
      text: '▲ bez zapisu, odpoczynek częściowy (−30 teraz)',
      tone: 'warn',
    });
    expect(vm.speed).toBe(4);
  });

  it('screen VM after the save and under threat', () => {
    const vm = sleepScreenVM({
      sleep: sleep({ surface: 'floor', restCap: 25, realSec: 130, saveReady: true }),
      clock: { ...clock, fastForwardBlocked: true, timeScale: 1 },
      fatigue: 60,
      hungerGain: 0,
      thirstGain: 0,
      threat: 40,
      tick: 1000,
      cfg,
    });
    expect(vm.real.pct).toBe(1);
    expect(vm.real.text).toBe('2:00');
    expect(vm.save.title).toBe('Gra zapisana');
    expect(vm.safe).toBe(false);
    expect(vm.rows[2]?.label).toBe('Limit podłogi');
    expect(vm.wakeNote.tone).toBe('ok');
    expect(vm.speedBlocked).toBe(true);
  });

  it('reads sleep settings from world settings JSON', () => {
    const s = readSleepSettings({
      survival: {
        sleep: { minFatigueToSleep: 40, surfaces: { bed: { maxRecoveryPerSleep: 60 } } },
        leisure: { tvRadiusTiles: 2 },
      },
    });
    expect(s?.minFatigueToSleep).toBe(40);
    expect(s?.surfaces.bed).toEqual({ ratePerMin: 0.1, cap: 60 });
    expect(s?.surfaces.sofa.cap).toBe(35);
    expect(s?.tvRadiusTiles).toBe(2);
    expect(readSleepSettings({ survival: {} })).toBeUndefined();
  });
});
