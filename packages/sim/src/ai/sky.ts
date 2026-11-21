import { dayOfYearForGameDay, sunAt } from '@deadzone/protocol';
import { dayOf, gameMinuteAt, minuteOfDay } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import type { VisionConfig } from './config.js';

/** Sun, sky light and the light → sight mapping (docs 9.45; shadows and hiding: light.ts). */
export const LIGHT = {
  /** Sky light under the moon (full night). */
  moon: 0.05,
  /** Sine of the sun elevation where twilight ends (±6°). */
  twilightSin: 0.1045,
  /** Sky × this in a building's shadow (sun above the horizon). */
  shadowMul: 0.45,
  /** Sky × this in the shade of tree crowns (leaves let some light through; `SimChunk.trees`). */
  treeShadeMul: 0.6,
  /** Sky × this inside a room (windows, doors). */
  indoorMul: 0.35,
  /** Height of one level (m) for shadows; ray starts at `bodyHeightM` above the ground. */
  levelHeightM: 3,
  bodyHeightM: 1,
  /** Farthest tile a shadow ray checks. */
  maxShadowTiles: 48,
  /** Player light levels are refreshed this often (ticks). */
  everyTicks: 5,
  /** Standing still: visibility × this in full darkness, rising to × 1 at `stillFullLight`. */
  stillDarkMul: 0.1,
  stillFullLight: 0.6,
  /** Moving: running / sprinting draw the eye (× this, total capped at 1). */
  runMul: 1.15,
  sprintMul: 1.3,
} as const;

export interface SunState {
  /** Game minute of the cache (per minute: sky; per quarter: `quarter`). */
  minute: number;
  quarter: number;
  sky: number;
  /** Horizontal unit vector towards the sun (sim x east, y south) and tan(elevation). */
  hx: number;
  hy: number;
  tanEl: number;
  up: boolean;
}

const q4 = (v: number): number => Math.round(v * 1e4) / 1e4;

let sunCache: SunState | undefined;

/** Sun and sky light at a game minute (cached; quantised so engines agree). */
export function sunState(minute: number): SunState {
  if (sunCache?.minute === minute) return sunCache;
  const mod = minuteOfDay(minute);
  const s = sunAt(mod / 60, dayOfYearForGameDay(dayOf(minute)));
  const sinEl = q4(s.direction.y);
  const t = LIGHT.twilightSin;
  const sky =
    sinEl <= -t
      ? LIGHT.moon
      : sinEl >= t
        ? 1
        : LIGHT.moon + ((1 - LIGHT.moon) * (sinEl + t)) / (2 * t);
  // The shadow geometry only changes per quarter-hour (same as the masks).
  const qMin = minute - (mod % 15);
  const sq = qMin === minute ? s : sunAt(minuteOfDay(qMin) / 60, dayOfYearForGameDay(dayOf(qMin)));
  const h = Math.sqrt(sq.direction.x * sq.direction.x + sq.direction.z * sq.direction.z);
  sunCache = {
    minute,
    quarter: Math.floor(qMin / 15),
    sky: Math.fround(sky),
    hx: h > 0 ? q4(sq.direction.x / h) : 0,
    hy: h > 0 ? q4(sq.direction.z / h) : 0,
    tanEl: h > 0 ? q4(sq.direction.y / h) : 0,
    up: sq.direction.y > 0,
  };
  return sunCache;
}

/** Sight factor of a light level: `nightFactor` under the moon, 1 in full light. */
export function sightFactor(vc: VisionConfig, light: number): number {
  const k = Math.max(0, Math.min(1, (light - LIGHT.moon) / (1 - LIGHT.moon)));
  return Math.fround(vc.nightFactor + (1 - vc.nightFactor) * k);
}

/** Sky sight factor now (outdoors, no shadow): replaces the clock dawn / dusk blend. */
export const skySightFactor = (w: SimWorld, vc: VisionConfig): number =>
  sightFactor(vc, sunState(gameMinuteAt(w.clock, w.tick)).sky);
