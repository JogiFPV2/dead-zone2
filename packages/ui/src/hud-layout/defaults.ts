import type { HudLayoutSlot } from './ids.js';
import { HUD_LAYOUT_VERSION, type HudElementLayout, type ResolvedHudLayout } from './schema.js';

/** HUD v3 positions are specified at 1280×720 (hud-v3.css), safe area 18 px. */
export const HUD_LAYOUT_REFERENCE = { w: 1280, h: 720 } as const;

const fx = (px: number): number => px / HUD_LAYOUT_REFERENCE.w;
const fy = (px: number): number => px / HUD_LAYOUT_REFERENCE.h;
const SAFE = 18;

const el = (
  anchor: HudElementLayout['anchor'],
  xPx: number,
  yPx: number,
): Readonly<HudElementLayout> =>
  Object.freeze({ anchor, x: fx(xPx), y: fy(yPx), scale: 1, opacity: 1, visible: true });

/**
 * Current HUD v3, offsets in px at 1280×720. Sources (apps/game/src/hud): hud-layout.css (group
 * anchors, safe area), hud-v3.css (v3 sizes and offsets), layout/hud-slots.css (editor slots
 * `status`, `weapon`, `hints`), vehicles/vehicle-hud.css (`.dz-vh__dock`, same place as `weapon`).
 */
const DEFAULTS: Record<HudLayoutSlot, Readonly<HudElementLayout>> = {
  minimap: el('tr', SAFE, 47), // Ø136, right 18, top 47
  topbar: el('tl', 0, 0), // thin bar, full width, h 31
  status: el('tl', SAFE, 48), // objective + status chips + HP as one block, left 18, top 48
  hotbar: el('br', SAFE, SAFE), // quickbar 226×48, right 18, bottom 18
  itemlog: el('tr', SAFE, 196), // under the minimap, right 18, top 196
  weapon: el('br', SAFE, 73), // weapon / vehicle panel above the quickbar, right 18, bottom 73
  threat: el('tc', 0, 40), // centred, top 40
  hints: el('bl', SAFE, SAFE), // F1 key hints, left 18, bottom 18
};

export const DEFAULT_HUD_LAYOUT: Readonly<ResolvedHudLayout> = Object.freeze({
  version: HUD_LAYOUT_VERSION,
  elements: Object.freeze(DEFAULTS),
});

/** Fresh copy of one slot's default. */
export function defaultElementLayout(slot: HudLayoutSlot): HudElementLayout {
  return { ...DEFAULTS[slot] };
}
