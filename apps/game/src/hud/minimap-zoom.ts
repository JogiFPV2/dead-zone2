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
