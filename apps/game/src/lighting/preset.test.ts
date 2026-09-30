import { describe, expect, it } from 'vitest';
import {
  NIGHT_PRESET,
  SPEC_CAMERA_DISTANCE,
  blendPresets,
  fogRange,
  lerp,
  lerpColor,
  lerpPreset,
  smoothstep,
  type LightingPreset,
} from './preset.js';

/** A made-up second preset (the day look is not approved yet): only for blend tests. */
const OTHER: LightingPreset = {
  ...NIGHT_PRESET,
  exposure: 1,
  background: '#ffffff',
  fog: { color: '#7d8588', near: 62, far: 135 },
  hemisphere: { sky: '#c3ccd2', ground: '#4a4f44', intensity: 1.9 },
  directional: { ...NIGHT_PRESET.directional, offset: { x: -25, y: 60, z: 15 }, shadowRadius: 10 },
  lamps: { ...NIGHT_PRESET.lamps, intensity: 0, glow: 0 },
};

describe('smoothstep', () => {
  it('is clamped, symmetric and eases', () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.25)).toBeCloseTo(0.15625);
    expect(smoothstep(0.25) + smoothstep(0.75)).toBeCloseTo(1);
  });
});

describe('lerpColor', () => {
  it('returns the ends at t = 0 and 1', () => {
    expect(lerpColor('#0d1112', '#7d8588', 0)).toBe('#0d1112');
    expect(lerpColor('#0d1112', '#7d8588', 1)).toBe('#7d8588');
  });

  it('interpolates in linear space, not in sRGB', () => {
    // Linear 0.5 grey is sRGB ≈ 0.735 (#bc), brighter than the naive sRGB midpoint #80.
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#bcbcbc');
  });
});

describe('lerpPreset', () => {
  it('returns the same presets at the ends and clamps t', () => {
    expect(lerpPreset(NIGHT_PRESET, OTHER, 0)).toBe(NIGHT_PRESET);
    expect(lerpPreset(NIGHT_PRESET, OTHER, 1)).toBe(OTHER);
    expect(lerpPreset(NIGHT_PRESET, OTHER, -3)).toBe(NIGHT_PRESET);
    expect(lerpPreset(NIGHT_PRESET, OTHER, 7)).toBe(OTHER);
  });

  it('lerps every scalar and nested vector linearly', () => {
    const m = lerpPreset(NIGHT_PRESET, OTHER, 0.5);
    expect(m.exposure).toBeCloseTo(1.125);
    expect(m.fog.near).toBeCloseTo(61);
    expect(m.fog.far).toBeCloseTo(122.5);
    expect(m.hemisphere.intensity).toBeCloseTo(1.575);
    expect(m.directional.offset).toEqual({ x: -27.5, y: 55, z: 17.5 });
    expect(m.directional.shadowRadius).toBeCloseTo(7);
    expect(m.lamps.intensity).toBeCloseTo(35);
    expect(m.lamps.angle).toBeCloseTo(NIGHT_PRESET.lamps.angle);
    expect(m.hemisphere.sky).toBe(lerpColor('#7890a4', '#c3ccd2', 0.5));
  });

  it('keeps the preset shape (no missing or extra keys)', () => {
    const keys = (o: object): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v ? keys(v as object).map((s) => `${k}.${s}`) : [k],
      );
    expect(keys(lerpPreset(NIGHT_PRESET, OTHER, 0.3)).sort()).toEqual(keys(NIGHT_PRESET).sort());
  });

  it('does not mutate its inputs', () => {
    const before = JSON.stringify(NIGHT_PRESET);
    lerpPreset(NIGHT_PRESET, OTHER, 0.4);
    expect(JSON.stringify(NIGHT_PRESET)).toBe(before);
  });
});

describe('blendPresets', () => {
  it('applies smoothstep to t (spec 4.3)', () => {
    const b = blendPresets(NIGHT_PRESET, OTHER, 0.25);
    expect(b.exposure).toBeCloseTo(lerp(1.25, 1, smoothstep(0.25)));
    expect(blendPresets(NIGHT_PRESET, OTHER, 0.5).exposure).toBeCloseTo(1.125);
  });
});

describe('NIGHT_PRESET', () => {
  it('matches the approved spec values (4.1)', () => {
    expect(NIGHT_PRESET.exposure).toBe(1.25);
    expect(NIGHT_PRESET.background).toBe('#0d1112');
    expect(NIGHT_PRESET.fog).toEqual({ color: '#0d1214', near: 60, far: 110 });
    expect(NIGHT_PRESET.hemisphere).toEqual({ sky: '#7890a4', ground: '#262b24', intensity: 1.25 });
    expect(NIGHT_PRESET.directional).toMatchObject({
      color: '#a8bcd8',
      intensity: 1.5,
      offset: { x: -30, y: 50, z: 20 },
      shadowRadius: 4,
    });
    expect(NIGHT_PRESET.lamps).toMatchObject({
      color: '#ff9a45',
      intensity: 70,
      distance: 16,
      penumbra: 0.75,
      decay: 1.6,
      bulbEmissive: '#ffc070',
      bulbEmissiveIntensity: 3,
    });
    expect(NIGHT_PRESET.lamps.angle).toBeCloseTo(Math.PI / 3.2);
  });
});

describe('fogRange', () => {
  it('keeps the reference fog at the reference distance', () => {
    expect(fogRange(NIGHT_PRESET.fog, SPEC_CAMERA_DISTANCE)).toEqual({ near: 60, far: 110 });
  });

  it('shifts with the camera distance so fog around the target stays the same', () => {
    expect(fogRange(NIGHT_PRESET.fog, 100)).toEqual({ near: 80, far: 130 });
  });
});
