/**
 * HUD editor (deadzone-hud-v2-spec „Edytor HUD”, accepted mockups hud-editor.png,
 * hud-editor-drag.png): frames over every HUD element, drag with snapping and guide lines, a
 * panel with size / opacity, reset and keyboard shortcuts. Works on a draft layout applied live;
 * Zapisz hands it to the owner, Anuluj restores the layout it started with.
 */
import './hud-editor.css';
import {
  HUD_LAYOUT_SLOTS,
  HUD_LAYOUT_VERSION,
  anchorAxes,
  defaultElementLayout,
  type HudElementLayout,
  type HudLayout,
  type HudLayoutSlot,
} from '@deadzone/ui/settings';
import { icon } from '../../menu/icons.js';
import type { LayoutApplier } from './apply-layout.js';
import {
  ANCHOR_NAMES,
  SAFE_PX,
  SCALE_STEP,
  SLOT_LABELS,
  SLOT_NAMES,
  clampRect,
  layoutFromRect,
  overlaps,
  positionText,
  snapOpacity,
  snapRect,
  snapScale,
  withSlot,
  type Rect,
  type SnapGuide,
  type Size,
} from './hud-layout-model.js';

export interface HudEditorOptions {
  /** Game root (the HUD layers and the editor live in it). */
  readonly root: HTMLElement;
  /** Layout to start from (the settings draft). */
  readonly layout: HudLayout;
  readonly applier: LayoutApplier;
  /** „Skala interfejsu” (text-size warning: element × interface < 0.8). */
  readonly uiScale: number;
  /** Sample content in calm-hidden elements while editing. */
  setPreview(on: boolean): void;
  onSave(layout: HudLayout): void;
  onCancel(): void;
}

export interface HudEditor {
  /** Routes a keydown (the pause menu forwards them); true when handled. */
  onKey(e: KeyboardEvent): boolean;
  dispose(): void;
  /** Test / screenshot hook: the current draft. */
  readonly layout: HudLayout;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const LABEL_W = 210;

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const kbd = (k: string): string => `<span class="dz-hed__key">${esc(k)}</span>`;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function createHudEditor(o: HudEditorOptions): HudEditor {
  const { root, applier } = o;
  const start = o.layout;
  let draft: HudLayout = { version: HUD_LAYOUT_VERSION, elements: { ...start.elements } };
  const undo: HudLayout[] = [];
  let selected: HudLayoutSlot | undefined = 'hotbar';
  let grid = true;
  let snap = true;
  let preview = false;
  let confirm: { el: HTMLElement; yes: () => void } | undefined;
  let disposed = false;
  let rects: Partial<Record<HudLayoutSlot, Rect>> = {};

  // Scrim between the world and the HUD; the editor chrome above everything.
  const scrim = document.createElement('div');
  scrim.className = 'dz-hed-scrim';
  const hudLayer = root.querySelector('.dz-hud');
  root.insertBefore(scrim, hudLayer);
  const el = document.createElement('div');
  el.className = 'dz-hed';
  el.innerHTML = `<div class="dz-hed__grid"></div><div class="dz-hed__safe"><span>strefa bezpieczna 18 px</span></div><div class="dz-hed__zones"><span>strefy kotwic (tercje ekranu)</span></div><svg class="dz-hed__svg"></svg><div class="dz-hed__ghost" hidden><span>pierwotnie</span></div><div class="dz-hed__frames"></div><div class="dz-hed__tags"></div><div class="dz-hed__bar"></div><div class="dz-hed__panel" hidden></div><div class="dz-hed__bubble" hidden></div><div class="dz-hed__help">Kliknij element, aby go zaznaczyć · <b>przeciągnij</b>, aby przenieść<br>róg ramki = rozmiar · ${kbd('Alt')} chwilowo bez przyciągania</div>`;
  root.append(el);
  const q = <T extends Element>(s: string): T => el.querySelector<T>(s)!;
  const framesEl = q<HTMLElement>('.dz-hed__frames');
  const tagsEl = q<HTMLElement>('.dz-hed__tags');
  const svg = q<SVGSVGElement>('.dz-hed__svg');
  const bar = q<HTMLElement>('.dz-hed__bar');
  const panel = q<HTMLElement>('.dz-hed__panel');
  const bubble = q<HTMLElement>('.dz-hed__bubble');
  const ghost = q<HTMLElement>('.dz-hed__ghost');
  const frames = new Map<HudLayoutSlot, HTMLElement>();
  for (const slot of HUD_LAYOUT_SLOTS) {
    const f = document.createElement('div');
    f.className = 'dz-hed__frame';
    f.dataset.slot = slot;
    f.innerHTML = `<span class="dz-hed__label"></span>${HANDLES.map((h) => `<i class="dz-hed__h" data-h="${h}"></i>`).join('')}`;
    framesEl.append(f);
    frames.set(slot, f);
  }

  o.setPreview(true);

  const vp = (): Size => ({ w: root.clientWidth, h: root.clientHeight });
  const dirty = (): boolean => JSON.stringify(draft.elements) !== JSON.stringify(start.elements);

  /** Element layout of a slot: the saved one, or its DEFAULT_HUD_LAYOUT entry (#174). */
  function layoutOf(slot: HudLayoutSlot): HudElementLayout {
    return draft.elements[slot] ?? defaultElementLayout(slot);
  }

  function setDraft(next: HudLayout, keepUndo = false): void {
    if (!keepUndo) undo.push(draft);
    if (undo.length > 100) undo.shift();
    draft = next;
    refresh();
  }
  const setSlot = (
    slot: HudLayoutSlot,
    lay: HudElementLayout | undefined,
    keepUndo = false,
  ): void => setDraft(withSlot(draft, slot, lay), keepUndo);

  function measure(): void {
    rects = {};
    for (const slot of HUD_LAYOUT_SLOTS) {
      const r = applier.rectOf(slot);
      if (r) rects[slot] = r;
    }
  }

  function refresh(guides: readonly SnapGuide[] = []): void {
    if (disposed) return;
    applier.apply(draft, true);
    measure();
    render(guides);
  }

  function render(guides: readonly SnapGuide[]): void {
    const v = vp();
    el.toggleAttribute('data-preview', preview);
    scrim.hidden = preview;
    el.toggleAttribute('data-grid', grid);
    const sel = selected;
    const selRect = sel ? rects[sel] : undefined;
    const targets = new Set(guides.map((g) => g.target).filter(Boolean));
    for (const slot of HUD_LAYOUT_SLOTS) {
      const f = frames.get(slot)!;
      const r = rects[slot];
      f.hidden = !r;
      if (!r) continue;
      const pad = 4;
      Object.assign(f.style, {
        left: `${r.left - pad}px`,
        top: `${r.top - pad}px`,
        width: `${r.width + 2 * pad}px`,
        height: `${r.height + 2 * pad}px`,
      });
      const over = sel && sel !== slot && selRect && overlaps(selRect, r);
      f.toggleAttribute('data-sel', slot === sel);
      f.toggleAttribute('data-warn', !!over);
      f.toggleAttribute('data-snap', targets.has(slot));
      f.toggleAttribute('data-off', draft.elements[slot]?.visible === false);
      const label = f.querySelector<HTMLElement>('.dz-hed__label')!;
      const text = over
        ? `${SLOT_NAMES[slot]} · nachodzi na ${SLOT_NAMES[sel].toLowerCase()}`
        : drag?.slot === slot && drag.moved
          ? `${SLOT_NAMES[slot]} · przeciąganie`
          : SLOT_LABELS[slot];
      if (label.textContent !== text) label.textContent = text;
      // Beside the frame: right if it fits, else left; the top bar inside.
      label.dataset.side =
        slot === 'topbar'
          ? 'in'
          : r.left + r.width + pad + 8 + LABEL_W < v.w
            ? 'right'
            : r.left - pad - 8 - LABEL_W > 0
              ? 'left'
              : 'top';
    }
    renderSvg(guides, v);
    renderTags(guides);
    renderBar();
    renderPanel(v);
  }

  function renderSvg(guides: readonly SnapGuide[], v: Size): void {
    let out = '';
    for (const g of guides) {
      const from = g.from ?? 0;
      const to = g.to ?? (g.axis === 'x' ? v.h : v.w);
      out +=
        g.axis === 'x'
          ? `<line class="dz-hed__guide" x1="${g.pos}" y1="${from}" x2="${g.pos}" y2="${to}"/>`
          : `<line class="dz-hed__guide" x1="${from}" y1="${g.pos}" x2="${to}" y2="${g.pos}"/>`;
    }
    // Selected element → its anchor corner on the screen (dashed accent line, corner marker).
    const sel = selected;
    const r = sel ? rects[sel] : undefined;
    const lay = sel ? layoutOf(sel) : undefined;
    if (r && lay && !preview && sel !== 'topbar') {
      const { h, v: vv } = anchorAxes(lay.anchor);
      const sx = h === 'l' ? 0 : h === 'r' ? v.w : v.w / 2;
      const sy = vv === 't' ? 0 : vv === 'b' ? v.h : v.h / 2;
      const ex = h === 'l' ? r.left : h === 'r' ? r.left + r.width : r.left + r.width / 2;
      const ey = vv === 't' ? r.top : vv === 'b' ? r.top + r.height : r.top + r.height / 2;
      out += `<line class="dz-hed__anchor-line" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}"/>`;
      const mx = Math.min(Math.max(sx, 5), v.w - 5);
      const my = Math.min(Math.max(sy, 5), v.h - 5);
      out += `<rect class="dz-hed__anchor-mark" x="${mx - 5}" y="${my - 5}" width="10" height="10"/>`;
    }
    svg.setAttribute('viewBox', `0 0 ${v.w} ${v.h}`);
    svg.innerHTML = out;
  }

  function renderTags(guides: readonly SnapGuide[]): void {
    tagsEl.innerHTML = guides
      .filter((g) => g.kind !== 'grid')
      .map((g) => {
        const text =
          g.label ??
          (g.kind === 'edge'
            ? g.pos === SAFE_PX || g.pos === (g.axis === 'x' ? vp().w : vp().h) - SAFE_PX
              ? `krawędź ekranu · ${SAFE_PX} px`
              : 'krawędź ekranu'
            : g.kind === 'center'
              ? 'środek ekranu'
              : g.target
                ? `wyrównanie · ${SLOT_NAMES[g.target]}`
                : '');
        const mid = ((g.from ?? 0) + (g.to ?? (g.axis === 'x' ? vp().h : vp().w))) / 2;
        const x = g.axis === 'x' ? g.pos + 6 : mid;
        const y = g.axis === 'x' ? mid : g.pos + 6;
        return `<span class="dz-hed__tag" style="left:${x}px;top:${y}px">${esc(text)}</span>`;
      })
      .join('');
  }

  function renderBar(): void {
    const sw = (on: boolean): string => `<i class="dz-hed__sw" data-on="${on}"></i>`;
    bar.innerHTML = `<span class="dz-hed__title">EDYCJA HUD</span>
<button type="button" data-act="grid" data-on="${grid}">${icon('grid', 15)}Siatka ${sw(grid)}${kbd('G')}</button>
<button type="button" data-act="snap" data-on="${snap}">${icon('magnet', 15)}Przyciąganie ${sw(snap)}${kbd('S')}</button>
<button type="button" data-act="preview" data-on="${preview}">${icon('eye', 15)}Podgląd${kbd('P')}</button>
<button type="button" data-act="defaults">${icon('reset', 15)}Przywróć domyślny</button>
<button type="button" data-act="cancel">Anuluj${kbd('Esc')}</button>
<button type="button" data-act="save" class="dz-hed__save">Zapisz${kbd('Enter')}</button>`;
  }

  function renderPanel(v: Size): void {
    const sel = selected;
    const r = sel ? rects[sel] : undefined;
    const lay = sel ? layoutOf(sel) : undefined;
    panel.hidden = !sel || !r || !lay || preview;
    if (!sel || !r || !lay || panel.hidden) return;
    const p = positionText(lay);
    const small = lay.scale * o.uiScale < 0.8;
    const visible = lay.visible;
    panel.innerHTML = `<div class="dz-hed__ptitle">${esc(SLOT_NAMES[sel].toUpperCase())}</div>
<div class="dz-hed__pline">${icon('anchor', 13)}<span class="dz-hed__muted">Kotwica:</span> <b>${esc(ANCHOR_NAMES[lay.anchor])}</b></div>
<div class="dz-hed__pline dz-hed__pos"><span class="dz-hed__muted">X</span> <b>${p.x}</b> <span class="dz-hed__muted">${p.xs}</span> <span class="dz-hed__muted">Y</span> <b>${p.y}</b> <span class="dz-hed__muted">${p.ys}</span></div>
<div class="dz-hed__sep"></div>
<label class="dz-hed__slabel"><span>Rozmiar</span><b>${pct(lay.scale)}</b></label>
<div class="dz-hed__srow"><span>50%</span><input type="range" data-s="scale" min="50" max="150" step="5" value="${Math.round(lay.scale * 100)}"><span>150%</span></div>
${small ? '<div class="dz-hed__warn">Tekst może być nieczytelny</div>' : ''}
<label class="dz-hed__slabel"><span>Przezroczystość</span><b>${pct(lay.opacity)}</b></label>
<div class="dz-hed__srow"><span>20%</span><input type="range" data-s="opacity" min="20" max="100" step="5" value="${Math.round(lay.opacity * 100)}"><span>100%</span></div>
<div class="dz-hed__note">100% = w pełni widoczny</div>
<button type="button" class="dz-hed__vis" data-act="visible" data-on="${visible}"><span>Widoczny w grze</span><i class="dz-hed__sw" data-on="${visible}"></i></button>
<div class="dz-hed__sep"></div>
<button type="button" class="dz-hed__reset" data-act="reset"${draft.elements[sel] ? '' : ' disabled'}>Resetuj element ${kbd('R')}</button>
<div class="dz-hed__keys">${kbd('Strzałki')} 1 px ${kbd('Shift')}+${kbd('Strzałki')} 10 px<br>${kbd('Tab')} następny element ${kbd('Del')} ukryj</div>`;
    // Beside the element, never off screen.
    // Chrome scales with the HUD (`--hud2-s`, transform from the top-left corner).
    const z = Number.parseFloat(getComputedStyle(root).getPropertyValue('--hud2-s')) || 1;
    const pw = 262 * z;
    const ph = panel.getBoundingClientRect().height || 300 * z;
    const right = r.left + r.width / 2 > v.w / 2;
    let left = right ? r.left - pw - 28 : r.left + r.width + 28;
    if (left < SAFE_PX || left + pw > v.w - SAFE_PX) left = (v.w - pw) / 2;
    let top = r.top + r.height / 2 > v.h / 2 ? r.top + r.height - ph : r.top;
    top = Math.min(Math.max(SAFE_PX + 60, top), v.h - ph - SAFE_PX);
    panel.style.left = `${Math.max(SAFE_PX, left)}px`;
    panel.style.top = `${Math.max(SAFE_PX, top)}px`;
  }

  // ── Drag / resize ───────────────────────────────────────────────────────────────────────
  let drag:
    | {
        slot: HudLayoutSlot;
        handle?: Handle;
        x: number;
        y: number;
        rect: Rect;
        lay: HudElementLayout;
        before: HudLayout;
        moved: boolean;
      }
    | undefined;

  const local = (e: PointerEvent): { x: number; y: number } => {
    const b = root.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };

  function onDown(e: PointerEvent): void {
    if (confirm || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.dz-hed__bar, .dz-hed__panel')) return;
    const frame = t.closest<HTMLElement>('.dz-hed__frame');
    const slot = frame?.dataset.slot as HudLayoutSlot | undefined;
    if (!slot || preview) {
      if (!preview && !frame) {
        selected = undefined;
        render([]);
      }
      return;
    }
    const r = rects[slot];
    const lay = layoutOf(slot);
    if (!r || !lay) return;
    selected = slot;
    const p = local(e);
    const handle = t.closest<HTMLElement>('.dz-hed__h')?.dataset.h as Handle | undefined;
    drag = {
      slot,
      x: p.x,
      y: p.y,
      rect: r,
      lay,
      before: draft,
      moved: false,
      ...(handle ? { handle } : {}),
    };
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    render([]);
  }

  function onMove(e: PointerEvent): void {
    if (!drag) return;
    const p = local(e);
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    drag.moved = true;
    const v = vp();
    const { slot, rect: r0, lay } = drag;
    if (drag.handle) {
      const h = drag.handle;
      const fx = h.includes('w')
        ? r0.left + r0.width
        : h.includes('e')
          ? r0.left
          : r0.left + r0.width / 2;
      const fy = h.includes('n')
        ? r0.top + r0.height
        : h.includes('s')
          ? r0.top
          : r0.top + r0.height / 2;
      const ratio =
        h === 'n' || h === 's'
          ? Math.abs(p.y - fy) / Math.max(1, r0.height)
          : Math.abs(p.x - fx) / Math.max(1, r0.width);
      const scale = snapScale(lay.scale * ratio);
      const k = scale / lay.scale;
      const w = r0.width * k;
      const hh = r0.height * k;
      const left = h.includes('w') ? fx - w : h.includes('e') ? fx : fx - w / 2;
      const top = h.includes('n') ? fy - hh : h.includes('s') ? fy : fy - hh / 2;
      const rect = clampRect({ left, top, width: w, height: hh }, v);
      setSlot(
        slot,
        layoutFromRect(rect, v, { scale, opacity: lay.opacity, visible: lay.visible }, lay.anchor),
        true,
      );
      showBubble(p, rect, slot, []);
      return;
    }
    ghost.hidden = false;
    Object.assign(ghost.style, {
      left: `${r0.left}px`,
      top: `${r0.top}px`,
      width: `${r0.width}px`,
      height: `${r0.height}px`,
    });
    el.setAttribute('data-drag', '');
    const moved: Rect = { ...r0, left: r0.left + dx, top: r0.top + dy };
    const others = HUD_LAYOUT_SLOTS.filter((s) => s !== slot && rects[s]).map((s) => ({
      slot: s,
      rect: rects[s]!,
    }));
    const useSnap = snap && !e.altKey;
    const res = snapRect(moved, others, v, { snap: useSnap, grid: useSnap && grid });
    const rect = { ...moved, left: res.left, top: res.top };
    setSlot(
      slot,
      layoutFromRect(rect, v, { scale: lay.scale, opacity: lay.opacity, visible: lay.visible }),
      true,
    );
    render(res.guides);
    showBubble(p, rect, slot, res.labels);
    const b = bar.getBoundingClientRect();
    const rb = root.getBoundingClientRect();
    bar.toggleAttribute(
      'data-dim',
      overlaps(rect, {
        left: b.left - rb.left,
        top: b.top - rb.top,
        width: b.width,
        height: b.height,
      }),
    );
  }

  function showBubble(
    p: { x: number; y: number },
    r: Rect,
    slot: HudLayoutSlot,
    labels: string[],
  ): void {
    const lay = draft.elements[slot];
    if (!lay) return;
    const t = positionText(lay);
    const v = vp();
    const { h, v: vv } = anchorAxes(lay.anchor);
    const xPx =
      h === 'l' ? r.left : h === 'r' ? v.w - r.left - r.width : r.left + r.width / 2 - v.w / 2;
    const yPx =
      vv === 't' ? r.top : vv === 'b' ? v.h - r.top - r.height : r.top + r.height / 2 - v.h / 2;
    bubble.hidden = false;
    bubble.innerHTML = `<b>Kotwica: ${esc(ANCHOR_NAMES[lay.anchor])}</b><br>X ${Math.round(xPx)} px · ${t.x}<br>Y ${Math.round(yPx)} px · ${t.y}${labels.length ? `<br><span class="dz-hed__muted">przyciąga: ${esc(labels.join(' + '))}</span>` : ''}`;
    const bw = 200;
    const left = Math.min(p.x + 18, v.w - bw - 8);
    const top = Math.min(p.y + 18, v.h - 90);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function onUp(): void {
    if (!drag) return;
    if (drag.moved) {
      undo.push(drag.before);
    }
    drag = undefined;
    ghost.hidden = true;
    bubble.hidden = true;
    el.removeAttribute('data-drag');
    bar.removeAttribute('data-dim');
    refresh();
  }

  // ── Panel and toolbar ───────────────────────────────────────────────────────────────────
  let sliderBefore: HudLayout | undefined;
  function onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    const which = t.dataset.s;
    const sel = selected;
    if (!which || !sel) return;
    const lay = layoutOf(sel);
    if (!lay) return;
    if (!sliderBefore) sliderBefore = draft;
    const v = Number(t.value) / 100;
    const next =
      which === 'scale' ? { ...lay, scale: snapScale(v) } : { ...lay, opacity: snapOpacity(v) };
    draft = withSlot(draft, sel, next);
    applier.apply(draft, true);
    measure();
    // Keep the slider element under the pointer: only update texts, not the whole panel.
    renderSvg([], vp());
    for (const slot of HUD_LAYOUT_SLOTS) {
      const r = rects[slot];
      const f = frames.get(slot)!;
      if (!r) continue;
      Object.assign(f.style, {
        left: `${r.left - 4}px`,
        top: `${r.top - 4}px`,
        width: `${r.width + 8}px`,
        height: `${r.height + 8}px`,
      });
    }
    const label = t.closest('.dz-hed__srow')?.previousElementSibling?.querySelector('b');
    if (label) label.textContent = pct(which === 'scale' ? next.scale : next.opacity);
  }
  function onChange(): void {
    if (sliderBefore) undo.push(sliderBefore);
    sliderBefore = undefined;
    refresh();
  }

  function act(a: string): void {
    const sel = selected;
    switch (a) {
      case 'grid':
        grid = !grid;
        render([]);
        break;
      case 'snap':
        snap = !snap;
        render([]);
        break;
      case 'preview':
        preview = !preview;
        render([]);
        break;
      case 'defaults':
        ask(
          'PRZYWRÓCIĆ DOMYŚLNY UKŁAD HUD?',
          'Wszystkie elementy wrócą na miejsca. Skala interfejsu zostaje.',
          'PRZYWRÓĆ',
          () => setDraft({ version: HUD_LAYOUT_VERSION, elements: {} }),
        );
        break;
      case 'cancel':
        cancel();
        break;
      case 'save':
        save();
        break;
      case 'reset':
        // Back to DEFAULT_HUD_LAYOUT; withSlot drops a default entry (only changes are saved).
        if (sel && draft.elements[sel]) setSlot(sel, defaultElementLayout(sel));
        break;
      case 'visible': {
        const lay = sel ? layoutOf(sel) : undefined;
        if (sel && lay) setSlot(sel, { ...lay, visible: !lay.visible });
        break;
      }
    }
  }

  function onClick(e: MouseEvent): void {
    if (confirm) {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-confirm]');
      if (b) answer(b.dataset.confirm === 'yes');
      return;
    }
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (a) act(a);
  }

  function ask(title: string, body: string, yes: string, onYes: () => void): void {
    const box = document.createElement('div');
    box.className = 'dz-hed__confirm';
    box.innerHTML = `<div class="dz-hed__cbox"><b>${esc(title)}</b><p>${esc(body)}</p><div><button type="button" data-confirm="no">WRÓĆ ${kbd('Esc')}</button><button type="button" data-confirm="yes" class="dz-hed__save">${esc(yes)} ${kbd('Enter')}</button></div></div>`;
    el.append(box);
    confirm = { el: box, yes: onYes };
  }
  function answer(yes: boolean): void {
    const c = confirm;
    if (!c) return;
    confirm = undefined;
    c.el.remove();
    if (yes) c.yes();
  }

  function cancel(): void {
    if (!dirty()) return finish(false);
    ask('ODRZUCIĆ ZMIANY?', 'Zmiany układu HUD nie zostaną zapisane.', 'ODRZUĆ', () =>
      finish(false),
    );
  }
  function save(): void {
    finish(true);
  }
  function finish(saved: boolean): void {
    const result = draft;
    api.dispose();
    if (saved) o.onSave(result);
    else {
      applier.apply(start);
      o.onCancel();
    }
  }

  function moveBy(dx: number, dy: number): void {
    const sel = selected;
    const r = sel ? rects[sel] : undefined;
    const lay = sel ? layoutOf(sel) : undefined;
    if (!sel || !r || !lay) return;
    const v = vp();
    const rect = clampRect({ ...r, left: r.left + dx, top: r.top + dy }, v);
    setSlot(sel, layoutFromRect(rect, v, lay, lay.anchor));
  }

  function onKey(e: KeyboardEvent): boolean {
    if (disposed) return false;
    if (confirm) {
      if (e.code === 'Escape') answer(false);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') answer(true);
      return true;
    }
    if (e.repeat && (e.code === 'Escape' || e.code === 'Enter')) return true;
    const step = e.shiftKey ? 10 : 1;
    const sel = selected;
    switch (e.code) {
      case 'Escape':
        cancel();
        return true;
      case 'Enter':
      case 'NumpadEnter':
        save();
        return true;
      case 'ArrowLeft':
        moveBy(-step, 0);
        return true;
      case 'ArrowRight':
        moveBy(step, 0);
        return true;
      case 'ArrowUp':
        moveBy(0, -step);
        return true;
      case 'ArrowDown':
        moveBy(0, step);
        return true;
      case 'Tab': {
        const list = HUD_LAYOUT_SLOTS.filter((s) => rects[s]);
        const i = sel ? list.indexOf(sel) : -1;
        const n = list.length;
        selected = list[(((i + (e.shiftKey ? -1 : 1)) % n) + n) % n];
        render([]);
        return true;
      }
      case 'Equal':
      case 'NumpadAdd':
      case 'Minus':
      case 'NumpadSubtract': {
        const lay = sel ? layoutOf(sel) : undefined;
        if (sel && lay) {
          const d = e.code === 'Equal' || e.code === 'NumpadAdd' ? SCALE_STEP : -SCALE_STEP;
          setSlot(sel, { ...lay, scale: snapScale(lay.scale + d) });
        }
        return true;
      }
      case 'KeyR':
        act('reset');
        return true;
      case 'Delete':
        act('visible');
        return true;
      case 'KeyG':
        act('grid');
        return true;
      case 'KeyS':
        act('snap');
        return true;
      case 'KeyP':
        act('preview');
        return true;
      case 'KeyZ':
        if (e.ctrlKey || e.metaKey) {
          const prev = undo.pop();
          if (prev) setDraft(prev, true);
        }
        return true;
    }
    return true;
  }

  const onResize = (): void => refresh();
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', onResize);
  refresh();

  const api: HudEditor = {
    get layout() {
      return draft;
    },
    onKey,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('resize', onResize);
      o.setPreview(false);
      el.remove();
      scrim.remove();
    },
  };
  return api;
}
