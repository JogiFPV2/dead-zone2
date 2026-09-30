import { defaultDoc, el, type Doc } from '../dom/h.js';

/** Spec §5 `HudState.mood`. The HUD itself does not change; only the vignette does (§4.2). */
export type HudMood = 'day' | 'dusk' | 'night';

/** Sets `data-hud-mood` on the game root (discrete keyframe); the vignette picks it up via CSS. */
export function setHudMood(root: HTMLElement, mood: HudMood): void {
  root.dataset.hudMood = mood;
  setHudChips(root, mood === 'day' ? 'day' : 'night');
}

/**
 * Which moodle chip backgrounds are active: `day` = opaque `bg.day` + `border.chip.day` outline
 * (for the bright day scene), `night` = the translucent night set (also used at dusk).
 */
export type ChipMode = 'day' | 'night';

export function setHudChips(root: HTMLElement, mode: ChipMode): void {
  root.dataset.hudChips = mode;
}

/** Full-screen vignette layer (`#vignette` in spec §5), z.vignette, no pointer events. */
export function createVignette(doc: Doc = defaultDoc()): HTMLElement {
  return el(doc, 'div', 'dz-vignette');
}

/** HUD motion preference: `auto` follows prefers-reduced-motion. */
export type HudMotion = 'auto' | 'reduced' | 'full';

/** In-game "reduce motion" setting: toggles `.dz-reduced-motion` / `.dz-full-motion` on the root. */
export function setHudMotion(root: HTMLElement, motion: HudMotion): void {
  root.classList.toggle('dz-reduced-motion', motion === 'reduced');
  root.classList.toggle('dz-full-motion', motion === 'full');
}
