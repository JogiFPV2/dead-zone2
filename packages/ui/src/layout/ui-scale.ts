/** HUD scaling (spec §2 "Skalowanie"). */

export const REFERENCE_WIDTH = 1920;
export const REFERENCE_HEIGHT = 1080;
export const MIN_WIDTH = 1280;
export const MIN_HEIGHT = 720;
/** "Skala HUD" setting range. */
export const HUD_SCALE_SETTING_MIN = 0.8;
export const HUD_SCALE_SETTING_MAX = 1.3;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * `clamp(0.8, min(w/1920, h/1080), 1.5) × hudScaleSetting`, rounded to 0.05.
 * `devicePixelRatio` is ignored on purpose (CSS px).
 */
export function computeUiScale(width: number, height: number, hudScaleSetting = 1): number {
  const setting = clamp(hudScaleSetting, HUD_SCALE_SETTING_MIN, HUD_SCALE_SETTING_MAX);
  const base = clamp(Math.min(width / REFERENCE_WIDTH, height / REFERENCE_HEIGHT), 0.8, 1.5);
  return Math.round((base * setting) / 0.05) * 0.05;
}

/** Below 1280×720 the HUD shows "Zalecana rozdzielczość min. 1280×720". */
export const isBelowMinResolution = (width: number, height: number): boolean =>
  width < MIN_WIDTH || height < MIN_HEIGHT;

/** Writes `--ui-scale` on the HUD root. */
export function applyUiScale(root: HTMLElement, scale: number): void {
  root.style.setProperty('--ui-scale', String(scale));
}
