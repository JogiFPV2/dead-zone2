import './loot-window.css';
import type { ContainerId, ContainerView, ItemView } from '@deadzone/protocol';
import { createIcon, createItemTooltip } from '@deadzone/ui';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import { formatKg, type InvCommand } from './inventory-model.js';
import { containerName } from './labels.js';
import {
  clockLabel,
  containersLabel,
  lootRow,
  reachableTabs,
  ownItems,
  ownTitle,
  putCommand,
  putSelected,
  rangeIds,
  selectionSummary,
  takeCommand,
  takeWithinLimit,
  type LootRowVM,
} from './loot-model.js';
import { bindOutsideClose } from './outside-click.js';

export interface LootWindowOptions {
  root: HTMLElement;
  send: (cmd: InvCommand) => void;
  state: () => GameState;
  content: () => HudContentIndex;
  /** Esc / close button: the game closes the container in the sim. */
  onClose: () => void;
  /** Tab click / Q / E: open another container in reach. */
  onSwitch: (id: ContainerId) => void;
  /** Containers another window shows instead (fridges: the furniture UI). */
  defer?: (c: ContainerView) => boolean;
}

export interface LootWindow {
  readonly open: boolean;
  show(): void;
  hide(): void;
  takeAll(): void;
  /** Per frame: follows the state (auto-hide when the container is gone), re-renders on change. */
  update(): void;
}

type Side = 'own' | 'box';

/**
 * Only what the loot screen shows: the state object changes every snapshot (20 Hz), and
 * rebuilding the rows that often would break hover, clicks and drags.
 */
const nearbyKey = (s: GameState): string =>
  s.nearby.map((c) => `${c.id}:${c.searched ? 1 : 0}`).join(',');

function changed(s: GameState, prev: GameState | undefined): boolean {
  return (
    !prev ||
    s.inventory !== prev.inventory ||
    s.container !== prev.container ||
    nearbyKey(s) !== nearbyKey(prev) ||
    s.action?.kind !== prev.action?.kind ||
    Math.floor(s.clock?.minuteOfDay ?? 0) !== Math.floor(prev.clock?.minuteOfDay ?? 0)
  );
}

const DRAG_THRESHOLD_PX = 6;
const TOAST_MS = 2600;

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

const keyBadge = (k: string): HTMLElement => h('span', 'dz-loot__key', k);

const CHECK_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5 11-11"/></svg>';
const SEARCH_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';
const HAND_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V5a1.5 1.5 0 0 1 3 0v5M10 10V4a1.5 1.5 0 0 1 3 0v6M13 10V5a1.5 1.5 0 0 1 3 0v6M16 11V8a1.5 1.5 0 0 1 3 0v6c0 4-3 7-7 7s-6-2-7.5-5L3 13a1.5 1.5 0 0 1 2.5-1.5L7 13"/></svg>';
const SWAP_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3"/></svg>';
const DOWN_SVG =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v14M6 12l6 6 6-6"/></svg>';
const TAB_SVG: Record<string, string> = {
  fridge:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M6 9h12M9 5v2M9 12v3"/></svg>',
  ground:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 17l10-5 10 5-10 5z"/><path d="M8 13l2-6h4l2 6"/></svg>',
  box: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M10 11v2M14 11v2"/></svg>',
};
const svg = (markup: string): HTMLElement => {
  const s = h('span', 'dz-loot__svg');
  s.innerHTML = markup;
  return s;
};

/** Icon cell: baked 3D icon, else the vector icon. */
function iconCell(r: LootRowVM): HTMLElement {
  const cell = div('dz-loot__ib');
  if (r.image) {
    const img = h('img');
    img.src = r.image;
    img.alt = '';
    img.draggable = false;
    cell.append(img);
  } else {
    const s = createIcon(document, r.icon, 20);
    if (s) cell.append(s);
  }
  return cell;
}

/**
 * Loot screen (mockup `loot.png`): the player's inventory on the left, the opened container on
 * the right with tabs for every container in reach. LPM takes / puts one piece, Ctrl+LPM the
 * stack, Shift+LPM selects, drag moves a row (or the selection) between the panels, R takes
 * everything up to the carry limit, Enter the selection, F puts the selected own rows back.
 */
export function createLootWindow(opts: LootWindowOptions): LootWindow {
  const el = div('dz-loot');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Przeszukiwanie');
  const head = div('dz-loot__head');
  const left = div('dz-loot__panel dz-loot__panel--own');
  const right = div('dz-loot__side');
  const middle = div('dz-loot__middle');
  const shortcuts = div('dz-loot__shortcuts dz-loot__glass');
  for (const [k, t] of [
    ['LPM', 'weź 1'],
    ['Shift', 'zaznacz'],
    ['Ctrl', 'stos'],
    ['R', 'wszystko'],
    ['Esc', 'zamknij'],
  ] as const) {
    const s = h('span');
    s.append(keyBadge(k), ` ${t}`);
    shortcuts.append(s);
  }
  const ghost = div('dz-loot__ghost');
  ghost.hidden = true;
  const toast = div('dz-loot__toast');
  toast.hidden = true;
  const body = div('dz-loot__body');
  body.append(left, middle, right);
  const tooltip = createItemTooltip();
  tooltip.el.classList.add('dz-loot__tooltip');
  el.append(div('dz-loot__scrim'), head, body, shortcuts, ghost, toast, tooltip.el);
  opts.root.append(el);

  let isOpen = false;
  let last: GameState | undefined;
  let lastContent: HudContentIndex | undefined;
  const selected: Record<Side, Set<number>> = { own: new Set(), box: new Set() };
  const anchor: Partial<Record<Side, number>> = {};
  const setShift = (on: boolean): void => {
    if (on) el.dataset.shift = 'true';
    else delete el.dataset.shift;
  };
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let drag:
    { side: Side; id: number; x: number; y: number; active: boolean; pointer: number } | undefined;
  let lastContainer: ContainerId | undefined;

  const send = (cmds: readonly (InvCommand | undefined)[]): void => {
    for (const c of cmds) if (c) opts.send(c);
  };
  const showToast = (text: string): void => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
  };
  const reportLeft = (left: number): void => {
    if (left > 0) showToast(`Za ciężko: zostało ${left} poz.`);
  };

  const itemsOf = (side: Side): ItemView[] =>
    side === 'own' ? ownItems(opts.state()) : (opts.state().container?.items ?? []);

  const transferRows = (from: Side, ids: readonly number[]): void => {
    const s = opts.state();
    if (from === 'box') {
      const r = takeWithinLimit(s, ids, s.inventory?.hardLimitKg);
      send(r.cmds);
      reportLeft(r.left);
    } else send(putSelected(s, ids));
    selected[from].clear();
  };

  const clickRow = (side: Side, id: number, e: PointerEvent | MouseEvent): void => {
    const sel = selected[side];
    if (e.shiftKey) {
      if (sel.has(id)) sel.delete(id);
      else if (anchor[side] !== undefined && sel.has(anchor[side])) {
        for (const r of rangeIds(
          itemsOf(side).map((i) => i.id),
          anchor[side],
          id,
        ))
          sel.add(r);
      } else {
        sel.add(id);
        anchor[side] = id;
      }
      render();
      return;
    }
    const s = opts.state();
    const stack = e.ctrlKey || e.metaKey;
    send([side === 'box' ? takeCommand(s, id, stack) : putCommand(s, id, stack)]);
  };

  const placeTooltip = (row: HTMLElement, side: Side, r: LootRowVM): void => {
    tooltip.hover(r.tooltip);
    const host = el.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const w = tooltip.el.offsetWidth || 300;
    const panel = (side === 'own' ? left : right).getBoundingClientRect();
    const x = side === 'own' ? panel.right + 12 : panel.left - 12 - w;
    tooltip.place({ left: x - host.left, top: Math.max(8, rr.top - host.top - 40) });
  };

  const renderRow = (side: Side, r: LootRowVM): HTMLElement => {
    const row = div('dz-loot__row');
    row.dataset.id = String(r.id);
    const sel = selected[side].has(r.id);
    if (sel) row.dataset.selected = 'true';
    if (r.equipped) row.dataset.equipped = 'true';
    // Checkboxes are shown by CSS while the panel has a selection or Shift is held.
    const chk = h('span', 'dz-loot__chk');
    if (sel) {
      chk.dataset.on = 'true';
      chk.innerHTML = CHECK_SVG;
    }
    row.append(chk);
    const txt = div('dz-loot__txt');
    txt.append(div('dz-loot__nm', r.name));
    if (r.sub || r.durability !== undefined) {
      const sub = div('dz-loot__sub');
      if (r.freshness) sub.dataset.fresh = r.freshness;
      if (r.durability !== undefined) {
        sub.append('Trwałość ');
        const bar = h('span', 'dz-loot__dur');
        const fill = h('i');
        fill.style.width = `${Math.round(r.durability * 100)}%`;
        if (r.durability < 0.3) fill.dataset.low = 'true';
        bar.append(fill);
        sub.append(bar);
      }
      if (r.freshness) sub.append(h('span', 'dz-loot__dot'));
      sub.append(r.sub);
      txt.append(sub);
    }
    row.append(iconCell(r), txt);
    if (side === 'own' && sel && opts.state().container) {
      const put = div('dz-loot__mini');
      put.append(svg(SWAP_SVG), 'ODŁÓŻ', keyBadge('F'));
      row.append(put);
    }
    row.append(
      h('span', 'dz-loot__cnt', r.count > 1 ? `×${r.count}` : '1'),
      h('span', 'dz-loot__w', `${formatKg(r.weightKg)} kg`),
    );
    row.addEventListener('pointerenter', () => {
      if (!drag?.active) placeTooltip(row, side, r);
    });
    row.addEventListener('pointerleave', () => tooltip.unhover());
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = { side, id: r.id, x: e.clientX, y: e.clientY, active: false, pointer: e.pointerId };
    });
    return row;
  };

  const colHead = (): HTMLElement => {
    const c = div('dz-loot__colh');
    c.append(
      h('span', 'dz-loot__colh-ic'),
      h('span', 'dz-loot__colh-nm', 'Przedmiot'),
      h('span', 'dz-loot__cnt', 'Ilość'),
      h('span', 'dz-loot__w', 'Waga'),
    );
    return c;
  };

  const renderOwn = (s: GameState, content: HudContentIndex): void => {
    const inv = s.inventory;
    const items = ownItems(s);
    const hdr = div('dz-loot__hdr');
    hdr.append(h('span', 'dz-loot__t', `Twój ekwipunek · ${ownTitle(s)}`));
    const mode = div('dz-loot__mode');
    const list = h('span', 'dz-loot__mode-on', 'Lista');
    const grid = h('span', 'dz-loot__mode-off', 'Siatka');
    grid.setAttribute('aria-disabled', 'true');
    grid.title = 'Wkrótce';
    mode.append(list, grid);
    hdr.append(mode);
    const weight = div('dz-loot__weight');
    if (inv) {
      const cap = inv.capacityKg;
      const pick = selectionSummary(s.container?.items ?? [], selected.box).weightKg;
      const line = div('dz-loot__wline');
      const label = h('span', 'dz-loot__wlabel');
      label.append('Waga ', h('b', '', `${formatKg(inv.loadKg)} / ${formatKg(cap)}`), ' kg');
      line.append(label);
      if (pick > 0) {
        const after = inv.loadKg + pick;
        const p = h(
          'span',
          'dz-loot__wafter',
          `po wzięciu zaznaczonych: ${formatKg(after)} / ${formatKg(cap)}`,
        );
        if (after > cap) p.dataset.over = 'true';
        line.append(p);
      }
      const bar = div('dz-loot__bar dz-loot__bar--own');
      const base = Math.min(100, (inv.loadKg / Math.max(cap, 1e-6)) * 100);
      const fill = h('i');
      fill.style.width = `${base}%`;
      if (inv.loadKg > cap) fill.dataset.over = 'true';
      bar.append(fill);
      if (pick > 0) {
        const prev = h('i', 'dz-loot__bar-preview');
        prev.style.left = `${base}%`;
        prev.style.width = `${Math.max(0, Math.min(100 - base, (pick / Math.max(cap, 1e-6)) * 100))}%`;
        if (inv.loadKg + pick > cap) prev.dataset.over = 'true';
        bar.append(prev);
      }
      const scale = div('dz-loot__wscale');
      scale.append(
        h('span', '', '0 kg'),
        h('span', '', `limit ${formatKg(cap)} kg · powyżej: wolniejszy ruch`),
      );
      weight.append(line, bar, scale);
    }
    const rows = div('dz-loot__rows');
    if (!items.length) rows.append(div('dz-loot__empty', 'Pusto'));
    for (const it of items) rows.append(renderRow('own', lootRow(it, content)));
    if (selected.own.size) left.dataset.checks = 'true';
    else delete left.dataset.checks;
    left.replaceChildren(hdr, weight, colHead(), rows, h('span', 'dz-loot__grow'));
    if (drag?.active && drag.side === 'box') {
      const zone = div('dz-loot__drop');
      const all = s.container?.items ?? [];
      const sum = selectionSummary(all, new Set(all.map((i) => i.id)));
      zone.append(
        svg(DOWN_SVG),
        h('span', 'dz-loot__drop-t', 'Upuść tutaj, aby wziąć'),
        h('span', 'dz-loot__drop-n', `${sum.stacks} poz. · ${sum.pieces} szt.`),
      );
      left.append(zone);
    }
  };

  const renderBox = (s: GameState, content: HudContentIndex): void => {
    const tabs = reachableTabs(s);
    const tabRow = div('dz-loot__tabs');
    if (tabs.length >= 2) {
      for (const t of tabs) {
        const b = h('button', 'dz-loot__tab');
        b.type = 'button';
        if (t.active) b.dataset.active = 'true';
        const icon =
          t.kind === 'ground' ? 'ground' : /fridge|freezer/.test(t.type ?? '') ? 'fridge' : 'box';
        b.append(svg(TAB_SVG[icon]!), t.label);
        if (t.count !== undefined) b.append(h('span', 'dz-loot__tab-n', String(t.count)));
        b.addEventListener('click', () => {
          if (!t.active) opts.onSwitch(t.id);
        });
        tabRow.append(b);
      }
      const hint = h('span', 'dz-loot__tabs-hint');
      hint.append(keyBadge('Q'), keyBadge('E'), ' przełącz');
      tabRow.append(hint);
    }
    const panel = div('dz-loot__panel dz-loot__panel--box');
    if (tabs.length >= 2) panel.dataset.tabs = 'true';
    const c = s.container;
    if (!c) {
      panel.append(
        div('dz-loot__hdr'),
        div('dz-loot__empty', s.action?.kind === 'search' ? 'Przeszukiwanie…' : 'Brak pojemnika'),
      );
      right.replaceChildren(tabRow, panel);
      return;
    }
    const hdr = div('dz-loot__hdr');
    hdr.append(h('span', 'dz-loot__t', containerName(c.type, c.kind)));
    hdr.append(
      h(
        'span',
        'dz-loot__r',
        c.capacityKg === null
          ? `${formatKg(c.weightKg)} kg`
          : `${formatKg(c.weightKg)} / ${formatKg(c.capacityKg)} kg`,
      ),
    );
    panel.append(hdr);
    if (c.capacityKg !== null) {
      const bar = div('dz-loot__bar dz-loot__bar--box');
      const fill = h('i');
      fill.style.width = `${Math.min(100, (c.weightKg / Math.max(c.capacityKg, 1e-6)) * 100)}%`;
      bar.append(fill);
      panel.append(bar);
    }
    const rows = div('dz-loot__rows');
    if (!c.items.length) rows.append(div('dz-loot__empty', 'Pusto'));
    for (const it of c.items) rows.append(renderRow('box', lootRow(it, content)));
    if (selected.box.size) panel.dataset.checks = 'true';
    panel.append(colHead(), rows);
    if (selected.box.size) {
      const sum = selectionSummary(c.items, selected.box);
      const bar = div('dz-loot__selbar');
      const chk = h('span', 'dz-loot__chk');
      chk.dataset.on = 'true';
      chk.innerHTML = CHECK_SVG;
      const t = h('span', 'dz-loot__selbar-t');
      t.append(
        'Zaznaczono ',
        h('b', '', `${sum.stacks} poz.`),
        ` · ${sum.pieces} szt. · ${formatKg(sum.weightKg)} kg`,
      );
      const hint = h('span', 'dz-loot__selbar-h');
      hint.append(keyBadge('Shift'), ' + LPM dodaj / usuń');
      bar.append(chk, t, hint);
      panel.append(bar);
    }
    panel.append(h('span', 'dz-loot__grow'));
    const help = div('dz-loot__help');
    help.append(
      'Kliknij wiersz: weź 1 szt.',
      h('span', '', '·'),
      keyBadge('Ctrl'),
      ' + LPM: cały stos',
    );
    const btns = div('dz-loot__btns');
    const takeSel = h('button', 'dz-loot__btn dz-loot__btn--sec');
    takeSel.type = 'button';
    takeSel.append(svg(HAND_SVG), `Weź zaznaczone (${selected.box.size})`, keyBadge('Enter'));
    takeSel.disabled = selected.box.size === 0;
    takeSel.addEventListener('click', () => transferRows('box', [...selected.box]));
    const takeAllBtn = h('button', 'dz-loot__btn dz-loot__btn--pri');
    takeAllBtn.type = 'button';
    takeAllBtn.append(svg(HAND_SVG), 'Weź wszystko', keyBadge('R'));
    takeAllBtn.disabled = c.items.length === 0;
    takeAllBtn.addEventListener('click', () => api.takeAll());
    btns.append(takeSel, h('span', 'dz-loot__grow'), takeAllBtn);
    panel.append(help, div('dz-loot__sep'), btns);
    right.replaceChildren(tabRow, panel);
  };

  const renderHead = (s: GameState): void => {
    const n = reachableTabs(s).length;
    const count = div('dz-loot__count');
    count.append(svg(SEARCH_SVG), h('span', '', containersLabel(Math.max(1, n))));
    const where = h(
      'span',
      'dz-loot__where',
      `${s.container ? containerName(s.container.type, s.container.kind) : 'Schowek'} · pojemniki w zasięgu 1,5 m`,
    );
    const clock = clockLabel(s.clock);
    const ck = div('dz-loot__clock');
    ck.append(h('span', 'dz-loot__clock-h', clock.time), h('span', 'dz-loot__clock-d', clock.day));
    head.replaceChildren(
      h('span', 'dz-loot__title', 'Przeszukiwanie'),
      count,
      h('span', 'dz-loot__grow'),
      where,
      ck,
    );
  };

  const renderMiddle = (): void => {
    const hint = div('dz-loot__hint dz-loot__glass');
    hint.append(
      svg(SWAP_SVG),
      h('span', '', 'Przeciągnij między panelami, aby przenieść'),
      h('span', 'dz-loot__hint-sub', 'w obie strony'),
    );
    middle.replaceChildren(hint);
  };

  /** Drops selections of items that are gone (taken, moved). */
  const pruneSelection = (s: GameState): void => {
    const own = new Set(ownItems(s).map((i) => i.id));
    const box = new Set((s.container?.items ?? []).map((i) => i.id));
    for (const id of selected.own) if (!own.has(id)) selected.own.delete(id);
    for (const id of selected.box) if (!box.has(id)) selected.box.delete(id);
  };

  function render(): void {
    const s = opts.state();
    const content = opts.content();
    last = s;
    lastContent = content;
    pruneSelection(s);
    tooltip.hide();
    renderHead(s);
    renderOwn(s, content);
    renderBox(s, content);
    renderMiddle();
  }

  const dragIds = (side: Side, id: number): number[] =>
    selected[side].has(id) ? [...selected[side]] : [id];

  const updateGhost = (e: PointerEvent): void => {
    if (!drag) return;
    const host = el.getBoundingClientRect();
    ghost.style.left = `${e.clientX - host.left + 14}px`;
    ghost.style.top = `${e.clientY - host.top + 10}px`;
  };

  const onMove = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      tooltip.hide();
      const ids = dragIds(drag.side, drag.id);
      const items = itemsOf(drag.side);
      const sum = selectionSummary(items, new Set(ids));
      const content = opts.content();
      ghost.replaceChildren(
        ...items
          .filter((i) => ids.includes(i.id))
          .slice(0, 3)
          .map((it) => {
            const cell = iconCell(lootRow(it, content));
            if (it.count > 1) cell.append(h('span', 'dz-loot__ghost-n', String(it.count)));
            return cell;
          }),
        h('span', 'dz-loot__ghost-t', `${sum.stacks} poz. · ${formatKg(sum.weightKg)} kg`),
      );
      ghost.hidden = false;
      el.dataset.dragging = drag.side;
      render();
    }
    updateGhost(e);
  };

  const onUp = (e: PointerEvent): void => {
    const d = drag;
    if (!d || e.pointerId !== d.pointer) return;
    drag = undefined;
    ghost.hidden = true;
    delete el.dataset.dragging;
    if (!d.active) {
      clickRow(d.side, d.id, e);
      return;
    }
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target: Side | undefined = under?.closest('.dz-loot__panel--own')
      ? 'own'
      : under?.closest('.dz-loot__panel--box')
        ? 'box'
        : undefined;
    if (target && target !== d.side) transferRows(d.side, dragIds(d.side, d.id));
    render();
  };

  const KEYS = new Set(['Escape', 'Enter', 'KeyR', 'KeyF', 'KeyQ', 'KeyE']);
  const onKey = (e: KeyboardEvent): void => {
    if (!isOpen) return;
    if (e.key === 'Shift') {
      setShift(e.type === 'keydown');
      return;
    }
    if (e.type !== 'keydown' || !KEYS.has(e.code)) return;
    // Handled here: the game must not rotate the camera / pause / interact underneath.
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    const s = opts.state();
    if (e.code === 'Escape') opts.onClose();
    else if (e.code === 'Enter') transferRows('box', [...selected.box]);
    else if (e.code === 'KeyR') api.takeAll();
    else if (e.code === 'KeyF') {
      if (selected.own.size) transferRows('own', [...selected.own]);
    } else {
      const tabs = reachableTabs(s);
      if (tabs.length < 2) return;
      const i = Math.max(
        0,
        tabs.findIndex((t) => t.active),
      );
      const next = tabs[(i + (e.code === 'KeyE' ? 1 : tabs.length - 1)) % tabs.length]!;
      opts.onSwitch(next.id);
    }
  };

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKey, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('blur', () => setShift(false));

  // A press on the backdrop (outside panels, tabs, hints) closes like Esc and is consumed.
  bindOutsideClose(
    el,
    '.dz-loot__panel, .dz-loot__tabs, .dz-loot__head, .dz-loot__hint, .dz-loot__shortcuts, .dz-loot__toast',
    () => isOpen && !drag,
    () => opts.onClose(),
  );

  const api: LootWindow = {
    get open() {
      return isOpen;
    },
    show() {
      if (isOpen) return;
      isOpen = true;
      el.hidden = false;
      opts.root.dataset.modal = 'loot';
      selected.own.clear();
      selected.box.clear();
      render();
    },
    hide() {
      if (!isOpen) return;
      isOpen = false;
      el.hidden = true;
      drag = undefined;
      ghost.hidden = true;
      tooltip.hide();
      if (opts.root.dataset.modal === 'loot') opts.root.dataset.modal = '';
    },
    takeAll() {
      const r = takeWithinLimit(opts.state());
      send(r.cmds);
      reportLeft(r.left);
      selected.box.clear();
    },
    update() {
      const s = opts.state();
      const id = s.container?.id;
      // Auto-open once a container's content arrives (after the search), close when it's gone.
      const deferred = !!s.container && !!opts.defer?.(s.container);
      if (deferred && isOpen) api.hide();
      if (id !== undefined && id !== lastContainer && !deferred) api.show();
      if (id === undefined && s.action?.kind !== 'search') api.hide();
      lastContainer = id;
      if (isOpen && (changed(s, last) || opts.content() !== lastContent)) render();
    },
  };
  return api;
}
