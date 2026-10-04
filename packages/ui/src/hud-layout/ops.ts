import { defaultElementLayout } from './defaults.js';
import { HUD_LAYOUT_SLOTS, layoutSlotFor, type HudElementId, type HudLayoutSlot } from './ids.js';
import { sanitizeHudLayout } from './sanitize.js';
import {
  HUD_LAYOUT_VERSION,
  anchorAxes,
  type HudElementLayout,
  type ResolvedHudLayout,
} from './schema.js';

/** Full copy of the default layout. */
export function resetAll(): ResolvedHudLayout {
  const elements = {} as Record<HudLayoutSlot, HudElementLayout>;
  for (const id of HUD_LAYOUT_SLOTS) elements[id] = defaultElementLayout(id);
  return { version: HUD_LAYOUT_VERSION, elements };
}

/**
 * Saved layout (any JSON, e.g. from settings or the cloud) merged over the defaults.
 * Wrong version / shape → defaults; an invalid element → its default; unknown ids are ignored.
 */
export function resolveLayout(saved?: unknown): ResolvedHudLayout {
  const out = resetAll();
  const sparse = sanitizeHudLayout(saved);
  for (const id of HUD_LAYOUT_SLOTS) {
    const el = sparse.elements[id];
    if (el) out.elements[id] = el;
  }
  return out;
}

/** Copy of `layout` with one element's slot back at its default (`vehicle` resets `weapon`). */
export function resetElement(layout: ResolvedHudLayout, id: HudElementId): ResolvedHudLayout {
  const slot = layoutSlotFor(id);
  return {
    version: layout.version,
    elements: { ...layout.elements, [slot]: defaultElementLayout(slot) },
  };
}

export interface HudViewport {
  w: number;
  h: number;
}

export interface HudRectPx {
  /** Top-left corner in px from the viewport's top-left. */
  left: number;
  top: number;
  /** Size after `scale`. */
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Element rect in px for a viewport. `elementSizePx` is the element's size at 100 %; it is
 * multiplied by `el.scale` and the global „Skala interfejsu” `uiScale` (default 1). The rect
 * never leaves the screen at any resolution; an element larger than the screen is pinned to the
 * top-left.
 */
export function clampToViewport(
  el: HudElementLayout,
  viewport: HudViewport,
  elementSizePx: HudViewport,
  uiScale = 1,
): HudRectPx {
  const vw = Math.max(0, viewport.w);
  const vh = Math.max(0, viewport.h);
  const k = el.scale * (Number.isFinite(uiScale) && uiScale > 0 ? uiScale : 1);
  const width = Math.max(0, elementSizePx.w) * k;
  const height = Math.max(0, elementSizePx.h) * k;
  const { h, v } = anchorAxes(el.anchor);
  const axis = (mode: string, off: number, screen: number, size: number): number => {
    if (mode === 'c') return (screen - size) / 2 + off * screen;
    if (mode === 'r' || mode === 'b') return screen - size - off * screen;
    return off * screen;
  };
  const left = axis(h, el.x, vw, width);
  const top = axis(v, el.y, vh, height);
  return {
    left: clamp(left, 0, Math.max(0, vw - width)),
    top: clamp(top, 0, Math.max(0, vh - height)),
    width,
    height,
  };
}
