export interface ZoomLimits {
  min: number;
  max: number;
  /** Zoom multiplier per 100 px of wheel delta. */
  step: number;
}

export const DEFAULT_ZOOM_LIMITS: ZoomLimits = { min: 0.5, max: 3, step: 1.15 };

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
