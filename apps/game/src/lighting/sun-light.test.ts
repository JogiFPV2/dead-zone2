import { sunAt } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { compilePreset } from './compiled.js';
import { DAY_PRESET } from './day-cycle-config.js';
import { NIGHT_PRESET } from './preset.js';
import { shadowDepthPadding } from './scene-lighting.js';
import { SUN_LIGHT, applySun, sunForClock } from './sun-light.js';

const DAY1 = 184; // game day 1 = 3 July (HUD calendar)

describe('applySun', () => {
  it('day: light comes from the sun (east in the morning, west in the afternoon)', () => {
    const am = compilePreset(DAY_PRESET);
    const pm = compilePreset(DAY_PRESET);
    applySun(am, sunAt(9, DAY1));
    applySun(pm, sunAt(17, DAY1));
    expect(am.directional.offset.x).toBeGreaterThan(0); // +X = east
    expect(pm.directional.offset.x).toBeLessThan(0);
    // Afternoon sun is lower → longer shadows (smaller y relative to horizontal).
    const slope = (o: { x: number; y: number; z: number }) => o.y / Math.hypot(o.x, o.z);
    expect(slope(pm.directional.offset)).toBeLessThan(slope(am.directional.offset));
  });

  it('noon: sun in the south (+Z), shadows point north', () => {
    const c = compilePreset(DAY_PRESET);
    applySun(c, sunAt(12, DAY1));
    expect(c.directional.offset.z).toBeGreaterThan(0);
    expect(Math.abs(c.directional.offset.x)).toBeLessThan(1e-6);
  });

  it('daytime shadow is clear (hiding in it, Pawel 2026-11-21) and soft', () => {
    const c = compilePreset(DAY_PRESET);
    expect(applySun(c, sunAt(12, DAY1))).toBe(1);
    expect(c.directional.shadowIntensity).toBe(SUN_LIGHT.shadowIntensity);
    expect(c.directional.shadowIntensity).toBeGreaterThanOrEqual(0.6);
    expect(c.directional.shadowRadius).toBe(SUN_LIGHT.shadowRadius);
  });

  it('never lower than minElevationDeg (caps shadow length)', () => {
    const c = compilePreset(DAY_PRESET);
    applySun(c, sunAt(19.5, DAY1)); // sun ~3° up
    const o = c.directional.offset;
    const el = Math.atan2(o.y, Math.hypot(o.x, o.z)) * (180 / Math.PI);
    expect(el).toBeCloseTo(SUN_LIGHT.minElevationDeg, 6);
    expect(c.directional.shadowIntensity).toBeLessThan(SUN_LIGHT.shadowIntensity * 0.25);
  });

  it('night: moon light untouched, sun shadow off', () => {
    const c = compilePreset(NIGHT_PRESET);
    const before = c.directional.offset.clone();
    expect(applySun(c, sunAt(0, DAY1))).toBe(0);
    expect(c.directional.offset).toEqual(before);
    expect(c.directional.shadowIntensity).toBe(NIGHT_PRESET.directional.shadowIntensity);
  });

  it('no shadow at all around the horizon (sun → moon switch invisible)', () => {
    for (let t = 19; t < 21.5; t += 1 / 60) {
      const s = sunAt(t, DAY1);
      const deg = (s.elevation * 180) / Math.PI;
      if (Math.abs(deg) > 2) continue;
      const c = compilePreset(DAY_PRESET);
      applySun(c, s);
      expect(c.directional.shadowIntensity).toBeCloseTo(0, 9);
    }
  });

  it('allocation-free: writes into the given preset', () => {
    const c = compilePreset(DAY_PRESET);
    const ref = c.directional.offset;
    applySun(c, sunAt(10, DAY1));
    expect(c.directional.offset).toBe(ref);
  });
});

describe('sunForClock', () => {
  it('minute of day + game day 1 = 9 July', () => {
    expect(sunForClock(9 * 60, 1)).toEqual(sunAt(9, DAY1));
    expect(sunForClock(17 * 60 + 30, 3)).toEqual(sunAt(17.5, DAY1 + 2));
  });
});

describe('shadowDepthPadding', () => {
  it('grows for a low sun, default for a high light', () => {
    expect(shadowDepthPadding(0.9)).toBe(20);
    expect(shadowDepthPadding(Math.sin((12 * Math.PI) / 180))).toBeGreaterThan(38);
  });
});
