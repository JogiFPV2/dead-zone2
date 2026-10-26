import { MINIMAP_PX_PER_M } from '@deadzone/ui';

/**
 * Phone minimap levels (mobile HUD spec): radius 480 / 240 / 120 / 60 m, default 120 m. The
 * minimap SVG is 200 units wide (radius 100) and hud.ts scales its zoom by 200 / 136, so a zoom
 * `z` shows 100 / (MINIMAP_PX_PER_M · z · 200/136) metres to the edge.
 */
export const MINIMAP_TOUCH_RADII_M = [480, 240, 120, 60] as const;
export const MINIMAP_TOUCH_DEFAULT_LEVEL = 2;
const FIT = 200 / 136;

export const zoomForRadius = (radiusM: number): number => 100 / (MINIMAP_PX_PER_M * FIT * radiusM);
export const radiusForZoom = (zoom: number): number => 100 / (MINIMAP_PX_PER_M * FIT * zoom);

/** Ascending zoom steps (zoomed out → in) for createMinimapZoomControls. */
export const MINIMAP_TOUCH_STEPS: readonly number[] = MINIMAP_TOUCH_RADII_M.map(zoomForRadius);

/** Saved zoom → a touch level zoom; values from the desktop range (≥ 0.5) start at 120 m. */
export function touchMinimapZoom(saved: number): number {
  const fallback = MINIMAP_TOUCH_STEPS[MINIMAP_TOUCH_DEFAULT_LEVEL]!;
  if (!(saved > 0) || saved > MINIMAP_TOUCH_STEPS[MINIMAP_TOUCH_STEPS.length - 1]! * 1.05)
    return fallback;
  return MINIMAP_TOUCH_STEPS.reduce((a, b) => (Math.abs(b - saved) < Math.abs(a - saved) ? b : a));
}

/** `120 m` label for the level badge. */
export const radiusLabel = (zoom: number): string => `${Math.round(radiusForZoom(zoom))} m`;
