import { dayOfYearForGameDay, sunAt } from '@deadzone/protocol';
import { dayOf, gameMinuteAt, minuteOfDay } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import type { VisionConfig } from './config.js';
import { weatherNow } from '../world/weather.js';

/** Sun, sky light and the light → sight mapping (docs 9.45; shadows and hiding: light.ts). */
export const LIGHT = {
  /** Sky light under the moon (full night). */
  moon: 0.05,
  /** Sine of the sun elevation where twilight ends (±6°). */
  twilightSin: 0.1045,
  /** Sky × this in a building's shadow (sun above the horizon). */
  shadowMul: 0.45,
  /** Weather on: moonlight × this at new moon, rising to × 1 at full moon. */
  newMoonMul: 0.25,
  /** Weather on: full cloud cover dims the moonlight by this share and the daylight by this one. */
  cloudMoonDim: 0.7,
  cloudDayDim: 0.45,
  /** Weather on: shadows fade towards no shadow by this share at full cloud cover (diffuse light). */
  cloudShadowSoften: 0.8,
  /** Weather on: below moonlight the sight factor falls with the light, down to × this. */
  darkSightFloor: 0.25,
  /** Sky × this in the shade of tree crowns (leaves let some light through; `SimChunk.trees`). */
  treeShadeMul: 0.6,
  /** Body height (m) the light is taken at while sneaking (crouched behind a car or a fence). */
  sneakBodyHeightM: 0.5,
  /** Heights (m) of low shade casters: parked / driven cars, fences and gates, garden walls. */
  carHeightM: 1.5,
  fenceHeightM: 1.5,
  wallHeightM: 2,
  /** Sky × this in the shadow of a car, a fence or a wall (as dense as a building). */
  lowShadeMul: 0.45,
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

/**
 * Sky light 0..1 at a game minute: the sun's `sky` (`sunState`), with weather on also the moon
 * phase (new moon ≈ a quarter of the full-moon light) and clouds (dim the moon and the day).
 */
export function skyLight(w: SimWorld, minute: number): number {
  const sun = sunState(minute);
  const wx = weatherNow(w, minute);
  if (!wx) return sun.sky;
  const night =
    LIGHT.moon *
    (LIGHT.newMoonMul + (1 - LIGHT.newMoonMul) * wx.moon) *
    (1 - LIGHT.cloudMoonDim * wx.cloud);
  const day = 1 - LIGHT.cloudDayDim * wx.cloud;
  const k = (sun.sky - LIGHT.moon) / (1 - LIGHT.moon);
  return Math.fround(night + (day - night) * k);
}

/** Shade multiplier `mul` softened by clouds (overcast light is diffuse: weak shadows). */
export function cloudSoftened(w: SimWorld, mul: number, minute: number): number {
  const wx = weatherNow(w, minute);
  return wx ? mul + (1 - mul) * LIGHT.cloudShadowSoften * wx.cloud : mul;
}

/** Sight range × this for the weather now (fog, rain, snow); 1 when weather is off. */
export const weatherSightMul = (w: SimWorld, minute: number): number =>
  weatherNow(w, minute)?.sightMul ?? 1;

/**
 * Sight factor of a light level: `nightFactor` under the (full) moon, 1 in full light. With
 * `darker` (weather on) a light below the moonlight lowers it further, down to × `darkSightFloor`
 * (new moon, clouds at night, indoors at night).
 */
export function sightFactor(vc: VisionConfig, light: number, darker = false): number {
  if (darker && light < LIGHT.moon)
    return Math.fround(vc.nightFactor * Math.max(LIGHT.darkSightFloor, light / LIGHT.moon));
  const k = Math.max(0, Math.min(1, (light - LIGHT.moon) / (1 - LIGHT.moon)));
  return Math.fround(vc.nightFactor + (1 - vc.nightFactor) * k);
}

/** Sky sight factor now (outdoors, no shadow): replaces the clock dawn / dusk blend. */
export function skySightFactor(w: SimWorld, vc: VisionConfig): number {
  const m = gameMinuteAt(w.clock, w.tick);
  return Math.fround(
    sightFactor(vc, skyLight(w, m), w.weather !== undefined) * weatherSightMul(w, m),
  );
}
