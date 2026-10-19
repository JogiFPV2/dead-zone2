/** What the sleep screen and leisure buttons read from `worldSettings.survival` (content). */

export type SleepSurface = 'bed' | 'sofa' | 'floor';

export interface HudSleepSettings {
  minFatigueToSleep: number;
  /** `sleep-until:morning` alarm hour (`sleep.morningHour`, protocol 29). */
  morningHour: number;
  wakeAtFatigue: number;
  maxDurationMin: number;
  surfaces: Record<SleepSurface, { ratePerMin: number; cap: number }>;
  saveAfterRealSec: number;
  wakeOnZombieTiles: number;
  timeScaleHint: 1 | 2 | 4;
  tvRadiusTiles: number;
  /** `leisure.tv` / `leisure.vhs` effects (watch panel): rest, boredom and stress per session. */
  leisure: {
    tv: LeisureEffect & { sessionMin: number };
    vhs: LeisureEffect;
  };
}

/** One leisure activity: fatigue rested, boredom and stress removed (points). */
export interface LeisureEffect {
  rest: number;
  boredom: number;
  stress: number;
}

/** `leisure.tvTag` default (base pack). */
export const TV_TAG = 'base:station-tv';

/** Base pack values (survival-mind.json), used until / unless content loads. */
export const DEFAULT_SLEEP_SETTINGS: HudSleepSettings = {
  minFatigueToSleep: 30,
  morningHour: 7,
  wakeAtFatigue: 2,
  maxDurationMin: 720,
  surfaces: {
    bed: { ratePerMin: 0.1, cap: 50 },
    sofa: { ratePerMin: 0.075, cap: 35 },
    floor: { ratePerMin: 0.05, cap: 25 },
  },
  saveAfterRealSec: 120,
  wakeOnZombieTiles: 6,
  timeScaleHint: 4,
  tvRadiusTiles: 1.5,
  leisure: {
    tv: { rest: 6, boredom: 25, stress: 12, sessionMin: 30 },
    vhs: { rest: 8, boredom: 30, stress: 15 },
  },
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const speed = (v: unknown, d: 1 | 2 | 4): 1 | 2 | 4 => (v === 1 || v === 2 || v === 4 ? v : d);

/** A world-settings file with `survival.sleep` → settings (others fall back to defaults). */
export function readSleepSettings(json: unknown): HudSleepSettings | undefined {
  const survival = isObj(json) && isObj(json.survival) ? json.survival : undefined;
  const sl = survival && isObj(survival.sleep) ? survival.sleep : undefined;
  if (!sl) return undefined;
  const d = DEFAULT_SLEEP_SETTINGS;
  const surf = isObj(sl.surfaces) ? sl.surfaces : {};
  const surface = (k: SleepSurface) => {
    const x = isObj(surf[k]) ? surf[k] : {};
    return {
      ratePerMin: num(x.fatigueRecoveryPerMin, d.surfaces[k].ratePerMin),
      cap: num(x.maxRecoveryPerSleep, d.surfaces[k].cap),
    };
  };
  const leisure = survival && isObj(survival.leisure) ? survival.leisure : {};
  const effect = (v: unknown, e: LeisureEffect): LeisureEffect => {
    const x = isObj(v) ? v : {};
    return {
      rest: num(x.fatigueRest, e.rest),
      boredom: num(x.boredomReduction, e.boredom),
      stress: num(x.stressReduction, e.stress),
    };
  };
  const tv = isObj(leisure.tv) ? leisure.tv : {};
  return {
    minFatigueToSleep: num(sl.minFatigueToSleep, d.minFatigueToSleep),
    morningHour: num(sl.morningHour, d.morningHour),
    wakeAtFatigue: num(sl.wakeAtFatigue, d.wakeAtFatigue),
    maxDurationMin: num(sl.maxDurationMin, d.maxDurationMin),
    surfaces: { bed: surface('bed'), sofa: surface('sofa'), floor: surface('floor') },
    saveAfterRealSec: num(sl.saveAfterRealSec, d.saveAfterRealSec),
    wakeOnZombieTiles: num(sl.wakeOnZombieTiles, d.wakeOnZombieTiles),
    timeScaleHint: speed(sl.timeScaleHint, d.timeScaleHint),
    tvRadiusTiles: num(leisure.tvRadiusTiles, d.tvRadiusTiles),
    leisure: {
      tv: {
        ...effect(tv, d.leisure.tv),
        sessionMin: num(tv.sessionMin, d.leisure.tv.sessionMin),
      },
      vhs: effect(leisure.vhs, d.leisure.vhs),
    },
  };
}
