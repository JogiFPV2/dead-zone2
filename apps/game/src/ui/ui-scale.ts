/**
 * „Skala interfejsu” (Ustawienia › Grafika): one multiplier for the whole UI — HUD, minimap,
 * inventory, big map, menus and tooltips. Every UI layer already scales from its anchor corner
 * (`--hud2-s`, `--ui-scale`, the overlay / menu stages); they multiply their resolution scale by
 * `uiScale()`. A change re-runs the layout through a window `resize` event, so anchors stay on
 * the screen edges and text is laid out at the new size (crisp, no bitmap scaling).
 */
import type { SettingsStore } from '../settings/store.js';

export const UI_SCALE_MIN = 0.6;
export const UI_SCALE_MAX = 1.2;
export const UI_SCALE_STEP = 0.05;
/** Paweł: everything was too big at 100 %. */
export const UI_SCALE_DEFAULT = 0.9;

/** Clamps to 60–120 % and snaps to 5 % steps (two decimals, no float dust). */
export function snapUiScale(v: number): number {
  if (!Number.isFinite(v)) return UI_SCALE_DEFAULT;
  const c = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v));
  return Math.round(Math.round(c / UI_SCALE_STEP) * UI_SCALE_STEP * 100) / 100;
}

let current = UI_SCALE_DEFAULT;

/** Current multiplier (the saved setting, or the live preview while Ustawienia is open). */
export const uiScale = (): number => current;

/** Sets the multiplier and relayouts every UI layer (no-op when unchanged). */
export function setUiScale(v: number): void {
  const next = snapUiScale(v);
  if (next === current) return;
  current = next;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
}

/** Follows the stored setting (applied on Zastosuj); returns the unsubscribe. */
export function bindUiScale(settings: Pick<SettingsStore, 'get' | 'subscribe'>): () => void {
  setUiScale(settings.get().graphics.uiScale);
  return settings.subscribe((s) => setUiScale(s.graphics.uiScale));
}

/** A layer's resolution scale times the setting (two decimals). */
export const scaledUi = (resolutionScale: number): number =>
  Math.round(resolutionScale * current * 100) / 100;
