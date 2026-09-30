import { NIGHT_PRESET, type LightingPreset, type Vec3Like } from './preset.js';

/**
 * Day/night cycle tuning in one place. NIGHT is approved (spec 4.1); DAWN, DAY and DUSK are
 * PLACEHOLDERS until Designer approves the daytime look (spec 4.2) — tune them here only.
 * Minutes are minutes of the game day (0..1439).
 */
const at = (h: number, m = 0): number => h * 60 + m;

const withSun = (p: LightingPreset, offset: Vec3Like, intensity?: number): LightingPreset => ({
  ...p,
  directional: { ...p.directional, offset, ...(intensity !== undefined ? { intensity } : {}) },
});

/** PLACEHOLDER: low warm sun in the east. */
export const DAWN_PRESET: LightingPreset = {
  ...NIGHT_PRESET,
  exposure: 1.2,
  background: '#6a6470',
  fog: { color: '#736a70', near: 70, far: 160 },
  hemisphere: { sky: '#c0b4c0', ground: '#4a4034', intensity: 2.2 },
  directional: {
    color: '#ffb07a',
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

/** PLACEHOLDER: low red-orange sun in the west. */
export const DUSK_PRESET: LightingPreset = {
  ...NIGHT_PRESET,
  exposure: 1.2,
  background: '#6a5058',
  fog: { color: '#70565a', near: 70, far: 160 },
  hemisphere: { sky: '#c8a8a8', ground: '#4a3a2e', intensity: 2 },
  directional: {
    color: '#ff9a5a',
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
