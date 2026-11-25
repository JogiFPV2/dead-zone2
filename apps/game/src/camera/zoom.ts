export interface ZoomLimits {
  min: number;
  max: number;
  /** Zoom multiplier per 100 px of wheel delta. */
  step: number;
}

/**
 * Ortho `camera.zoom` limits around the default view (zoom 1 = VIEW_HEIGHT world units tall):
 * 0.6× (wider, ~40 m tall) to 6× (closer, ~4 m tall: the character fills half the screen, Paweł 25.11).
 */
export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.6, max: 6, step: 1.12 };

/** Half-life of the smooth zoom towards the wheel target. */
export const ZOOM_HALF_LIFE_MS = 70;

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Ortho zoom after a wheel event. Scroll up (negative deltaY) zooms in. */
export function zoomFromWheel(
  current: number,
  deltaY: number,
  limits: ZoomLimits = DEFAULT_ZOOM_LIMITS,
): number {
  const factor = Math.pow(limits.step, -deltaY / 100);
  return clamp(current * factor, limits.min, limits.max);
}

/**
 * Frame-rate independent lerp of the zoom towards `target` (exponential, `halfLifeMs`); snaps
 * once closer than `epsilon` so the projection matrix stops updating.
 */
export function smoothZoom(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs = ZOOM_HALF_LIFE_MS,
  epsilon = 1e-4,
): number {
  if (Math.abs(target - current) < epsilon || halfLifeMs <= 0) return target;
  const k = 1 - Math.pow(0.5, Math.max(0, dtMs) / halfLifeMs);
  const next = current + (target - current) * k;
  return Math.abs(target - next) < epsilon ? target : next;
}
