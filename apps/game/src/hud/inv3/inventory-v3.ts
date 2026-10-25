import './inventory-v3.css';
import { dragDecision, LONG_PRESS_MS, longPressHolds } from '../../input/touch/gestures.js';
import type { ContainerId } from '@deadzone/protocol';
import { createIcon, createItemTooltip } from '@deadzone/ui';
import type { InventorySortSetting, InventoryViewMode } from '../../settings/schema.js';
import type { GameState } from '../../state/game-state.js';
import { combineCommand, combineTipVM } from '../combine-model.js';
import { createCombineTooltip, linkIcon } from '../combine-tooltip.js';
import type { HudContentIndex } from '../content-index.js';
import { contextCommand, findItem, formatKg, type InvCommand } from '../inventory-model.js';
import { containerName } from '../labels.js';
import { lootTabs, ownItems, reachableTabs, takeWithinLimit } from '../loot-model.js';
import { vehicleTypeName } from '../../vehicles/vehicle-model.js';
import { bindOutsideClose } from '../outside-click.js';
import {
  FRESHNESS_LOOK,
  SORT_OPTIONS,
  clickColumn,
  conditionColor,
  containerSection,
  distanceLabel,
  dropPreview,
  findAny,
  gridSlots,
  moveCommands,
  pieceKg,
  playerSections,
  selectionInfo,
  sortLabel,
  usesLabel,
  visibleRows,
  type InvRowVM,
  type InvSectionVM,
  type InvSide,
  type InvSort,
} from './inv3-model.js';

const isTouchUi = (): boolean =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('is-touch');

/** UI settings the window reads and writes (persisted in `view`). */
export interface InventoryUiPrefs {
  view: InventoryViewMode;
  sort: { player: InventorySortSetting; container: InventorySortSetting };
  group: boolean;
}

export interface InventoryV3Options {
  root: HTMLElement;
  send: (cmd: InvCommand) => void;
  state: () => GameState;
  content: () => HudContentIndex;
  prefs: () => InventoryUiPrefs;
  setPrefs: (p: InventoryUiPrefs) => void;
  /** Player position (sim tiles) for the container distance. */
  position: () => { x: number; y: number } | undefined;
  /** Tab click / Q / E: open another container in reach. */
  onSwitch: (id: ContainerId) => void;
  /** Key codes that combine the hovered item (default binding: crouch, `C`). */
  isCombineKey: (code: string) => boolean;
  /** Label of the combine key (tooltip). */
  combineKey: () => string;
  toast?: (text: string) => void;
}

export interface InventoryWindow {
  readonly open: boolean;
  toggle(): void;
  close(): void;
  /** R / „Weź wszystko”: the opened container into the inventory (up to the carry limit). */
  takeAll(): void;
  /** F / „Odłóż zaznaczone”: selected own items into the opened container. */
  putAll(): void;
  update(): void;
}

const DRAG_PX = 6;

const DOUBLE_MS = 350;

const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const div = (cls?: string, text?: string): HTMLDivElement => h('div', cls, text);
/** Footer of the player panel with a car key carried: `Kluczyk pasuje do: Sedan · to auto`. */
function keyFitsLabel(s: GameState): string {
  const key = ownItems(s).find((i) => i.vehicle !== undefined);
  if (key?.vehicle === undefined) return '';
  const car = s.vehicles.find((v) => v.vehicleId === key.vehicle);
  if (!car) return 'Kluczyk pasuje do: auta poza zasięgiem';
  const here = s.seat?.vehicleId === car.vehicleId ? 'to auto' : 'auto obok';
  return `Kluczyk pasuje do: ${vehicleTypeName(car.type)} · ${here}`;
}
const svgEl = (markup: string, cls = 'dz-i3__svg'): HTMLElement => {
  const s = h('span', cls);
  s.innerHTML = markup;
  return s;
};
const SV = (d: string, size = 15, sw = 2): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const CUBE = '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>';
const ICON = {
  trunk: SV('<path d="M3 12h18v6H3zM5 12l2-4h10l2 4M9 15h6"/>'),
  glovebox: SV('<rect x="4" y="8" width="16" height="9" rx="1"/><path d="M10 12h4"/>'),
  seat: SV('<path d="M8 4h4l1 9h5l1 7M8 4L7 14h6M10 14v6"/>', 13),
  bag: SV('<path d="M6 8h12l1 13H5z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  cabinet: SV(
    '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M12 3v18M10 11v2M14 11v2"/>',
  ),
  sort: SV('<path d="M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3"/>', 13),
  list: SV('<path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/>', 15),
  grid: SV(
    '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    15,
  ),
  chevD: SV('<path d="M6 9l6 6 6-6"/>', 12),
  check: SV('<path d="M4 12l5 5 11-11"/>', 12, 3),
  fridge: SV(
    '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 9h12M9 5v2M9 12v3"/>',
    14,
  ),
  ground: SV('<path d="M2 17l10-5 10 5-10 5z"/>', 14),
  box: SV('<rect x="3" y="5" width="18" height="15" rx="1"/><path d="M3 10h18"/>', 14),
};

const key = (k: string): HTMLElement => h('span', 'dz-i3__key', k);

/** Item icon: baked 3D icon (game atlas) or the vector icon. */
function iconEl(r: Pick<InvRowVM, 'icon' | 'image'>, size: number, cls = 'dz-i3__ic'): HTMLElement {
  const cell = h('span', cls);
  if (r.image) {
    const img = h('img');
    img.src = r.image;
    img.alt = '';
    img.draggable = false;
    cell.append(img);
  } else {
    const s = createIcon(document, r.icon, Math.round(size * 0.8));
    // Items without a baked or vector icon yet get the placeholder cube.
    if (s) cell.append(s);
    else cell.append(svgEl(SV(CUBE, Math.round(size * 0.7), 1.6), 'dz-i3__ic-ph'));
  }
  return cell;
}

/** „Stan” cell of the list (bar + value, dot + label, uses, or —). */
function stateCell(r: InvRowVM): HTMLElement {
  const c = div('dz-i3__st');
  const s = r.state;
  if (!s) {
    c.append(h('span', 'dz-i3__muted', r.children ? '' : '—'));
    return c;
  }
  if (s.kind === 'condition' || s.kind === 'fill') {
    const f = s.max > 0 ? Math.min(1, Math.max(0, s.value / s.max)) : 0;
    const bar = h('span', 'dz-i3__bar4');
    const fill = h('i');
    fill.style.width = `${Math.round(f * 100)}%`;
    fill.style.background = s.kind === 'fill' ? '#4FA8C8' : conditionColor(f);
    bar.append(fill);
    c.append(
      bar,
      h(
        'span',
        'dz-i3__stv',
        s.kind === 'fill' ? `${Math.round(f * 100)}%` : `${Math.round(s.value)}/${s.max}`,
      ),
    );
  } else if (s.kind === 'freshness') {
    const look = FRESHNESS_LOOK[s.value];
    const dot = h('span', 'dz-i3__dot');
    dot.style.background = look.color;
    const t = h('span', 'dz-i3__stv', look.label);
    t.style.color = look.color;
    c.append(dot, t);
  } else c.append(h('span', 'dz-i3__stv dz-i3__muted', usesLabel(s.value)));
  return c;
}

/** 3 px state bar at the bottom of a grid tile. */
function tileBar(r: InvRowVM): HTMLElement | undefined {
  const s = r.state;
  if (!s || (s.kind !== 'condition' && s.kind !== 'fill')) return undefined;
  const f = s.max > 0 ? Math.min(1, Math.max(0, s.value / s.max)) : 0;
  const bar = h('span', 'dz-i3__tbar');
  const fill = h('i');
  fill.style.width = `${Math.round(f * 100)}%`;
  fill.style.background = s.kind === 'fill' ? '#4FA8C8' : conditionColor(f);
  bar.append(fill);
  return bar;
}

/**
 * Inventory v3 (HUD v2 spec „Ekwipunek v3”): the player panel on the left (W RĘKACH, KIESZENIE,
 * bags), the container panel on the right (tabs for everything in reach), list or grid view (Tab,
 * saved in the UI settings). LPM selects (Shift adds / ranges, Ctrl+A the section), Ctrl+LPM
 * moves the stack across, a double click one piece, drag moves one piece (Ctrl: the stack) onto
 * a section, outside the panels onto the floor. PPM equips / uses, C combines the hovered item.
 */
export function createInventoryV3(opts: InventoryV3Options): InventoryWindow {
  const el = div('dz-i3');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Ekwipunek');
  const stage = div('dz-i3__stage');
  const own = div('dz-i3__panel dz-i3__panel--own');
  const box = div('dz-i3__panel dz-i3__panel--box');
  const keys = div('dz-i3__keys');
  for (const [k, t] of [
    ['LPM', 'przeciągnij'],
    ['Ctrl+LPM', 'cały stos'],
    ['Shift+LPM', 'zaznacz'],
    ['Tab', 'lista / siatka'],
    ['Q / E', 'kontener'],
    ['R', 'weź wszystko'],
    ['I / Esc', 'zamknij'],
  ] as const) {
    const s = h('span');
    s.append(key(k), h('em', '', t));
    keys.append(s);
  }
  const ghost = div('dz-i3__ghost');
  ghost.hidden = true;
  const badge = div('dz-i3__badge');
  badge.hidden = true;
  const menu = div('dz-i3__menu');
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  const tooltip = createItemTooltip();
  tooltip.el.classList.add('dz-i3__tip');
  const tipIcon = h('span', 'dz-i3__tip-ic');
  tooltip.el.querySelector('.dz-tooltip__head')?.prepend(tipIcon);
  const comboTip = createCombineTooltip();
  stage.append(own, box, keys, ghost, badge, menu, tooltip.el, comboTip.el);
  el.append(div('dz-i3__scrim'), stage);
  opts.root.append(el);

  let isOpen = false;
  let last: GameState | undefined;
  let lastContent: HudContentIndex | undefined;
  const selected: Record<InvSide, Set<number>> = { own: new Set(), box: new Set() };
  const anchor: Partial<Record<InvSide, string>> = {};
  /** Expanded group rows / collapsed sections (session only). */
  const expanded = new Set<string>();
  const collapsed = new Set<string>();
  /** Rows by key → element + vm (hover restore, ranges). */
  const rowEls = new Map<string, { el: HTMLElement; row: InvRowVM; side: InvSide }>();
  /** Visible order of row keys per side (Shift ranges). */
  const order: Record<InvSide, InvRowVM[]> = { own: [], box: [] };
  let sections: InvSectionVM[] = [];
  let boxSection: InvSectionVM | undefined;
  let hovered: { key: string; side: InvSide } | undefined;
  let hoverSection: string | undefined;
  let lastClick: { key: string; at: number } | undefined;
  let menuFor: InvSide | undefined;
  let drag:
    | {
        side: InvSide;
        row: InvRowVM;
        ids: number[];
        x: number;
        y: number;
        active: boolean;
        pointer: number;
        /** Touch press (mobile): drags only after TOUCH_DRAG_HOLD_MS, earlier moves scroll. */
        touch?: { at: number; y: number };
        target?: InvSectionVM | 'ground' | undefined;
      }
    | undefined;
  let ctrlAlone = false;

  const send = (cmds: readonly (InvCommand | undefined)[]): void => {
    for (const c of cmds) if (c) opts.send(c);
  };
  /** On a phone the inventory is always the 48 pt grid of the mobile mockup (no list toggle). */
  const prefs = (): InventoryUiPrefs => {
    const p = opts.prefs();
    return isTouchUi() ? { ...p, view: 'grid' } : p;
  };
  const sortOf = (side: InvSide): InventorySortSetting =>
    side === 'own' ? prefs().sort.player : prefs().sort.container;
  const setSort = (side: InvSide, s: InventorySortSetting): void => {
    const p = prefs();
    opts.setPrefs({
      ...p,
      sort: side === 'own' ? { ...p.sort, player: s } : { ...p.sort, container: s },
    });
    render();
  };
  const toggleView = (): void => {
    const p = prefs();
    opts.setPrefs({ ...p, view: p.view === 'list' ? 'grid' : 'list' });
    render();
  };

  // ── tooltips ──────────────────────────────────────────────────────────────
  /** Row whose tooltip is shown or pending. */
  let tipKey: string | undefined;
  const hideTips = (): void => {
    tooltip.unhover();
    comboTip.hide();
    tipKey = undefined;
  };
  const showTip = (target: HTMLElement, r: InvRowVM, grid: boolean): void => {
    if (drag?.active) return;
    tipKey = r.key;
    const s = opts.state();
    const first = r.itemIds[0];
    const it = first === undefined || !r.combine ? undefined : findItem(s, first);
    const combo = it ? combineTipVM(it, s.crafting, opts.content()) : undefined;
    const host = stage.getBoundingClientRect();
    const k = host.width / Math.max(1, stage.offsetWidth);
    const rr = target.getBoundingClientRect();
    const place = (w: number, hgt: number): { left: number; top: number } => {
      const W = stage.offsetWidth;
      const H = stage.offsetHeight;
      let left: number;
      let top: number;
      if (grid) {
        left = (rr.left - host.left) / k;
        top = (rr.bottom - host.top) / k + 8;
      } else {
        const right = (rr.right - host.left) / k + 8;
        left = right + w > W - 8 ? (rr.left - host.left) / k - 8 - w : right;
        top = (rr.top - host.top) / k - 8;
      }
      if (top + hgt > H - 8) top = grid ? (rr.top - host.top) / k - 8 - hgt : H - 8 - hgt;
      return { left: Math.max(8, Math.min(W - 8 - w, left)), top: Math.max(8, top) };
    };
    if (combo) {
      tooltip.hide();
      comboTip.show(combo, {
        combine: opts.combineKey(),
        ...(r.context ? {} : { context: 'PPM' }),
      });
      comboTip.place(place(380, 420));
      return;
    }
    comboTip.hide();
    tipIcon.replaceChildren(iconEl(r, 34));
    tooltip.hover(r.tooltip);
    tooltip.place(place(252, tooltip.el.offsetHeight || 260));
  };

  // ── selection & transfers ────────────────────────────────────────────────
  const isSelected = (side: InvSide, r: InvRowVM): boolean =>
    r.itemIds.length > 0 && r.itemIds.every((id) => selected[side].has(id));
  const select = (side: InvSide, r: InvRowVM, e: MouseEvent): void => {
    const sel = selected[side];
    const other: InvSide = side === 'own' ? 'box' : 'own';
    selected[other].clear();
    if (e.shiftKey) {
      const list = order[side];
      const a = anchor[side] === undefined ? -1 : list.findIndex((x) => x.key === anchor[side]);
      const b = list.findIndex((x) => x.key === r.key);
      if (isSelected(side, r)) for (const id of r.itemIds) sel.delete(id);
      else if (a >= 0 && b >= 0 && a !== b) {
        for (const x of list.slice(Math.min(a, b), Math.max(a, b) + 1))
          for (const id of x.itemIds) sel.add(id);
      } else {
        for (const id of r.itemIds) sel.add(id);
        anchor[side] = r.key;
      }
    } else {
      sel.clear();
      for (const id of r.itemIds) sel.add(id);
      anchor[side] = r.key;
    }
    render();
  };
  /** The other side of `side`: own → the opened container, box → the main inventory. */
  const otherSection = (side: InvSide): InvSectionVM | undefined =>
    side === 'own' ? boxSection : sections.find((x) => x.kind === 'main');
  const transfer = (side: InvSide, ids: readonly number[], whole: boolean): void => {
    const to = otherSection(side);
    if (!to) {
      opts.toast?.('Brak otwartego pojemnika');
      return;
    }
    const s = opts.state();
    if (side === 'box' && whole) {
      const r = takeWithinLimit(s, ids, s.inventory?.hardLimitKg);
      send(r.cmds);
      if (r.left > 0) opts.toast?.(`Za ciężko: zostało ${r.left} poz.`);
    } else send(moveCommands(s, opts.content(), ids, to, whole));
    selected[side].clear();
  };
  const moveSelected = (): void => {
    const side: InvSide = selected.box.size ? 'box' : 'own';
    if (selected[side].size) transfer(side, [...selected[side]], true);
  };
  const dropSelected = (): void => {
    if (!selected.own.size) return;
    send(moveCommands(opts.state(), opts.content(), [...selected.own], 'ground', true));
    selected.own.clear();
  };
  const combine = (id: number | undefined): void => {
    if (id === undefined) return;
    const s = opts.state();
    const cmd = combineCommand(findItem(s, id), s.crafting);
    if (cmd) opts.send(cmd);
  };

  /** Last pointer position (long-press stillness check). */
  const lastPt = { x: 0, y: 0 };

  // ── rendering ─────────────────────────────────────────────────────────────
  const bindItem = (node: HTMLElement, side: InvSide, r: InvRowVM, grid: boolean): void => {
    node.dataset.key = r.key;
    rowEls.set(r.key, { el: node, row: r, side });
    if (isSelected(side, r)) node.dataset.selected = 'true';
    if (r.combine) node.dataset.combo = r.combine.state;
    if (drag?.active && drag.row.key === r.key) node.dataset.dragging = 'true';
    node.addEventListener('pointerenter', () => {
      hovered = { key: r.key, side };
      showTip(node, r, grid);
    });
    node.addEventListener('pointerleave', () => {
      if (hovered?.key === r.key) hovered = undefined;
      hideTips();
    });
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = {
        side,
        row: r,
        ids: isSelected(side, r) ? [...selected[side]] : r.itemIds,
        x: e.clientX,
        y: e.clientY,
        active: false,
        pointer: e.pointerId,
        ...(e.pointerType === 'touch' ? { touch: { at: e.timeStamp, y: e.clientY } } : {}),
      };
      if (e.pointerType !== 'touch') return;
      // Long press (finger resting, no drag): the desktop right-click action.
      lastPt.x = e.clientX;
      lastPt.y = e.clientY;
      const pid = e.pointerId;
      const x0 = e.clientX;
      const y0 = e.clientY;
      window.setTimeout(() => {
        const d = drag;
        if (!d || d.pointer !== pid || d.active || d.row.key !== r.key) return;
        if (!longPressHolds(LONG_PRESS_MS, Math.hypot(lastPt.x - x0, lastPt.y - y0))) return;
        drag = undefined;
        lastClick = undefined;
        if (navigator.vibrate) navigator.vibrate(15);
        contextAction();
      }, LONG_PRESS_MS);
    });
    const contextAction = (): void => {
      const id = r.itemIds[0];
      if (id === undefined) return;
      if (!r.context && r.combine) combine(id);
      else send([contextCommand(opts.state(), opts.content(), id)]);
    };
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Touch: the long-press timer below already ran it (browsers also fire contextmenu).
      if (isTouchUi()) return;
      contextAction();
    });
  };

  const sectionHead = (sec: InvSectionVM): HTMLElement => {
    const hd = div('dz-i3__sec-h');
    hd.append(h('span', 'dz-i3__sec-t', sec.title.toUpperCase()), h('span', 'dz-i3__sec-line'));
    if (sec.capacityKg !== null) {
      const bar = h('span', 'dz-i3__bar70');
      const fill = h('i');
      const f = sec.capacityKg > 0 ? sec.weightKg / sec.capacityKg : 0;
      fill.style.width = `${Math.min(100, f * 100)}%`;
      if (f > 1) fill.dataset.over = 'true';
      bar.append(fill);
      hd.append(bar);
    }
    if (sec.reductionPct) hd.append(h('span', 'dz-i3__red', `−${sec.reductionPct}% wagi`));
    hd.append(
      h(
        'span',
        'dz-i3__sec-w',
        sec.capacityKg === null
          ? `${formatKg(sec.weightKg)} kg`
          : `${formatKg(sec.weightKg)} / ${formatKg(sec.capacityKg)} kg`,
      ),
    );
    if (sec.kind === 'bag') {
      hd.dataset.toggle = 'true';
      hd.addEventListener('click', () => {
        if (collapsed.has(sec.key)) collapsed.delete(sec.key);
        else collapsed.add(sec.key);
        render();
      });
    }
    return hd;
  };

  const listRow = (side: InvSide, r: InvRowVM, child: boolean): HTMLElement => {
    const row = div('dz-i3__row');
    if (child) row.dataset.child = 'true';
    const chev = h('span', 'dz-i3__chev');
    if (r.children) {
      chev.textContent = expanded.has(r.key) ? '▾' : '▸';
      chev.addEventListener('pointerdown', (e) => e.stopPropagation());
      chev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expanded.has(r.key)) expanded.delete(r.key);
        else expanded.add(r.key);
        render();
      });
    }
    const name = div('dz-i3__nm');
    name.append(iconEl(r, 24), h('span', 'dz-i3__nm-t', r.name));
    if (r.hand) name.append(h('span', 'dz-i3__hand', r.hand));
    if (r.combine) name.append(svgEl(linkIcon(11).outerHTML, 'dz-i3__cb'));
    row.append(
      chev,
      name,
      h('span', 'dz-i3__num', String(r.count)),
      h('span', 'dz-i3__num', formatKg(r.weightKg)),
      stateCell(r),
    );
    bindItem(row, side, r, false);
    return row;
  };

  const tile = (side: InvSide, r: InvRowVM): HTMLElement => {
    const t = div('dz-i3__tile');
    t.append(iconEl(r, 40, 'dz-i3__tic'));
    if (r.count > 1) t.append(h('span', 'dz-i3__tn', String(r.count)));
    const bar = tileBar(r);
    if (bar) t.append(bar);
    if (r.state?.kind === 'freshness') {
      const dot = h('span', 'dz-i3__tdot');
      dot.style.background = FRESHNESS_LOOK[r.state.value].color;
      t.append(dot);
    }
    if (r.hand) t.append(h('span', 'dz-i3__hand dz-i3__hand--tile', r.hand));
    if (r.combine) t.append(svgEl(linkIcon(11).outerHTML, 'dz-i3__cb dz-i3__cb--tile'));
    bindItem(t, side, r, true);
    return t;
  };

  const sectionBody = (side: InvSide, sec: InvSectionVM, view: InventoryViewMode): HTMLElement => {
    const wrap = div('dz-i3__sec');
    wrap.dataset.sec = sec.key;
    if (drag?.active && drag.target !== 'ground' && drag.target?.key === sec.key) {
      wrap.dataset.drop = dropPreview(sec, dragKg()).fits ? 'ok' : 'full';
    }
    if (side === 'own') wrap.append(sectionHead(sec));
    if (collapsed.has(sec.key)) return wrap;
    if (view === 'list') {
      const vis = visibleRows(sec.rows, expanded);
      for (const { row, child } of vis) {
        order[side].push(row);
        wrap.append(listRow(side, row, child));
      }
      for (const f of sec.freeHands ?? []) {
        const free = div('dz-i3__row dz-i3__row--free');
        const nm = div('dz-i3__nm');
        nm.append(
          h('span', 'dz-i3__ic dz-i3__ic--free'),
          h('span', 'dz-i3__nm-t', `${f === 'L' ? 'Lewa' : 'Prawa'} ręka · wolna`),
        );
        free.append(h('span', 'dz-i3__chev'), nm);
        wrap.append(free);
      }
      if (!sec.rows.length && !sec.freeHands?.length) wrap.append(div('dz-i3__empty', 'Pusto'));
    } else {
      const grid = div('dz-i3__grid');
      for (const r of sec.rows) {
        order[side].push(r);
        grid.append(tile(side, r));
      }
      if (sec.kind === 'hands') {
        for (const f of sec.freeHands ?? []) {
          const t = div('dz-i3__tile dz-i3__tile--empty');
          t.append(h('span', 'dz-i3__tfree', f));
          grid.append(t);
        }
      } else {
        const n = sec.rows.length;
        const total = side === 'box' ? Math.max(gridSlots(n), 27) : gridSlots(n);
        for (let i = n; i < total; i++) grid.append(div('dz-i3__tile dz-i3__tile--empty'));
      }
      wrap.append(grid);
    }
    return wrap;
  };

  const colHeads = (side: InvSide): HTMLElement => {
    const c = div('dz-i3__cols');
    const sort = sortOf(side);
    const col = (label: string, by: InvSort): HTMLElement => {
      const b = h('span', 'dz-i3__col', label);
      if (sort.by === by) b.dataset.on = sort.desc ? 'desc' : 'asc';
      b.addEventListener('click', () => setSort(side, clickColumn(sort, by)));
      return b;
    };
    c.append(
      h('span', 'dz-i3__chev'),
      col('NAZWA', 'name'),
      col('ILOŚĆ', 'count'),
      col('WAGA', 'weight'),
      col('STAN', 'condition'),
    );
    return c;
  };

  const panelHead = (side: InvSide, icon: string, title: string, sub: string): HTMLElement => {
    const hd = div('dz-i3__head');
    hd.append(svgEl(icon, 'dz-i3__head-ic'), h('span', 'dz-i3__title', title));
    if (sub) hd.append(h('span', 'dz-i3__sub', sub));
    hd.append(h('span', 'dz-i3__grow'));
    const sortBtn = h('button', 'dz-i3__sort');
    sortBtn.type = 'button';
    sortBtn.dataset.side = side;
    sortBtn.append(
      svgEl(ICON.sort),
      h('span', 'dz-i3__muted', 'Sortuj:'),
      h('span', '', sortLabel(sortOf(side).by)),
      svgEl(ICON.chevD),
    );
    if (menuFor === side) sortBtn.dataset.on = 'true';
    sortBtn.addEventListener('click', () => {
      menuFor = menuFor === side ? undefined : side;
      render();
    });
    const view = prefs().view;
    const tog = div('dz-i3__vt');
    for (const v of ['list', 'grid'] as const) {
      const b = h('button', 'dz-i3__vt-b');
      b.type = 'button';
      b.setAttribute('aria-label', v === 'list' ? 'Lista' : 'Siatka');
      b.setAttribute('aria-pressed', String(view === v));
      if (view === v) b.dataset.on = 'true';
      b.innerHTML = ICON[v];
      b.addEventListener('click', () => {
        if (prefs().view !== v) toggleView();
      });
      tog.append(b);
    }
    hd.append(sortBtn, tog, key('Tab'));
    return hd;
  };

  const loadRow = (label: string, w: number, cap: number, hard: number | null, blue: boolean) => {
    const r = div('dz-i3__load');
    const bar = h('span', 'dz-i3__bar');
    const fill = h('i');
    fill.style.width = `${Math.min(100, (w / Math.max(cap, 1e-6)) * 100)}%`;
    if (blue) fill.dataset.blue = 'true';
    else if (hard !== null && w >= hard) fill.dataset.level = 'hard';
    else if (w >= cap) fill.dataset.level = 'over';
    bar.append(fill);
    const v = h('span', 'dz-i3__load-v');
    v.append(h('b', '', formatKg(w)), ` / ${formatKg(cap)} kg`);
    r.append(h('span', 'dz-i3__load-l', label), bar, v);
    return r;
  };

  const button = (label: string, k: string, on: () => void, disabled = false) => {
    const b = h('button', 'dz-i3__btn');
    b.type = 'button';
    b.append(h('span', '', label), key(k));
    b.disabled = disabled;
    b.addEventListener('click', on);
    return b;
  };

  const renderOwn = (s: GameState, view: InventoryViewMode): void => {
    const inv = s.inventory;
    const p = s.characterProfile;
    const name = p ? `${p.firstName} ${p.lastName}` : '';
    const parts: HTMLElement[] = [panelHead('own', ICON.bag, 'EKWIPUNEK', name)];
    if (inv) parts.push(loadRow('Obciążenie', inv.loadKg, inv.capacityKg, inv.hardLimitKg, false));
    if (view === 'list') parts.push(colHeads('own'));
    const body = div('dz-i3__body');
    for (const sec of sections) body.append(sectionBody('own', sec, view));
    parts.push(body);
    const foot = div('dz-i3__foot');
    const info = selectionInfo(s, selected.own);
    foot.append(
      h(
        'span',
        'dz-i3__selinfo',
        info.count ? `Zaznaczono ${info.count} · ${formatKg(info.weightKg)} kg` : keyFitsLabel(s),
      ),
      h('span', 'dz-i3__grow'),
      button('PRZENIEŚ', 'Ctrl', moveSelected, !selected.own.size || !boxSection),
      button('UPUŚĆ', 'G', dropSelected, !selected.own.size),
    );
    parts.push(foot);
    own.replaceChildren(...parts);
    own.dataset.sec = 'panel-own';
  };

  const renderBox = (s: GameState, view: InventoryViewMode): void => {
    const c = s.container;
    const pos = opts.position();
    const dist =
      c && pos && c.x !== undefined && c.y !== undefined
        ? distanceLabel(pos.x, pos.y, c.x, c.y)
        : '';
    // Vehicle containers: `BAGAŻNIK · Sedan · 1,1 m` (vehicle UI §3).
    const car =
      c?.vehicle !== undefined ? s.vehicles.find((v) => v.vehicleId === c.vehicle) : undefined;
    const vehicleSub = car ? `${vehicleTypeName(car.type)}${dist ? ` · ${dist}` : ''}` : dist;
    const parts: HTMLElement[] = [
      panelHead(
        'box',
        c?.kind === 'vehicle-trunk'
          ? ICON.trunk
          : c?.kind === 'vehicle-glovebox'
            ? ICON.glovebox
            : ICON.cabinet,
        c ? containerName(c.type, c.kind).toUpperCase() : 'POJEMNIK',
        vehicleSub,
      ),
    ];
    const tabs = lootTabs(s);
    const tabRow = div('dz-i3__tabs');
    for (const t of tabs) {
      const b = h('button', 'dz-i3__tab');
      b.type = 'button';
      if (t.active) b.dataset.on = 'true';
      const ic = t.off
        ? ICON.seat
        : t.kind === 'ground'
          ? ICON.ground
          : t.kind === 'vehicle-trunk'
            ? ICON.trunk
            : t.kind === 'vehicle-glovebox'
              ? ICON.glovebox
              : /fridge|freezer/.test(t.type ?? '')
                ? ICON.fridge
                : ICON.box;
      b.append(svgEl(ic), h('span', '', t.label));
      if (t.count !== undefined) b.append(h('span', 'dz-i3__tab-n', String(t.count)));
      if (t.off) {
        // Out of reach (vehicle UI [ZAŁ.]): dashed, dimmed, the reason in the title.
        b.dataset.off = 'true';
        b.title = t.off;
      }
      b.addEventListener('click', () => {
        if (!t.active && !t.off) opts.onSwitch(t.id);
      });
      tabRow.append(b);
    }
    tabRow.append(h('span', 'dz-i3__grow'), key('Q'), key('E'));
    parts.push(tabRow);
    if (c && c.capacityKg !== null)
      parts.push(loadRow('Pojemność', c.weightKg, c.capacityKg, null, true));
    if (view === 'list' && c) parts.push(colHeads('box'));
    const body = div('dz-i3__body');
    if (boxSection) {
      body.append(sectionBody('box', boxSection, view));
      if (view === 'grid') {
        const legend = div('dz-i3__legend');
        for (const [label, color, bar] of [
          ['świeże', '#A9C07A', false],
          ['nieświeże', '#F0C06A', false],
          ['zepsute', '#E8766C', false],
          ['trwałość', '#7F9A4E', true],
          ['zawartość', '#4FA8C8', true],
        ] as const) {
          const m = h('span', bar ? 'dz-i3__lg-bar' : 'dz-i3__dot');
          m.style.background = color;
          const sp = h('span');
          sp.append(m, label);
          legend.append(sp);
        }
        body.append(legend);
      }
    } else {
      body.append(
        div(
          'dz-i3__empty dz-i3__empty--box',
          s.action?.kind === 'search'
            ? 'Przeszukiwanie…'
            : tabs.length
              ? isTouchUi()
                ? 'Wybierz pojemnik z zakładek'
                : 'Wybierz pojemnik z zakładek (Q / E)'
              : 'Brak pojemnika w zasięgu — podejdź i naciśnij F',
        ),
      );
    }
    parts.push(body);
    const offTab = tabs.find((t) => t.off);
    if (offTab) {
      const note = div('dz-i3__vnote');
      note.append(
        svgEl(ICON.seat),
        h('b', '', offTab.label),
        ` ${offTab.kind === 'vehicle-glovebox' ? 'otworzysz tylko z przedniego fotela.' : `: ${offTab.off}.`} W aucie zakładki się odwracają: Schowek aktywny, Bagażnik niedostępny.`,
      );
      parts.push(note);
    }
    const foot = div('dz-i3__foot');
    foot.append(
      button('WEŹ WSZYSTKO', 'R', () => api.takeAll(), !c?.items.length),
      button('ODŁÓŻ ZAZNACZONE', 'F', () => api.putAll(), !c || !selected.own.size),
    );
    parts.push(foot);
    box.replaceChildren(...parts);
    box.dataset.sec = 'panel-box';
  };

  const renderMenu = (): void => {
    if (!menuFor) {
      menu.hidden = true;
      return;
    }
    const side = menuFor;
    const cur = sortOf(side);
    menu.replaceChildren();
    for (const o of SORT_OPTIONS) {
      const it = h('button', 'dz-i3__mi');
      it.type = 'button';
      it.setAttribute('role', 'menuitemradio');
      it.setAttribute('aria-checked', String(cur.by === o.id));
      if (cur.by === o.id) it.dataset.on = 'true';
      it.append(svgEl(cur.by === o.id ? ICON.check : '', 'dz-i3__mi-c'), h('span', '', o.label));
      it.addEventListener('click', () => {
        menuFor = undefined;
        setSort(side, { by: o.id, desc: false });
      });
      menu.append(it);
    }
    menu.append(div('dz-i3__mi-sep'));
    const g = h('button', 'dz-i3__mi');
    g.type = 'button';
    g.setAttribute('role', 'menuitemcheckbox');
    g.setAttribute('aria-checked', String(prefs().group));
    if (prefs().group) g.dataset.on = 'true';
    g.append(svgEl(prefs().group ? ICON.check : '', 'dz-i3__mi-c'), h('span', '', 'Grupuj stosy'));
    g.addEventListener('click', () => {
      opts.setPrefs({ ...prefs(), group: !prefs().group });
      render();
    });
    menu.append(g);
    const btn = stage.querySelector<HTMLElement>(`.dz-i3__sort[data-side="${side}"]`);
    if (btn) {
      menu.style.left = `${btn.offsetLeft + (side === 'own' ? own : box).offsetLeft + btn.offsetWidth - 180}px`;
      menu.style.top = `${btn.offsetTop + (side === 'own' ? own : box).offsetTop + btn.offsetHeight + 4}px`;
    }
    menu.hidden = false;
  };

  function render(): void {
    const s = opts.state();
    const content = opts.content();
    last = s;
    lastContent = content;
    const p = prefs();
    sections = playerSections(s, content, { sort: p.sort.player, group: p.group });
    boxSection = containerSection(s, content, { sort: p.sort.container, group: p.group });
    // Drop selections of items that are gone.
    for (const side of ['own', 'box'] as const)
      for (const id of selected[side]) if (!findAny(s, id)) selected[side].delete(id);
    rowEls.clear();
    order.own = [];
    order.box = [];
    const keep = hovered;
    el.dataset.view = p.view;
    renderOwn(s, p.view);
    renderBox(s, p.view);
    renderMenu();
    const hit = keep ? rowEls.get(keep.key) : undefined;
    if (hit?.el.isConnected && !drag?.active) {
      hovered = keep;
      // A visible tooltip is refreshed in place (`hover` keeps it shown); a pending one keeps its
      // delay running, so frequent state updates do not postpone it forever.
      if ('visible' in tooltip.el.dataset || !comboTip.el.hidden || tipKey !== hit.row.key)
        showTip(hit.el, hit.row, p.view === 'grid');
    } else {
      tooltip.hide();
      comboTip.hide();
      tipKey = undefined;
    }
  }

  // ── drag & drop ───────────────────────────────────────────────────────────
  const dragKg = (): number => {
    if (!drag) return 0;
    const s = opts.state();
    const whole = ctrlHeld;
    return drag.ids.reduce((n, id) => {
      const it = findAny(s, id);
      return n + (it ? pieceKg(it, whole) : 0);
    }, 0);
  };
  let ctrlHeld = false;
  const sectionAt = (x: number, y: number): InvSectionVM | 'ground' | undefined => {
    const under = document.elementFromPoint(x, y);
    const secEl = under?.closest<HTMLElement>('[data-sec]');
    const k = secEl?.dataset.sec;
    if (k === 'panel-box') return boxSection;
    if (k === 'panel-own') return sections.find((x) => x.kind === 'main');
    if (k) return k === boxSection?.key ? boxSection : sections.find((x) => x.key === k);
    // Outside both panels (and not over the shortcuts): the floor.
    if (under?.closest('.dz-i3__panel, .dz-i3__keys')) return undefined;
    return 'ground';
  };
  const updateDrag = (e: PointerEvent): void => {
    if (!drag) return;
    const host = stage.getBoundingClientRect();
    const k = host.width / Math.max(1, stage.offsetWidth);
    const x = (e.clientX - host.left) / k;
    const y = (e.clientY - host.top) / k;
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y + 10}px`;
    const target = sectionAt(e.clientX, e.clientY);
    const changed = target !== drag.target;
    drag.target = target;
    if (target === undefined || (target !== 'ground' && dragFromSame(target))) {
      badge.hidden = true;
    } else {
      const pv =
        target === 'ground'
          ? { label: `UPUŚĆ NA PODŁOGĘ · ${formatKg(dragKg())} kg`, fits: true }
          : dropPreview(target, dragKg());
      badge.textContent = pv.label;
      badge.dataset.fits = String(pv.fits);
      badge.style.left = `${x + 12}px`;
      badge.style.top = `${y - 30}px`;
      badge.hidden = false;
    }
    if (changed) render();
  };
  const dragFromSame = (t: InvSectionVM): boolean =>
    !!drag && drag.ids.every((id) => t.rows.some((r) => r.itemIds.includes(id)));

  const onMove = (e: PointerEvent): void => {
    lastPt.x = e.clientX;
    lastPt.y = e.clientY;
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.active) {
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      const t = drag.touch;
      const go = dragDecision(!!t, t ? e.timeStamp - t.at : 0, moved, DRAG_PX);
      if (go === 'wait') return;
      if (go === 'scroll' && t) {
        // A quick swipe scrolls the list (rows take every touch: `touch-action: none`).
        const list = (e.target as HTMLElement | null)?.closest<HTMLElement>('.dz-i3__body');
        if (list) list.scrollTop -= e.clientY - t.y;
        t.y = e.clientY;
        return;
      }
      drag.active = true;
      hideTips();
      const s = opts.state();
      const n = drag.ids.length;
      const it = findAny(s, drag.ids[0]!);
      ghost.replaceChildren(
        iconEl(drag.row, 24),
        h('span', 'dz-i3__ghost-t', n > 1 ? `${drag.row.name} +${n - 1}` : drag.row.name),
        h('span', 'dz-i3__ghost-w', `${formatKg(it ? pieceKg(it, ctrlHeld) : 0)} kg`),
      );
      ghost.hidden = false;
      el.dataset.dragging = drag.side;
    }
    updateDrag(e);
  };
  const onUp = (e: PointerEvent): void => {
    const d = drag;
    if (!d || e.pointerId !== d.pointer) return;
    drag = undefined;
    ghost.hidden = true;
    badge.hidden = true;
    delete el.dataset.dragging;
    if (!d.active) {
      const now = performance.now();
      if (e.ctrlKey || e.metaKey) {
        ctrlAlone = false;
        transfer(d.side, d.row.itemIds, true);
      } else if (lastClick?.key === d.row.key && now - lastClick.at < DOUBLE_MS) {
        lastClick = undefined;
        transfer(d.side, d.row.itemIds, false);
      } else {
        lastClick = { key: d.row.key, at: now };
        select(d.side, d.row, e);
      }
      return;
    }
    const t = d.target;
    if (t && (t === 'ground' || !dragFromSame(t))) {
      send(moveCommands(opts.state(), opts.content(), d.ids, t, e.ctrlKey || e.metaKey));
      selected[d.side].clear();
    }
    render();
  };

  // ── keys ──────────────────────────────────────────────────────────────────
  const onKey = (e: KeyboardEvent): void => {
    if (!isOpen) return;
    if (e.key === 'Control') {
      ctrlHeld = e.type === 'keydown';
      if (e.type === 'keydown' && !e.repeat) ctrlAlone = true;
      else if (e.type === 'keyup' && ctrlAlone) {
        ctrlAlone = false;
        moveSelected();
      }
      return;
    }
    if (e.type !== 'keydown') return;
    ctrlAlone = false;
    if (opts.isCombineKey(e.code) && !e.ctrlKey) {
      if (!e.repeat && hovered) combine(rowEls.get(hovered.key)?.row.itemIds[0]);
      return;
    }
    const mine =
      ['Tab', 'KeyQ', 'KeyE', 'KeyG'].includes(e.code) || (e.code === 'KeyA' && e.ctrlKey);
    if (!mine) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === 'Tab') toggleView();
    else if (e.code === 'KeyG') dropSelected();
    else if (e.code === 'KeyA') {
      const side = hovered?.side ?? (selected.box.size ? 'box' : 'own');
      const secKey =
        hoverSection ??
        (side === 'box' ? boxSection?.key : sections.find((x) => x.kind === 'main')?.key);
      const sec = secKey === boxSection?.key ? boxSection : sections.find((x) => x.key === secKey);
      if (sec) {
        selected[side === 'box' || sec.kind === 'box' ? 'box' : 'own'] = new Set(
          sec.rows.flatMap((r) => r.itemIds),
        );
        render();
      }
    } else {
      const tabs = reachableTabs(opts.state());
      if (!tabs.length) return;
      const i = tabs.findIndex((t) => t.active);
      const next =
        i < 0 ? tabs[0]! : tabs[(i + (e.code === 'KeyE' ? 1 : tabs.length - 1)) % tabs.length]!;
      if (!next.active) opts.onSwitch(next.id);
    }
  };
  stage.addEventListener('pointerover', (e) => {
    hoverSection = (e.target as HTMLElement).closest<HTMLElement>('.dz-i3__sec')?.dataset.sec;
  });
  // A click anywhere but the sort menu / its button closes the menu.
  el.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (menuFor && !t.closest('.dz-i3__menu, .dz-i3__sort')) {
      menuFor = undefined;
      menu.hidden = true;
    }
  });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKey, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('blur', () => {
    ctrlHeld = false;
    ctrlAlone = false;
  });

  // A press on the backdrop (outside panels, menu, shortcuts) closes the window and is consumed.
  bindOutsideClose(
    el,
    '.dz-i3__panel, .dz-i3__keys, .dz-i3__menu',
    () => isOpen && !drag,
    () => api.close(),
  );

  const api: InventoryWindow = {
    get open() {
      return isOpen;
    },
    toggle() {
      isOpen = !isOpen;
      el.hidden = !isOpen;
      opts.root.dataset.modal = isOpen ? 'inventory' : '';
      if (isOpen) {
        selected.own.clear();
        selected.box.clear();
        render();
      } else {
        hideTips();
        menuFor = undefined;
        drag = undefined;
        ghost.hidden = true;
        badge.hidden = true;
      }
    },
    close() {
      if (isOpen) api.toggle();
    },
    takeAll() {
      const s = opts.state();
      const r = takeWithinLimit(s);
      send(r.cmds);
      if (r.left > 0) opts.toast?.(`Za ciężko: zostało ${r.left} poz.`);
      selected.box.clear();
    },
    putAll() {
      if (!boxSection || !selected.own.size) return;
      send(moveCommands(opts.state(), opts.content(), [...selected.own], boxSection, true));
      selected.own.clear();
    },
    update() {
      if (!isOpen) return;
      const s = opts.state();
      if (
        !last ||
        s.inventory !== last.inventory ||
        s.container !== last.container ||
        s.nearby.length !== last.nearby.length ||
        s.crafting !== last.crafting ||
        s.action?.kind !== last.action?.kind ||
        opts.content() !== lastContent
      )
        render();
    },
  };
  return api;
}
