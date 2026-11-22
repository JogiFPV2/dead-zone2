import { NIGHT_PRESET, type LightingPreset, type Vec3Like } from './preset.js';

/**
 * Day/night cycle tuning in one place. NIGHT is approved (spec 4.1). DAWN and DUSK follow
 * Pawel's direction (2026-11-22): dawn more orange but not overdone, dusk more navy blue.
 * DAY is still a placeholder (spec 4.2) — tune them here only.
 * Minutes are minutes of the game day (0..1439).
 */
const at = (h: number, m = 0): number => h * 60 + m;

const withSun = (p: LightingPreset, offset: Vec3Like, intensity?: number): LightingPreset => ({
  ...p,
  directional: { ...p.directional, offset, ...(intensity !== undefined ? { intensity } : {}) },
});

/** Dawn: low sun in the east, moderately orange (warm but not saturated). */
export const DAWN_PRESET: LightingPreset = {
  ...NIGHT_PRESET,
  exposure: 1.2,
  background: '#86705f',
  fog: { color: '#8c7464', near: 70, far: 160 },
  hemisphere: { sky: '#d6b89e', ground: '#4c3e30', intensity: 2.2 },
  directional: {
    color: '#ffa461',
    intensity: 3.2,
    offset: { x: 70, y: 35, z: -20 },
    shadowRadius: 3,
    shadowIntensity: 0.9,
  },
};

/** PLACEHOLDER: neutral overcast-ish daylight, sun high. */
export const DAY_PRESET: LightingPreset = {
  ...NIGHT_PRESET,
  exposure: 1,
  background: '#9fb4c4',
  fog: { color: '#aebdc8', near: 90, far: 220 },
  hemisphere: { sky: '#cfe0f0', ground: '#5a5448', intensity: 1.6 },
  directional: {
    color: '#fff2dc',
    intensity: 3,
    offset: { x: 20, y: 80, z: -10 },
    shadowRadius: 2,
    shadowIntensity: 0.85,
  },
};

/** Dusk: navy blue sky and shade, the last sun light cooled towards lavender. */
export const DUSK_PRESET: LightingPreset = {
  ...NIGHT_PRESET,
  exposure: 1.2,
  background: '#2c3a5e',
  fog: { color: '#313f64', near: 70, far: 160 },
  hemisphere: { sky: '#8296cc', ground: '#363a50', intensity: 2.6 },
  directional: {
    color: '#cdb8cf',
    intensity: 3,
    offset: { x: -70, y: 30, z: 20 },
    shadowRadius: 3,
    shadowIntensity: 0.9,
  },
};

export interface DayKeyframe {
  minute: number;
  preset: LightingPreset;
}

export interface LampSchedule {
  /** Lamps start fading in at `on` and out at `off` (wraps over midnight). */
  on: number;
  off: number;
  /** Fade length in game minutes (60-min day: 1 game minute = 1 real second). */
  fadeMinutes: number;
}

export interface DayCycleConfig {
  /** Sorted by minute; blended with smoothstep between neighbours, wrapping at midnight. */
  keyframes: readonly DayKeyframe[];
  lamps: LampSchedule;
  /** Look used before the sim sends its clock (e.g. no survival content, `?crowd`). */
  fallbackMinute: number;
}

export const DAY_CYCLE: DayCycleConfig = {
  keyframes: [
    { minute: at(0), preset: NIGHT_PRESET },
    { minute: at(4, 45), preset: NIGHT_PRESET },
    { minute: at(6), preset: DAWN_PRESET },
    { minute: at(8), preset: withSun(DAY_PRESET, { x: 50, y: 60, z: -20 }, 2.6) },
    { minute: at(12), preset: DAY_PRESET },
    { minute: at(17), preset: withSun(DAY_PRESET, { x: -45, y: 60, z: 15 }, 2.6) },
    { minute: at(19), preset: DUSK_PRESET },
    { minute: at(20, 30), preset: NIGHT_PRESET },
  ],
  lamps: { on: at(18, 45), off: at(6, 20), fadeMinutes: 8 },
  fallbackMinute: at(0),
};
