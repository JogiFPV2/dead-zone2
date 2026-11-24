/**
 * HUD editor model (deadzone-hud-v2-spec „Edytor HUD”): placement on screen, the anchor picked
 * from the screen thirds, offsets back from a rect and snapping. Pure (no DOM); the layout data
 * and its limits come from `@deadzone/ui/settings` (#156).
 */
import {
  HUD_BOX_DEFAULT,
  HUD_LAYOUT_SLOTS,
  HUD_OPACITY_MAX,
  HUD_OPACITY_MIN,
  HUD_SCALE_MAX,
  HUD_SCALE_MIN,
  anchorAxes,
  clampToViewport,
  defaultElementLayout,
  sanitizeHudLayout,
  type HudAnchor,
  type HudElementLayout,
  type HudLayout,
  type HudLayoutSlot,
} from '@deadzone/ui/settings';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Size {
  w: number;
  h: number;
}

/** Safe area (px of the screen), snap threshold, grid and the gap between neighbours. */
export const SAFE_PX = 18;
export const SNAP_PX = 8;
export const GRID_PX = 16;
export const GAP_PX = 12;
export const SCALE_STEP = 0.05;

/** Frame labels (spec table „Elementy”). */
export const SLOT_LABELS: Record<HudLayoutSlot, string> = {
  topbar: 'Pasek górny (zegar, data, zakładki)',
  status: 'Statusy (cel, statusy, HP)',
  minimap: 'Minimapa',
  itemlog: 'Log przedmiotów',
  weapon: 'Panel broni / auta',
  hotbar: 'Pasek szybkiego dostępu',
  threat: 'Zagrożenie',
  hints: 'Podpowiedzi klawiszy',
  osmmap: 'Mapa OpenStreetMap (dowolny rozmiar)',
};

/** Short names (panel title, overlap warning). */
export const SLOT_NAMES: Record<HudLayoutSlot, string> = {
  topbar: 'Pasek górny',
  status: 'Statusy',
  minimap: 'Minimapa',
  itemlog: 'Log przedmiotów',
  weapon: 'Panel broni / auta',
  hotbar: 'Pasek szybkiego dostępu',
  threat: 'Zagrożenie',
  hints: 'Podpowiedzi klawiszy',
  osmmap: 'Mapa OSM',
};

export const ANCHOR_NAMES: Record<HudAnchor, string> = {
  tl: 'lewy górny róg',
  tc: 'góra, środek',
  tr: 'prawy górny róg',
  cl: 'lewa krawędź',
  cr: 'prawa krawędź',
  bl: 'lewy dolny róg',
  bc: 'dół, środek',
  br: 'prawy dolny róg',
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 10000): number => Math.round(v * d) / d;

export const snapScale = (s: number): number =>
  round(clamp(Math.round(s / SCALE_STEP) * SCALE_STEP, HUD_SCALE_MIN, HUD_SCALE_MAX), 100);
export const snapOpacity = (o: number): number =>
  round(clamp(Math.round(o / SCALE_STEP) * SCALE_STEP, HUD_OPACITY_MIN, HUD_OPACITY_MAX), 100);

/**
 * Where an element sits: `size` is its on-screen size at element scale 1 (HUD scale and the
 * „Skala interfejsu” already in). An element larger than the screen minus the safe area is shrunk
 * for now (`k` < saved scale; the saved scale is untouched), then the rect is kept on screen.
 */
export function placeRect(el: HudElementLayout, vp: Size, size: Size): { rect: Rect; k: number } {
  let k = el.scale;
  const maxW = Math.max(1, vp.w - 2 * SAFE_PX);
  const maxH = Math.max(1, vp.h - 2 * SAFE_PX);
  if (size.w * k > maxW) k = maxW / size.w;
  if (size.h * k > maxH) k = maxH / size.h;
  const r = clampToViewport({ ...el, scale: k }, vp, size, 1);
  return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, k };
}

/** Anchor from the screen third holding the element's centre (middle cell: nearest edge). */
export function anchorForRect(r: Rect, vp: Size): HudAnchor {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const col = cx < vp.w / 3 ? 'l' : cx > (2 * vp.w) / 3 ? 'r' : 'c';
  const row = cy < vp.h / 3 ? 't' : cy > (2 * vp.h) / 3 ? 'b' : 'c';
  if (col === 'c' && row === 'c') {
    const d = { cl: r.left, cr: vp.w - r.left - r.width, tc: r.top, bc: vp.h - r.top - r.height };
    return (Object.entries(d) as [HudAnchor, number][]).sort((a, b) => a[1] - b[1])[0]![0];
  }
  return `${row}${col}` as HudAnchor;
}

/** Offsets (fractions of the screen, schema `x` / `y`) of a rect for an anchor. */
export function offsetsForRect(r: Rect, anchor: HudAnchor, vp: Size): { x: number; y: number } {
  const { h, v } = anchorAxes(anchor);
  const axis = (mode: string, pos: number, size: number, screen: number): number => {
    if (screen <= 0) return 0;
    if (mode === 'c') return clamp((pos + size / 2 - screen / 2) / screen, -0.5, 0.5);
    if (mode === 'r' || mode === 'b') return clamp((screen - pos - size) / screen, 0, 1);
    return clamp(pos / screen, 0, 1);
  };
  return { x: round(axis(h, r.left, r.width, vp.w)), y: round(axis(v, r.top, r.height, vp.h)) };
}

/** Element layout for a rect on screen (anchor picked by the thirds unless given). */
export function layoutFromRect(
  r: Rect,
  vp: Size,
  base: Pick<HudElementLayout, 'scale' | 'opacity' | 'visible' | 'w' | 'h'>,
  anchor: HudAnchor = anchorForRect(r, vp),
): HudElementLayout {
  // Only scale / opacity / visible (and a free-size box) from `base` (callers may pass a whole
  // element layout).
  const { scale, opacity, visible, w, h } = base;
  return {
    anchor,
    ...offsetsForRect(r, anchor, vp),
    scale,
    opacity,
    visible,
    ...(w !== undefined ? { w } : {}),
    ...(h !== undefined ? { h } : {}),
  };
}

export const overlaps = (a: Rect, b: Rect, tol = 1): boolean =>
  a.left + a.width - tol > b.left &&
  b.left + b.width - tol > a.left &&
  a.top + a.height - tol > b.top &&
  b.top + b.height - tol > a.top;

export const clampRect = (r: Rect, vp: Size): Rect => ({
  ...r,
  left: clamp(r.left, 0, Math.max(0, vp.w - r.width)),
  top: clamp(r.top, 0, Math.max(0, vp.h - r.height)),
});

export interface SnapGuide {
  axis: 'x' | 'y';
  /** Line position (screen px). */
  pos: number;
  /** Span along the other axis; undefined = across the whole screen. */
  from?: number;
  to?: number;
  kind: 'edge' | 'center' | 'element' | 'gap' | 'grid';
  /** Element snapped to (cyan frame). */
  target?: HudLayoutSlot;
  label?: string;
}

export interface SnapOptions {
  snap: boolean;
  grid: boolean;
}

export interface SnapResult {
  left: number;
  top: number;
  guides: SnapGuide[];
  /** What the element snapped to, for the drag bubble („krawędź · Statusy”). */
  labels: string[];
}

interface Cand {
  /** New `left` / `top` of the element. */
  at: number;
  level: number;
  guide: SnapGuide;
  label: string;
}

/**
 * Snapping of a dragged rect (spec „Przeciąganie i przyciąganie”): within SNAP_PX, the first
 * level that hits wins: 1) screen and safe-area edges, 2) screen centre, 3) other elements
 * (edges, centres, 12 px gap), 4) the 16 px grid. The result is always clamped to the screen.
 */
export function snapRect(
  r: Rect,
  others: readonly { slot: HudLayoutSlot; rect: Rect }[],
  vp: Size,
  o: SnapOptions,
): SnapResult {
  const guides: SnapGuide[] = [];
  const labels: string[] = [];
  const solve = (axis: 'x' | 'y'): number => {
    const pos = axis === 'x' ? r.left : r.top;
    const size = axis === 'x' ? r.width : r.height;
    const screen = axis === 'x' ? vp.w : vp.h;
    if (!o.snap) return pos;
    const cands: Cand[] = [];
    const edge = (at: number, line: number, label: string, level = 1): void => {
      cands.push({ at, level, guide: { axis, pos: line, kind: 'edge' }, label });
    };
    edge(0, 0, 'krawędź ekranu');
    edge(screen - size, screen, 'krawędź ekranu');
    edge(SAFE_PX, SAFE_PX, `krawędź ekranu · ${SAFE_PX} px`);
    edge(screen - size - SAFE_PX, screen - SAFE_PX, `krawędź ekranu · ${SAFE_PX} px`);
    cands.push({
      at: screen / 2 - size / 2,
      level: 2,
      guide: { axis, pos: screen / 2, kind: 'center' },
      label: 'środek ekranu',
    });
    for (const { slot, rect: b } of others) {
      const bp = axis === 'x' ? b.left : b.top;
      const bs = axis === 'x' ? b.width : b.height;
      const op = axis === 'x' ? b.top : b.left;
      const os = axis === 'x' ? b.height : b.width;
      const mp = axis === 'x' ? r.top : r.left;
      const ms = axis === 'x' ? r.height : r.width;
      const span = { from: Math.min(op, mp), to: Math.max(op + os, mp + ms) };
      const name = SLOT_NAMES[slot];
      const align = (at: number, line: number, kind: SnapGuide['kind'], label: string): void => {
        cands.push({
          at,
          level: 3,
          guide: { axis, pos: line, ...span, kind, target: slot },
          label,
        });
      };
      align(bp, bp, 'element', `wyrównanie · ${name}`);
      align(bp + bs - size, bp + bs, 'element', `wyrównanie · ${name}`);
      align(bp + bs / 2 - size / 2, bp + bs / 2, 'element', `środek · ${name}`);
      align(bp + bs, bp + bs, 'element', `przylega · ${name}`);
      align(bp - size, bp, 'element', `przylega · ${name}`);
      const gap = `odstęp ${GAP_PX} px · ${name}`;
      cands.push({
        at: bp + bs + GAP_PX,
        level: 3,
        guide: { axis, pos: bp + bs + GAP_PX / 2, ...span, kind: 'gap', target: slot, label: gap },
        label: gap,
      });
      cands.push({
        at: bp - GAP_PX - size,
        level: 3,
        guide: { axis, pos: bp - GAP_PX / 2, ...span, kind: 'gap', target: slot, label: gap },
        label: gap,
      });
    }
    if (o.grid) {
      const g = Math.round(pos / GRID_PX) * GRID_PX;
      cands.push({ at: g, level: 4, guide: { axis, pos: g, kind: 'grid' }, label: 'siatka' });
    }
    for (let level = 1; level <= 4; level++) {
      let best: Cand | undefined;
      for (const c of cands) {
        if (c.level !== level) continue;
        const d = Math.abs(c.at - pos);
        if (d <= SNAP_PX && (!best || d < Math.abs(best.at - pos))) best = c;
      }
      if (best) {
        if (best.guide.kind !== 'grid') guides.push(best.guide);
        labels.push(best.label);
        return best.at;
      }
    }
    return pos;
  };
  const left = clamp(solve('x'), 0, Math.max(0, vp.w - r.width));
  const top = clamp(solve('y'), 0, Math.max(0, vp.h - r.height));
  return { left, top, guides, labels };
}

/** Changed slots of a sparse layout (Ustawienia: „własny, N zmienione elementy”). */
export function changedSlots(layout: HudLayout): HudLayoutSlot[] {
  return HUD_LAYOUT_SLOTS.filter((s) => layout.elements[s] !== undefined);
}

/** Copy of a sparse layout with one slot set (or removed = default). */
/** Offset tolerance (fraction of the screen) for „same as default”: < 0.5 px at 1280×720. */
const DEFAULT_EPS = 0.0004;

/** True when an element layout is the slot's DEFAULT_HUD_LAYOUT entry (within rounding). */
export function isDefaultLayout(slot: HudLayoutSlot, el: HudElementLayout): boolean {
  const d = defaultElementLayout(slot);
  return (
    el.anchor === d.anchor &&
    Math.abs(el.x - d.x) < DEFAULT_EPS &&
    Math.abs(el.y - d.y) < DEFAULT_EPS &&
    Math.abs(el.scale - d.scale) < 0.001 &&
    Math.abs(el.opacity - d.opacity) < 0.001 &&
    el.visible === d.visible &&
    (el.w === undefined || el.w === (d.w ?? HUD_BOX_DEFAULT.w)) &&
    (el.h === undefined || el.h === (d.h ?? HUD_BOX_DEFAULT.h))
  );
}

/**
 * Layout with one slot set; a slot equal to its DEFAULT_HUD_LAYOUT entry (or undefined) is left
 * out, so only changed elements are saved and the rest keep the stylesheet place (= the default).
 */
export function withSlot(
  layout: HudLayout,
  slot: HudLayoutSlot,
  el: HudElementLayout | undefined,
): HudLayout {
  const elements = { ...layout.elements };
  if (el && !isDefaultLayout(slot, el)) elements[slot] = el;
  else delete elements[slot];
  return { version: layout.version, elements };
}

/** Saved layout from settings (local or cloud), never throws. */
export const layoutFromSettings = (raw: unknown): HudLayout => sanitizeHudLayout(raw);

/** Polish count of changed elements: „1 zmieniony element”, „4 zmienione elementy”, „5 …ych”. */
export function changedLabel(n: number): string {
  if (n === 1) return '1 zmieniony element';
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14)
    ? `${n} zmienione elementy`
    : `${n} zmienionych elementów`;
}

/** Panel line: „X 1,4% od prawej · Y 2,5% od dołu” (centred axis: „od środka”). */
export function positionText(el: HudElementLayout): {
  x: string;
  y: string;
  xs: string;
  ys: string;
} {
  const { h, v } = anchorAxes(el.anchor);
  const pct = (f: number): string => `${(f * 100).toFixed(1).replace('.', ',')}%`;
  return {
    x: pct(el.x),
    xs: h === 'l' ? 'od lewej' : h === 'r' ? 'od prawej' : 'od środka',
    y: pct(el.y),
    ys: v === 't' ? 'od góry' : v === 'b' ? 'od dołu' : 'od środka',
  };
}
