import type { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { compilePreset, mixCompiled } from './compiled.js';
import { DAY_CYCLE, DAY_PRESET, DUSK_PRESET } from './day-cycle-config.js';
import { DayCycle, lampLevel, segmentAt, wrapMinute } from './day-cycle.js';
import { clockMinute, formatMinute, overrideMinute, parseTimeParam } from './game-clock.js';
import { NIGHT_PRESET, lerpPreset } from './preset.js';

const hex = (c: Color) => `#${c.getHexString()}`;

describe('segmentAt', () => {
  const mins = [0, 360, 720, 1140];
  it('finds the surrounding keyframes and progress', () => {
    expect(segmentAt(mins, 540)).toEqual({ from: 1, to: 2, t: 0.5 });
    expect(segmentAt(mins, 360)).toEqual({ from: 1, to: 2, t: 0 });
  });
  it('wraps past the last keyframe to the first (midnight)', () => {
    const s = segmentAt(mins, 1140 + 150);
    expect(s.from).toBe(3);
    expect(s.to).toBe(0);
    expect(s.t).toBeCloseTo(150 / 300);
    expect(segmentAt([60, 600], 30)).toMatchObject({ from: 1, to: 0 });
  });
  it('wrapMinute handles negatives and overflow', () => {
    expect(wrapMinute(-10)).toBe(1430);
    expect(wrapMinute(1445)).toBe(5);
  });
});

describe('lampLevel', () => {
  const s = { on: 18 * 60 + 45, off: 6 * 60 + 20, fadeMinutes: 8 };
  it('is on at night, off at day, fading smoothly around the switch times', () => {
    expect(lampLevel(0, s)).toBe(1);
    expect(lampLevel(23 * 60, s)).toBe(1);
    expect(lampLevel(12 * 60, s)).toBe(0);
    expect(lampLevel(s.on + 4, s)).toBeCloseTo(0.5);
    expect(lampLevel(s.off + 4, s)).toBeCloseTo(0.5);
    expect(lampLevel(s.on + 8, s)).toBe(1);
    expect(lampLevel(s.off + 8, s)).toBe(0);
  });
});

describe('mixCompiled', () => {
  it('matches the hex-based lerpPreset and allocates nothing (writes into out)', () => {
    const out = compilePreset(NIGHT_PRESET);
    const a = compilePreset(NIGHT_PRESET);
    const b = compilePreset(DAY_PRESET);
    const r = mixCompiled(out, a, b, 0.3);
    expect(r).toBe(out);
    const ref = lerpPreset(NIGHT_PRESET, DAY_PRESET, 0.3);
    expect(hex(r.background)).toBe(ref.background);
    expect(hex(r.hemisphere.sky)).toBe(ref.hemisphere.sky);
    expect(r.directional.intensity).toBeCloseTo(ref.directional.intensity);
    expect(r.directional.offset.x).toBeCloseTo(ref.directional.offset.x);
    expect(r.fog.near).toBeCloseTo(ref.fog.near);
  });
});

describe('DayCycle', () => {
  const cycle = new DayCycle(DAY_CYCLE);

  it('hits the keyframes exactly and reuses one output object', () => {
    const noon = cycle.sample(12 * 60);
    expect(hex(noon.background)).toBe(DAY_PRESET.background);
    expect(noon.directional.intensity).toBe(DAY_PRESET.directional.intensity);
    expect(cycle.sample(19 * 60)).toBe(noon);
    expect(hex(cycle.sample(19 * 60).directional.color)).toBe(DUSK_PRESET.directional.color);
    expect(hex(cycle.sample(23 * 60).background)).toBe(NIGHT_PRESET.background);
    expect(cycle.sample(2 * 60).exposure).toBe(NIGHT_PRESET.exposure);
  });

  it('is continuous: no jumps between neighbouring seconds across the whole day', () => {
    let prev = cycle.sample(0).directional.intensity;
    let maxStep = 0;
    for (let m = 1 / 60; m < 1440; m += 1 / 60) {
      const v = cycle.sample(m).directional.intensity;
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(maxStep).toBeLessThan(0.01);
  });

  it('rejects unsorted keyframes', () => {
    expect(
      () =>
        new DayCycle({
          ...DAY_CYCLE,
          keyframes: [
            { minute: 10, preset: NIGHT_PRESET },
            { minute: 5, preset: DAY_PRESET },
          ],
        }),
    ).toThrow(/posortowane/);
  });
});

describe('game clock', () => {
  const clock = {
    day: 1,
    minuteOfDay: 540,
    ticksPerGameMinute: 50,
    minuteStartTick: 1000,
    fastForwardBlocked: false,
  };
  it('interpolates between clock views from the snapshot tick, clamped', () => {
    expect(clockMinute(clock, 1025)).toBeCloseTo(540.5);
    expect(clockMinute(clock, 900)).toBe(540);
    expect(clockMinute(clock, 5000)).toBe(542);
    expect(clockMinute({ ...clock, minuteOfDay: 1439 }, 1100)).toBeCloseTo(1);
  });
  it('dev override: fixed or fast-forwarded', () => {
    expect(overrideMinute(360, 0, 99_999)).toBe(360);
    expect(overrideMinute(1430, 60, 1000)).toBe(50);
  });
  it('parses and formats HH:MM', () => {
    expect(parseTimeParam('06:00')).toBe(360);
    expect(parseTimeParam('7:05')).toBe(425);
    expect(parseTimeParam('24:00')).toBeUndefined();
    expect(parseTimeParam(null)).toBeUndefined();
    expect(formatMinute(1439.9)).toBe('23:59');
  });
});
