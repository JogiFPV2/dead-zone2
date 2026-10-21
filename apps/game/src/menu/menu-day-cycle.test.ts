import type { Color } from 'three';
import { describe, expect, it } from 'vitest';
import type { CompiledPreset } from '../lighting/compiled.js';
import {
  MENU_CYCLE,
  MENU_CYCLE_SECONDS,
  MENU_LIGHT_SCALE,
  MENU_PHASE_START,
  MenuDayCycle,
  lowSunCompensation,
  menuClock,
  parseMenuCycleQuery,
  phaseAt,
  phaseMiddle,
} from './menu-day-cycle.js';

const hex = (c: Color) => c.getHexString();
const lum = (c: Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const snap = (p: CompiledPreset) => ({
  sun: p.directional.color.clone(),
  sunI: p.directional.intensity,
  amb: p.hemisphere.sky.clone(),
  dir: p.directional.offset.clone().normalize(),
});

describe('menu day cycle', () => {
  const cycle = new MenuDayCycle();
  // Sunset / sunrise keyframes: high sun 30°, low sun 18° (compensated to light the ground).
  const HIGH = 0.8 * MENU_LIGHT_SCALE * lowSunCompensation(30);
  const LOW = 0.3 * MENU_LIGHT_SCALE * lowSunCompensation(18);

  it('loops 55 s: day 20, sunset 10, night 15, sunrise 10', () => {
    expect(MENU_CYCLE_SECONDS).toBe(55);
    expect(MENU_PHASE_START).toEqual({ day: 0, sunset: 20, night: 30, sunrise: 45 });
    expect(phaseAt(10)).toBe('day');
    expect(phaseAt(25)).toBe('sunset');
    expect(phaseAt(37.5)).toBe('night');
    expect(phaseAt(50)).toBe('sunrise');
    expect(phaseAt(55)).toBe('day');
    expect(phaseMiddle('night')).toBe(37.5);
  });

  it('uses the Designer colours at the phase anchors', () => {
    const day = cycle.sample(0);
    expect(hex(day.directional.color)).toBe('fff4e0');
    expect(day.directional.intensity).toBeCloseTo(1 * MENU_LIGHT_SCALE);
    expect(hex(day.hemisphere.sky)).toBe('bcd0e0');
    expect(day.hemisphere.intensity).toBeCloseTo(0.55 * MENU_LIGHT_SCALE);
    const d = day.directional.offset;
    expect((Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI).toBeCloseTo(35);

    const sunsetHigh = cycle.sample(22.5);
    expect(hex(sunsetHigh.directional.color)).toBe('ff9a4a');
    expect(sunsetHigh.directional.intensity).toBeCloseTo(HIGH);
    expect(hex(sunsetHigh.hemisphere.sky)).toBe('8a5a6a');
    expect(cycle.sample(28.5).directional.intensity).toBeCloseTo(LOW);

    const night = cycle.sample(37.5);
    expect(hex(night.directional.color)).toBe('7f9cc8');
    expect(night.directional.intensity).toBeCloseTo(0.15 * MENU_LIGHT_SCALE);
    expect(hex(night.hemisphere.sky)).toBe('1c2233');

    expect(hex(cycle.sample(47.5).directional.color)).toBe('ffc89a');
    expect(cycle.sample(47.5).directional.intensity).toBeCloseTo(LOW);
    expect(cycle.sample(53).directional.intensity).toBeCloseTo(HIGH);
    expect(hex(cycle.sample(53).hemisphere.sky)).toBe('a08a9a');
  });

  it('blends smoothly (no jumps) and wraps seamlessly at 55 s', () => {
    let prev = snap(cycle.sample(0));
    const dt = 0.05;
    for (let t = dt; t <= MENU_CYCLE_SECONDS + 1e-9; t += dt) {
      const cur = snap(cycle.sample(t));
      expect(Math.abs(lum(cur.sun) - lum(prev.sun))).toBeLessThan(0.05);
      expect(Math.abs(lum(cur.amb) - lum(prev.amb))).toBeLessThan(0.05);
      expect(Math.abs(cur.sunI - prev.sunI)).toBeLessThan(0.12);
      expect(cur.dir.angleTo(prev.dir)).toBeLessThan(0.1);
      prev = cur;
    }
    const a = snap(cycle.sample(0));
    const b = snap(cycle.sample(MENU_CYCLE_SECONDS));
    expect(a.sunI).toBeCloseTo(b.sunI);
    expect(a.sun.equals(b.sun)).toBe(true);
  });

  it('interpolates colours in linear space with smoothstep', () => {
    // Halfway between the two sunset keyframes (22.5 → 28.5): smoothstep(0.5) = 0.5 linear mix.
    const mid = cycle.sample(25.5).directional.intensity;
    expect(mid).toBeCloseTo((HIGH + LOW) / 2);
    // A quarter in: smoothstep(0.25) = 0.15625, not 0.25.
    const q = cycle.sample(22.5 + 1.5).directional.intensity;
    expect(q).toBeCloseTo(HIGH + (LOW - HIGH) * 0.15625);
  });

  it('lights the lamps mid-sunset and puts them out in the first third of sunrise', () => {
    expect(cycle.lampLevel(10)).toBe(0);
    expect(cycle.lampLevel(23.9)).toBe(0);
    expect(cycle.lampLevel(25.25)).toBeCloseTo(0.5);
    expect(cycle.lampLevel(27)).toBe(1);
    expect(cycle.lampLevel(37.5)).toBe(1);
    expect(cycle.lampLevel(45 + 10 / 6)).toBeCloseTo(0.5);
    expect(cycle.lampLevel(45 + 10 / 3)).toBe(0);
    expect(cycle.lampLevel(50)).toBe(0);
  });

  it('drives any lighting target and allocates one reused preset', () => {
    const calls: [CompiledPreset, number][] = [];
    const target = { applyCompiled: (p: CompiledPreset, l: number) => calls.push([p, l]) };
    cycle.apply(target, 37.5);
    cycle.apply(target, 10);
    expect(calls[0]![1]).toBe(1);
    expect(calls[1]![1]).toBe(0);
    expect(calls[0]![0]).toBe(calls[1]![0]);
  });

  it('clock: debug time, speed and reduced motion', () => {
    expect(menuClock()(12_000)).toBeCloseTo(12);
    expect(menuClock()(60_000)).toBeCloseTo(5);
    expect(menuClock({ fixed: 25 })(99_000)).toBe(25);
    expect(menuClock({ speed: 5 })(2_000)).toBeCloseTo(10);
    expect(menuClock({ reducedMotion: () => true })(1_000)).toBe(MENU_CYCLE.reducedMotionTime);
    expect(parseMenuCycleQuery('?menuTime=37.5&menuSpeed=4')).toEqual({ fixed: 37.5, speed: 4 });
    expect(parseMenuCycleQuery('?menuTime=abc&menuSpeed=0')).toEqual({});
    expect(parseMenuCycleQuery('?menuTime=99')).toEqual({});
    expect(parseMenuCycleQuery('')).toEqual({});
  });

  it('scales a low sun up so it still lights the ground (1 at ≥ 35°, at most ×2)', () => {
    expect(lowSunCompensation(35)).toBe(1);
    expect(lowSunCompensation(54)).toBe(1);
    expect(lowSunCompensation(18)).toBeGreaterThan(1.5);
    expect(lowSunCompensation(2)).toBe(2);
    // Mid sunset is lit by the sun more than the night by the moon.
    const ground = (t: number) => {
      const d = cycle.sample(t).directional;
      return d.intensity * (d.offset.y / d.offset.length());
    };
    expect(ground(25)).toBeGreaterThan(ground(37.5) * 2);
  });

  it('rejects unsorted keyframes', () => {
    const k = MENU_CYCLE.keyframes;
    expect(() => new MenuDayCycle({ ...MENU_CYCLE, keyframes: [k[1]!, k[0]!] })).toThrow();
  });
});
