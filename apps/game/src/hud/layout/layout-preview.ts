/**
 * Ustawienia › Interfejs: 368×207 preview of the saved HUD layout (settings-hud.png). A schematic
 * of the 1280×720 reference screen: every element as a box at its place, size and opacity.
 */
import { HUD_LAYOUT_SLOTS, type HudLayout, type HudLayoutSlot } from '@deadzone/ui/settings';
import { changedSlots, placeRect, type Rect } from './hud-layout-model.js';

export const PREVIEW_W = 368;
export const PREVIEW_H = 207;
const REF = { w: 1280, h: 720 };

/** HUD v3 element rects at 1280×720, 100 % (default places; editor spec table). */
export const DEFAULT_RECTS: Record<HudLayoutSlot, Rect> = {
  topbar: { left: 0, top: 0, width: 1280, height: 31 },
  status: { left: 18, top: 48, width: 205, height: 92 },
  minimap: { left: 1126, top: 47, width: 136, height: 136 },
  itemlog: { left: 1092, top: 196, width: 170, height: 96 },
  weapon: { left: 1120, top: 593, width: 142, height: 54 },
  hotbar: { left: 1036, top: 654, width: 226, height: 48 },
  threat: { left: 565, top: 40, width: 150, height: 26 },
  hints: { left: 18, top: 680, width: 320, height: 22 },
  osmmap: { left: 18, top: 468, width: 320, height: 200 },
};

/** Rects of every element on the reference screen for a saved layout. */
export function previewRects(
  layout: HudLayout,
): Record<HudLayoutSlot, Rect & { opacity: number; hidden: boolean }> {
  const out = {} as Record<HudLayoutSlot, Rect & { opacity: number; hidden: boolean }>;
  for (const slot of HUD_LAYOUT_SLOTS) {
    const el = layout.elements[slot];
    const d = DEFAULT_RECTS[slot];
    if (!el) {
      out[slot] = { ...d, opacity: 1, hidden: false };
      continue;
    }
    const size =
      slot === 'topbar' ? { w: REF.w, h: d.height } : { w: el.w ?? d.width, h: el.h ?? d.height };
    const { rect } = placeRect(slot === 'topbar' ? { ...el, x: 0 } : el, REF, size);
    out[slot] = {
      ...rect,
      ...(slot === 'topbar' ? { left: 0, width: REF.w } : {}),
      opacity: el.opacity,
      hidden: !el.visible,
    };
  }
  return out;
}

/** `osmMap`: Mapa OpenStreetMap switched on (its box shows only then). */
export function layoutPreviewHtml(layout: HudLayout, osmMap = false): string {
  const k = PREVIEW_W / REF.w;
  const n = changedSlots(layout).length;
  const rects = previewRects(layout);
  const boxes = HUD_LAYOUT_SLOTS.map((slot) => {
    const r = rects[slot];
    if (r.hidden || (slot === 'osmmap' && !osmMap)) return '';
    const st = `left:${(r.left * k).toFixed(1)}px;top:${(r.top * k).toFixed(1)}px;width:${(r.width * k).toFixed(1)}px;height:${(r.height * k).toFixed(1)}px;opacity:${r.opacity}`;
    return `<i class="dzo-hudpv__el dzo-hudpv__el--${slot}" style="${st}"></i>`;
  }).join('');
  const badge = n ? `WŁASNY · ${n} ${n === 1 ? 'ZMIANA' : n < 5 ? 'ZMIANY' : 'ZMIAN'}` : 'DOMYŚLNY';
  return `<div class="dzo-hudpv-wrap"><div class="dzo-hudpv" style="width:${PREVIEW_W}px;height:${PREVIEW_H}px" aria-label="Podgląd układu HUD"><span class="dzo-hudpv__title">TWÓJ UKŁAD</span>${boxes}<span class="dzo-hudpv__badge${n ? ' dzo-hudpv__badge--on' : ''}">${badge}</span></div><div class="dzo-hudpv-note">Układ zapisuje się na tym komputerze.<br>Po zalogowaniu synchronizuje się z kontem.</div></div>`;
}
