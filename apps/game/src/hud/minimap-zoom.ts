/**
 * Minimap zoom steps (HUD v2 spec §4: 0.6×–1.6×, step 0.1; multiplier over 2.5 px/m, radius
 * ≈ 36 m / zoom on the Ø182 map).
 */
export const MINIMAP_ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6] as const;

/** `1,0×` (Polish decimal comma), also used by the camera chip. */
export const zoomLabel = (zoom: number): string => `${zoom.toFixed(1).replace('.', ',')}×`;

/** Wheel delta (px) that counts as one step; trackpads send many small deltas. */
export const MINIMAP_WHEEL_STEP_PX = 100;

/** Index of the step closest to `zoom` (any persisted value snaps to a step). */
export function nearestStep(zoom: number, steps: readonly number[] = MINIMAP_ZOOM_STEPS): number {
  let best = 0;
  steps.forEach((s, i) => {
    if (Math.abs(s - zoom) < Math.abs(steps[best]! - zoom)) best = i;
  });
  return best;
}

/** Next zoom one step in (`+1`) or out (`-1`) from `zoom`, clamped to the step list. */
export function stepMinimapZoom(
  zoom: number,
  direction: 1 | -1,
  steps: readonly number[] = MINIMAP_ZOOM_STEPS,
): number {
  const i = Math.min(steps.length - 1, Math.max(0, nearestStep(zoom, steps) + direction));
  return steps[i]!;
}

export const canZoomIn = (zoom: number, steps: readonly number[] = MINIMAP_ZOOM_STEPS): boolean =>
  nearestStep(zoom, steps) < steps.length - 1;
export const canZoomOut = (zoom: number, steps: readonly number[] = MINIMAP_ZOOM_STEPS): boolean =>
  nearestStep(zoom, steps) > 0;

/**
 * Accumulates wheel deltas into whole steps: returns the step direction once |acc| reaches
 * `MINIMAP_WHEEL_STEP_PX` (scroll up = zoom in), else 0. Pure: returns the new accumulator.
 */
export function wheelSteps(acc: number, deltaY: number): { acc: number; step: 1 | -1 | 0 } {
  const next = acc + deltaY;
  if (next <= -MINIMAP_WHEEL_STEP_PX) return { acc: 0, step: 1 };
  if (next >= MINIMAP_WHEEL_STEP_PX) return { acc: 0, step: -1 };
  return { acc: next, step: 0 };
}

/** Pinch: finger distance ratio past ±25 % = one step in (spread) or out (squeeze), else 0. */
export function pinchStep(ratio: number): 1 | -1 | 0 {
  if (ratio >= 1.25) return 1;
  if (ratio <= 0.8) return -1;
  return 0;
}
