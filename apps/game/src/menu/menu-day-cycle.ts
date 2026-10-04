import { compilePreset, mixCompiled, type CompiledPreset } from '../lighting/compiled.js';
import { NIGHT_PRESET, smoothstep, type Hex, type LightingPreset } from '../lighting/preset.js';

/**
 * Main-menu background day cycle (Designer, Paweł): a 55 s loop — day 20 s, sunset 10 s,
 * night 15 s, sunrise 10 s. Independent of the scene: it only produces a `CompiledPreset` and a
 * street-lamp level, so it drives any `WorldLighting` (today the test-town crossroads, later the
 * Stalowa Wola cut-out) via `applyCompiled(preset, lampLevel)`. Colours blend in linear space
 * with smoothstep between keyframes; per-frame sampling allocates nothing.
 */

export type MenuPhase = 'day' | 'sunset' | 'night' | 'sunrise';

/** Phase lengths in seconds, in loop order. */
export const MENU_PHASES: readonly { readonly phase: MenuPhase; readonly seconds: number }[] = [
  { phase: 'day', seconds: 20 },
  { phase: 'sunset', seconds: 10 },
  { phase: 'night', seconds: 15 },
  { phase: 'sunrise', seconds: 10 },
];
export const MENU_CYCLE_SECONDS = MENU_PHASES.reduce((s, p) => s + p.seconds, 0);

/** Start second of each phase within the loop. */
export const MENU_PHASE_START: Readonly<Record<MenuPhase, number>> = (() => {
  const out = {} as Record<MenuPhase, number>;
  let t = 0;
  for (const p of MENU_PHASES) {
    out[p.phase] = t;
    t += p.seconds;
  }
  return out;
})();

/** Middle of a phase (used for the review screenshots). */
export const phaseMiddle = (phase: MenuPhase): number =>
  MENU_PHASE_START[phase] + MENU_PHASES.find((p) => p.phase === phase)!.seconds / 2;

/** Second in [0, MENU_CYCLE_SECONDS). */
export const wrapCycle = (t: number, period = MENU_CYCLE_SECONDS): number =>
  ((t % period) + period) % period;

export function phaseAt(t: number): MenuPhase {
  const x = wrapCycle(t);
  let start = 0;
  for (const p of MENU_PHASES) {
    if (x < start + p.seconds) return p.phase;
    start += p.seconds;
  }
  return 'day';
}

/**
 * Designer's intensities are relative (sun 1.0 = full day). The renderer runs ACES with
 * physically-scaled lights, where the approved day sun is ≈3, so both the directional light and
 * the hemisphere fill are scaled by this factor (day: sun 3.0, fill 1.65 — the same ratio).
 */
export const MENU_LIGHT_SCALE = 3;

/** Light offset (relative to the followed target) for azimuth/elevation in degrees. */
export function sunOffset(azimuthDeg: number, elevationDeg: number, distance = 80) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const h = Math.cos(el) * distance;
  return { x: Math.cos(az) * h, y: Math.sin(el) * distance, z: Math.sin(az) * h };
}

interface Look {
  sun: Hex;
  /** Relative (Designer) intensity, ×MENU_LIGHT_SCALE. */
  sunIntensity: number;
  azimuth: number;
  elevation: number;
  ambient: Hex;
  ambientIntensity: number;
  ground: Hex;
  sky: Hex;
  /** Fog near/far at the reference camera distance (see `LightingPreset.fog`). */
  fogNear: number;
  fogFar: number;
  exposure: number;
  shadowRadius: number;
  shadowIntensity: number;
}

function look(l: Look): LightingPreset {
  return {
    ...NIGHT_PRESET,
    exposure: l.exposure,
    background: l.sky,
    fog: { color: l.sky, near: l.fogNear, far: l.fogFar },
    hemisphere: {
      sky: l.ambient,
      ground: l.ground,
      intensity: l.ambientIntensity * MENU_LIGHT_SCALE,
    },
    directional: {
      color: l.sun,
      intensity: l.sunIntensity * MENU_LIGHT_SCALE,
      offset: sunOffset(l.azimuth, l.elevation),
      shadowRadius: l.shadowRadius,
      shadowIntensity: l.shadowIntensity,
    },
    // Lamp look stays the approved night one; only its level (on/off) follows the cycle.
    lamps: NIGHT_PRESET.lamps,
  };
}

/** Day (Designer): sun #fff4e0 ×1.0, sky/ambient #bcd0e0 ×0.55, long shadows at ~35°. */
const DAY = {
  sun: '#fff4e0',
  sunIntensity: 1,
  elevation: 35,
  ambient: '#bcd0e0',
  ambientIntensity: 0.55,
  ground: '#5a5448',
  sky: '#aebdc8',
  fogNear: 90,
  fogFar: 220,
  exposure: 1.2,
  shadowRadius: 2,
  shadowIntensity: 0.85,
} as const;
/** Sunset: sun #ff9a4a 0.8 → 0.3, ambient #8a5a6a. */
const SUNSET = {
  ...DAY,
  sun: '#ff9a4a',
  ambient: '#8a5a6a',
  ground: '#3e3030',
  sky: '#6a5058',
  fogNear: 70,
  fogFar: 160,
  // Low sun: a little more fill and exposure so the street does not sink into the vignette.
  ambientIntensity: 0.75,
  exposure: 1.4,
  shadowRadius: 3,
  shadowIntensity: 0.9,
} as const;
/** Night: moon #7f9cc8 ×0.15, ambient #1c2233, lamps on. */
const NIGHT = {
  ...DAY,
  sun: '#7f9cc8',
  sunIntensity: 0.15,
  azimuth: 146,
  elevation: 54,
  ambient: '#1c2233',
  // Designer gives no night fill strength; #1c2233 at the day 0.55 would be pitch black, so the
  // fill is raised to keep the street readable between the lamp pools.
  ambientIntensity: 3,
  ground: '#141814',
  sky: '#0d1214',
  fogNear: NIGHT_PRESET.fog.near,
  fogFar: NIGHT_PRESET.fog.far,
  exposure: 1.25,
  shadowRadius: 4,
  shadowIntensity: 1,
} as const;
/** Sunrise: sun #ffc89a 0.3 → 0.8, ambient #a08a9a. */
const SUNRISE = {
  ...SUNSET,
  sun: '#ffc89a',
  ambient: '#a08a9a',
  ground: '#40383a',
  sky: '#7a6c78',
} as const;

export interface MenuKeyframe {
  /** Second within the loop, ascending; the last one blends back into the first. */
  at: number;
  preset: LightingPreset;
}

export interface MenuLampSchedule {
  /** Fade-in window (s): Designer — lamps light up around the middle of the sunset. */
  onFrom: number;
  onTo: number;
  /** Fade-out window (s): Designer — lamps go out within the first third of the sunrise. */
  offFrom: number;
  offTo: number;
}

export interface MenuCycleConfig {
  period: number;
  keyframes: readonly MenuKeyframe[];
  lamps: MenuLampSchedule;
  /** Held when the user prefers reduced motion. */
  reducedMotionTime: number;
}

const S = MENU_PHASE_START;
export const MENU_CYCLE: MenuCycleConfig = {
  period: MENU_CYCLE_SECONDS,
  keyframes: [
    // Day: the sun sweeps slowly east → west at 35°, so the long shadows turn a little.
    { at: S.day, preset: look({ ...DAY, azimuth: 40 }) },
    { at: S.sunset, preset: look({ ...DAY, azimuth: 140 }) },
    {
      at: S.sunset + 2.5,
      preset: look({ ...SUNSET, sunIntensity: 0.8, azimuth: 160, elevation: 24 }),
    },
    {
      at: S.sunset + 8.5,
      preset: look({ ...SUNSET, sunIntensity: 0.3, azimuth: 170, elevation: 12 }),
    },
    { at: S.night + 1, preset: look(NIGHT) },
    { at: S.sunrise, preset: look(NIGHT) },
    {
      at: S.sunrise + 2.5,
      preset: look({ ...SUNRISE, sunIntensity: 0.3, azimuth: -10, elevation: 12 }),
    },
    {
      at: S.sunrise + 8,
      preset: look({ ...SUNRISE, sunIntensity: 0.8, azimuth: 15, elevation: 24 }),
    },
  ],
  lamps: {
    onFrom: S.sunset + 4,
    onTo: S.sunset + 6.5,
    offFrom: S.sunrise,
    offTo: S.sunrise + 10 / 3,
  },
  reducedMotionTime: phaseMiddle('night'),
};

/** Lamp level 0..1 at second `t` (smooth fade in/out, dark during the day). */
export function menuLampLevel(t: number, s: MenuLampSchedule, period = MENU_CYCLE_SECONDS): number {
  const x = wrapCycle(t, period);
  if (x < s.onFrom || x >= s.offTo) return 0;
  if (x < s.onTo) return smoothstep((x - s.onFrom) / (s.onTo - s.onFrom));
  if (x < s.offFrom) return 1;
  return 1 - smoothstep((x - s.offFrom) / (s.offTo - s.offFrom));
}

/** The look a cycle drives: e.g. `WorldLighting` from `createWorldLighting`. */
export interface CycleTarget {
  applyCompiled(preset: CompiledPreset, lampLevel: number): void;
}

export class MenuDayCycle {
  private readonly compiled: CompiledPreset[];
  private readonly out: CompiledPreset;

  constructor(readonly config: MenuCycleConfig = MENU_CYCLE) {
    const k = config.keyframes;
    if (!k.length) throw new Error('MenuDayCycle: brak klatek kluczowych');
    for (let i = 0; i < k.length; i++) {
      const at = k[i]!.at;
      if (at < 0 || at >= config.period || (i > 0 && at <= k[i - 1]!.at)) {
        throw new Error('MenuDayCycle: klatki muszą być rosnąco w [0, okres)');
      }
    }
    this.compiled = k.map((f) => compilePreset(f.preset));
    this.out = compilePreset(k[0]!.preset);
  }

  /** Blended look at second `t` (wraps). Returns a reused instance. */
  sample(t: number): CompiledPreset {
    const { keyframes: k, period } = this.config;
    const x = wrapCycle(t, period);
    let i = k.length - 1;
    for (let n = 0; n < k.length; n++) {
      if (k[n]!.at <= x) i = n;
      else break;
    }
    const j = (i + 1) % k.length;
    const start = k[i]!.at;
    const span = wrapCycle(k[j]!.at - start, period) || period;
    const f = wrapCycle(x - start, period) / span;
    return mixCompiled(this.out, this.compiled[i]!, this.compiled[j]!, smoothstep(f));
  }

  lampLevel(t: number): number {
    return menuLampLevel(t, this.config.lamps, this.config.period);
  }

  /** Applies the look at second `t` to any lighting target. */
  apply(target: CycleTarget, t: number): void {
    target.applyCompiled(this.sample(t), this.lampLevel(t));
  }
}

export interface MenuClockOptions {
  /** Fixed second (debug `?menuTime=`), wins over everything. */
  fixed?: number | undefined;
  /** Loop speed multiplier (debug `?menuSpeed=`, e.g. for a quick recording). */
  speed?: number | undefined;
  reducedMotion?: (() => boolean) | undefined;
  config?: MenuCycleConfig | undefined;
}

/** Cycle second for an animation-frame time (ms). */
export function menuClock(o: MenuClockOptions = {}): (timeMs: number) => number {
  const cfg = o.config ?? MENU_CYCLE;
  return (timeMs) => {
    if (o.fixed !== undefined) return wrapCycle(o.fixed, cfg.period);
    if (o.reducedMotion?.()) return cfg.reducedMotionTime;
    return wrapCycle((timeMs / 1000) * (o.speed ?? 1), cfg.period);
  };
}

/** Debug query: `?menuTime=0..55` (fixed second) and `?menuSpeed=N`. */
export function parseMenuCycleQuery(search: string): { fixed?: number; speed?: number } {
  const q = new URLSearchParams(search);
  const out: { fixed?: number; speed?: number } = {};
  const t = q.get('menuTime');
  if (t !== null && t.trim() !== '') {
    const v = Number(t);
    if (Number.isFinite(v) && v >= 0 && v <= MENU_CYCLE_SECONDS) out.fixed = v;
  }
  const s = q.get('menuSpeed');
  if (s !== null && s.trim() !== '') {
    const v = Number(s);
    if (Number.isFinite(v) && v > 0 && v <= 100) out.speed = v;
  }
  return out;
}
