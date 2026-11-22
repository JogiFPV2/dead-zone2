import { dayOfYearForGameDay, sunAt, type SunPosition } from '@deadzone/protocol';
import type { CompiledPreset } from './compiled.js';
import { smoothstep } from './preset.js';

/**
 * Daytime sun from `sunAt` (shared with the sim): the directional light points along the real
 * sun direction for the game clock, so shadows of buildings, trees and cars turn and lengthen
 * through the day. Shadows are clear (the player hides in them) with soft edges. At night the
 * preset's moon light (approved night look) is used unchanged; around the horizon the shadow
 * fades out completely, so the switch sun → moon is never visible.
 */
export const SUN_LIGHT = {
  /** Shadow darkness in full daylight (0..1, `DirectionalLight.shadow.intensity`). Clear: the player hides in it (Pawel 2026-11-21). */
  shadowIntensity: 0.85,
  /** PCF blur radius of the daytime shadow (soft edges). */
  shadowRadius: 4,
  /** Sun shadows fade in between these elevations (degrees). */
  shadowFadeDeg: [2, 12] as const,
  /** Moon shadows fade out as the sun comes up to this range (degrees, below the horizon). */
  moonFadeDeg: [-8, -2] as const,
  /** The light never comes in lower than this (degrees): caps shadow length (~4.7× height). */
  minElevationDeg: 12,
  /** Length of `directional.offset` (only its direction matters). */
  distance: 100,
} as const;

const DEG = Math.PI / 180;

/** Game clock → sun position (minute of day as local solar time, game day → day of year). */
export const sunForClock = (minuteOfDay: number, gameDay: number): SunPosition =>
  sunAt(minuteOfDay / 60, dayOfYearForGameDay(gameDay));

/**
 * Replaces the directional light direction / shadow of a sampled day-cycle preset with the sun
 * (in place, allocation-free). Colours and intensities stay from the day cycle keyframes.
 * Returns the 0..1 weight of the sun shadow (0 at night and around the horizon).
 */
export function applySun(
  out: CompiledPreset,
  sun: SunPosition,
  opts: typeof SUN_LIGHT = SUN_LIGHT,
): number {
  const el = sun.elevation / DEG;
  const d = out.directional;
  if (el <= 0) {
    // Night: moon offset from the preset; its shadow fades out in late twilight.
    const moon =
      1 - smoothstep((el - opts.moonFadeDeg[0]) / (opts.moonFadeDeg[1] - opts.moonFadeDeg[0]));
    d.shadowIntensity *= moon;
    return 0;
  }
  const w = smoothstep(
    (el - opts.shadowFadeDeg[0]) / (opts.shadowFadeDeg[1] - opts.shadowFadeDeg[0]),
  );
  const e = Math.max(sun.elevation, opts.minElevationDeg * DEG);
  const h = Math.cos(e) * opts.distance;
  const len = Math.hypot(sun.direction.x, sun.direction.z) || 1;
  d.offset.set(
    (sun.direction.x / len) * h,
    Math.sin(e) * opts.distance,
    (sun.direction.z / len) * h,
  );
  d.shadowIntensity = opts.shadowIntensity * w;
  d.shadowRadius = opts.shadowRadius;
  return w;
}
