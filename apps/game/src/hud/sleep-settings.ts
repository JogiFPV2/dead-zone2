/** What the sleep screen and leisure buttons read from `worldSettings.survival` (content). */

export type SleepSurface = 'bed' | 'sofa' | 'floor';

export interface HudSleepSettings {
  minFatigueToSleep: number;
  wakeAtFatigue: number;
  maxDurationMin: number;
  surfaces: Record<SleepSurface, { ratePerMin: number; cap: number }>;
  saveAfterRealSec: number;
  wakeOnZombieTiles: number;
  timeScaleHint: 1 | 2 | 4;
  tvRadiusTiles: number;
}

/** `leisure.tvTag` default (base pack). */
export const TV_TAG = 'base:station-tv';

/** Base pack values (survival-mind.json), used until / unless content loads. */
export const DEFAULT_SLEEP_SETTINGS: HudSleepSettings = {
  minFatigueToSleep: 30,
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
  return {
    minFatigueToSleep: num(sl.minFatigueToSleep, d.minFatigueToSleep),
    wakeAtFatigue: num(sl.wakeAtFatigue, d.wakeAtFatigue),
    maxDurationMin: num(sl.maxDurationMin, d.maxDurationMin),
    surfaces: { bed: surface('bed'), sofa: surface('sofa'), floor: surface('floor') },
    saveAfterRealSec: num(sl.saveAfterRealSec, d.saveAfterRealSec),
    wakeOnZombieTiles: num(sl.wakeOnZombieTiles, d.wakeOnZombieTiles),
    timeScaleHint: speed(sl.timeScaleHint, d.timeScaleHint),
    tvRadiusTiles: num(leisure.tvRadiusTiles, d.tvRadiusTiles),
  };
}
