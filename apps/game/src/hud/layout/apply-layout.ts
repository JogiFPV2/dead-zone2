/**
 * Applies the saved HUD layout to the HUD DOM (deadzone-hud-v2-spec „Edytor HUD”). Slots the
 * player did not change keep the stylesheet position (HUD v3); a changed slot gets inline
 * left/right/top/bottom from its anchor edge, `scale(HUD scale × element scale)` from the anchor
 * and its opacity. Positions are clamped on screen at every apply (start, resize, „Skala
 * interfejsu”, a new layout); nothing is written back to the settings.
 */
import {
  HUD_BOX_SLOTS,
  HUD_LAYOUT_SLOTS,
  anchorAxes,
  type HudLayout,
  type HudLayoutSlot,
} from '@deadzone/ui/settings';
import { placeRect, type Rect, type Size } from './hud-layout-model.js';

export type LayoutTargets = Partial<Record<HudLayoutSlot, HTMLElement[]>>;

export interface LayoutApplier {
  /** Applies `layout` now (editor: a draft; `editing` keeps hidden elements faintly visible). */
  apply(layout: HudLayout, editing?: boolean): void;
  /** Re-applies the last layout (resize, content size changes). */
  reclamp(): void;
  /** Current on-screen rect of a slot (union of its visible targets), relative to the root. */
  rectOf(slot: HudLayoutSlot): Rect | undefined;
  readonly layout: HudLayout;
}

const PROPS = [
  'left',
  'right',
  'top',
  'bottom',
  'transform',
  'transform-origin',
  'opacity',
  'width',
  'height',
];

function clear(el: HTMLElement): void {
  for (const p of PROPS) el.style.removeProperty(p);
  el.style.removeProperty('--hud2-s');
  el.removeAttribute('data-hud-off');
  el.removeAttribute('data-hud-ghost');
}

const px = (v: number): string => `${Math.round(v * 100) / 100}px`;

export function createLayoutApplier(
  root: HTMLElement,
  targets: () => LayoutTargets,
): LayoutApplier {
  let layout: HudLayout = { version: 1, elements: {} };
  let editing = false;
  const touched = new Set<HTMLElement>();

  const viewport = (): { vp: Size; ox: number; oy: number } => {
    const r = root.getBoundingClientRect();
    return { vp: { w: r.width, h: r.height }, ox: r.left, oy: r.top };
  };
  const hudScale = (): number => {
    const v = Number.parseFloat(getComputedStyle(root).getPropertyValue('--hud2-s'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  };

  function applyOne(slot: HudLayoutSlot, el: HTMLElement, vp: Size): void {
    const lay = layout.elements[slot];
    if (!lay) return;
    touched.add(el);
    if (!lay.visible) {
      if (editing) el.setAttribute('data-hud-ghost', '');
      else el.setAttribute('data-hud-off', '');
    }
    if (lay.opacity < 1) el.style.opacity = String(lay.opacity);
    // Free-size box (Mapa OpenStreetMap): width / height from the editor, before measuring.
    if (HUD_BOX_SLOTS.includes(slot)) {
      if (lay.w !== undefined) el.style.width = px(lay.w);
      if (lay.h !== undefined) el.style.height = px(lay.h);
    }
    // Default place and scale from the stylesheet (overrides are cleared before measuring).
    const r = el.getBoundingClientRect();
    const w0 = el.offsetWidth;
    const h0 = el.offsetHeight;
    const s = hudScale();
    const base = w0 > 0 ? r.width / w0 : s;
    if (slot === 'topbar') {
      // Full-width bar: only up / down and its own scale (the bar reads `--hud2-s`).
      const hgt = (h0 || r.height) * lay.scale;
      const { v } = anchorAxes(lay.anchor);
      const y =
        v === 'b'
          ? vp.h - hgt - lay.y * vp.h
          : v === 'c'
            ? (vp.h - hgt) / 2 + lay.y * vp.h
            : lay.y * vp.h;
      el.style.setProperty('--hud2-s', String(s * lay.scale));
      el.style.top = px(Math.min(Math.max(0, y), Math.max(0, vp.h - hgt)));
      el.style.bottom = 'auto';
      return;
    }
    const size = { w: w0 * base, h: h0 * base };
    const { rect, k } = placeRect(lay, vp, size);
    const { h, v } = anchorAxes(lay.anchor);
    const sc = base * k;
    let tx = '';
    let ty = '';
    let ox2 = 'left';
    let oy2 = 'top';
    if (h === 'r') {
      el.style.left = 'auto';
      el.style.right = px(vp.w - rect.left - rect.width);
      ox2 = 'right';
    } else if (h === 'c') {
      el.style.left = px(rect.left + rect.width / 2);
      el.style.right = 'auto';
      tx = 'translateX(-50%) ';
      ox2 = 'center';
    } else {
      el.style.left = px(rect.left);
      el.style.right = 'auto';
    }
    if (v === 'b') {
      el.style.top = 'auto';
      el.style.bottom = px(vp.h - rect.top - rect.height);
      oy2 = 'bottom';
    } else if (v === 'c') {
      el.style.top = px(rect.top + rect.height / 2);
      el.style.bottom = 'auto';
      ty = 'translateY(-50%) ';
      oy2 = 'center';
    } else {
      el.style.top = px(rect.top);
      el.style.bottom = 'auto';
    }
    el.style.transformOrigin = `${ox2} ${oy2}`;
    el.style.transform = `${tx}${ty}scale(${sc})`;
  }

  const api: LayoutApplier = {
    get layout() {
      return layout;
    },
    apply(next, edit = false) {
      layout = next;
      editing = edit;
      for (const el of touched) clear(el);
      touched.clear();
      const { vp } = viewport();
      if (vp.w <= 0 || vp.h <= 0) return;
      const t = targets();
      for (const slot of HUD_LAYOUT_SLOTS) {
        for (const el of t[slot] ?? []) {
          clear(el);
          // Slot name on the element (tests, screenshots, styling hooks).
          el.dataset.hudSlot = slot;
        }
      }
      for (const slot of HUD_LAYOUT_SLOTS) {
        for (const el of t[slot] ?? []) applyOne(slot, el, vp);
      }
    },
    reclamp() {
      api.apply(layout, editing);
    },
    rectOf(slot) {
      const { ox, oy } = viewport();
      let u: Rect | undefined;
      for (const el of targets()[slot] ?? []) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const a = { left: r.left - ox, top: r.top - oy, width: r.width, height: r.height };
        if (!u) u = a;
        else {
          const l = Math.min(u.left, a.left);
          const tp = Math.min(u.top, a.top);
          u = {
            left: l,
            top: tp,
            width: Math.max(u.left + u.width, a.left + a.width) - l,
            height: Math.max(u.top + u.height, a.top + a.height) - tp,
          };
        }
      }
      return u;
    },
  };
  return api;
}
