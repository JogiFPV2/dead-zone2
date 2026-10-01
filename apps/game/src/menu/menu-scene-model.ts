/** Screen fractions of the camera target (spec §1: crossroads at ~66% width, lower-middle). */
export const MENU_FOCUS_X = 0.66;
export const MENU_FOCUS_Y = 0.52;
/** Camera drift loop (s) and radius (world units): 2π·1.5/60 ≈ 0.16 u/s (≤ 0.3, spec §1). */
export const DRIFT_PERIOD_S = 60;
export const DRIFT_RADIUS = 1.5;

/** Asymmetric ortho frustum with the target at (ax, ay) of the screen. */
export function menuCameraFrustum(
  aspect: number,
  viewHeight: number,
  ax = MENU_FOCUS_X,
  ay = MENU_FOCUS_Y,
): { left: number; right: number; top: number; bottom: number } {
  const w = viewHeight * aspect;
  return {
    left: -w * ax,
    right: w * (1 - ax),
    top: viewHeight * ay,
    bottom: -viewHeight * (1 - ay),
  };
}

/** Slow looping camera drift (world x/z offset) at time `t` seconds. */
export function menuDrift(t: number): { x: number; z: number } {
  const a = (t / DRIFT_PERIOD_S) * Math.PI * 2;
  return { x: Math.sin(a) * DRIFT_RADIUS, z: Math.sin(2 * a) * DRIFT_RADIUS * 0.5 };
}

/** A scripted menu zombie: walks a few tiles, stands, turns around, repeats. */
export interface Shambler {
  x: number;
  y: number;
  /** Walking direction in the sim plane (radians, x = cos, y = sin). */
  heading: number;
  phase: number;
  timer: number;
  walking: boolean;
}

export const SHAMBLE_SPEED = 0.32;
export const SHAMBLE_WALK_S = 7;
export const SHAMBLE_IDLE_S = 2.5;

/** Advances one zombie by `dt` seconds; returns whether it is walking. */
export function shambleStep(z: Shambler, dt: number): boolean {
  z.timer += dt;
  if (z.walking) {
    z.x += Math.cos(z.heading) * SHAMBLE_SPEED * dt;
    z.y += Math.sin(z.heading) * SHAMBLE_SPEED * dt;
    if (z.timer >= SHAMBLE_WALK_S) {
      z.walking = false;
      z.timer = 0;
    }
  } else if (z.timer >= SHAMBLE_IDLE_S + z.phase) {
    z.walking = true;
    z.timer = 0;
    z.heading += Math.PI + (z.phase - 0.5) * 0.6;
  }
  return z.walking;
}
