/**
 * Minimap zoom steps (multiplier over the spec 2.5 px/m; radius ≈ 40 m / zoom): 80 m, 53 m,
 * 40 m (default), 27 m, 20 m.
 */
export const MINIMAP_ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2] as const;

/** Wheel delta (px) that counts as one step; trackpads send many small deltas. */
export const MINIMAP_WHEEL_STEP_PX = 100;

/** Index of the step closest to `zoom` (any persisted value snaps to a step). */
export function nearestStep(zoom: number): number {
  let best = 0;
  MINIMAP_ZOOM_STEPS.forEach((s, i) => {
    if (Math.abs(s - zoom) < Math.abs(MINIMAP_ZOOM_STEPS[best]! - zoom)) best = i;
  });
  return best;
}

/** Next zoom one step in (`+1`) or out (`-1`) from `zoom`, clamped to the step list. */
export function stepMinimapZoom(zoom: number, direction: 1 | -1): number {
  const i = Math.min(MINIMAP_ZOOM_STEPS.length - 1, Math.max(0, nearestStep(zoom) + direction));
  return MINIMAP_ZOOM_STEPS[i]!;
}

export const canZoomIn = (zoom: number): boolean =>
  nearestStep(zoom) < MINIMAP_ZOOM_STEPS.length - 1;
export const canZoomOut = (zoom: number): boolean => nearestStep(zoom) > 0;

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
