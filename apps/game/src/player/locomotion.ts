/**
 * Client-side body orientation and gait clip for the player (PZ-like):
 * - moving without aiming → the body turns towards the movement direction,
 * - aiming (mouse button held, or just attacked) → the body faces the cursor (sim facing),
 *   and moving away from it plays a backwards / sideways walk instead of a forward walk,
 * - the yaw turns smoothly (exponential approach along the shortest arc).
 * Angles are sim facing angles (radians from +x towards +y), see `sim/coords.ts`.
 */

export type GaitClip = 'idle' | 'walk' | 'run' | 'back' | 'strafeLeft' | 'strafeRight';

/** Tiles/s thresholds for walk and run clips (smoothed speed). */
export const WALK_MIN_SPEED = 0.4;
export const RUN_MIN_SPEED = 3.2;
/** Half-life of the yaw approach (ms): ~90% of a turn in 3 half-lives. */
export const TURN_HALF_LIFE_MS = 55;
/** |movement − body| above this → backwards walk; between SIDE and BACK → strafe. */
const BACK_RAD = (120 * Math.PI) / 180;
const SIDE_RAD = (55 * Math.PI) / 180;

/** Wraps an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Moves `from` towards `to` along the shortest arc by an exponential step for `dtMs`. */
export function approachAngle(
  from: number,
  to: number,
  dtMs: number,
  halfLifeMs = TURN_HALF_LIFE_MS,
): number {
  if (dtMs <= 0) return from;
  const k = 1 - Math.pow(0.5, dtMs / halfLifeMs);
  return wrapAngle(from + wrapAngle(to - from) * k);
}

export interface LocomotionInput {
  /** Sim facing (towards the cursor once the player aimed). */
  facing: number;
  /** Smoothed velocity (tiles/s, sim plane). */
  vx: number;
  vy: number;
  /** Aiming: the body faces the cursor. */
  aiming: boolean;
}

/** Yaw the body should turn to (sim angle); `current` when idle and not aiming. */
export function targetYaw(i: LocomotionInput, current: number): number {
  if (i.aiming) return i.facing;
  if (Math.hypot(i.vx, i.vy) > WALK_MIN_SPEED) return Math.atan2(i.vy, i.vx);
  return current;
}

/** Gait clip for a body at `yaw` moving with (vx, vy). */
export function gaitClip(yaw: number, vx: number, vy: number): GaitClip {
  const speed = Math.hypot(vx, vy);
  if (speed <= WALK_MIN_SPEED) return 'idle';
  // Positive relative angle (sim: from +x towards +y) is the body's right-hand side.
  const rel = wrapAngle(Math.atan2(vy, vx) - yaw);
  const abs = Math.abs(rel);
  if (abs > BACK_RAD) return 'back';
  if (abs > SIDE_RAD) return rel > 0 ? 'strafeRight' : 'strafeLeft';
  return speed > RUN_MIN_SPEED ? 'run' : 'walk';
}
