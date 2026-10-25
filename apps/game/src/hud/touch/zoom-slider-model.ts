import { clamp, type ZoomLimits } from '../../camera/zoom.js';

/**
 * Vertical camera zoom slider (touch): position 0 (bottom, widest view) … 1 (top, closest),
 * logarithmic so every centimetre of the thumb is the same zoom factor.
 */
export function zoomFromSlider(t: number, limits: Pick<ZoomLimits, 'min' | 'max'>): number {
  const k = clamp(t, 0, 1);
  return limits.min * Math.pow(limits.max / limits.min, k);
}

export function sliderFromZoom(zoom: number, limits: Pick<ZoomLimits, 'min' | 'max'>): number {
  const z = clamp(zoom, limits.min, limits.max);
  return Math.log(z / limits.min) / Math.log(limits.max / limits.min);
}

/** Slider position under a finger at `y` on a track spanning `top`…`top + height` (screen px). */
export function sliderAt(y: number, top: number, height: number): number {
  return height > 0 ? clamp(1 - (y - top) / height, 0, 1) : 0;
}
