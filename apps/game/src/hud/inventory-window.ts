import './inventory-window.css';
import type { ContainerId } from '@deadzone/protocol';
import { createIcon, createItemTooltip } from '@deadzone/ui';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import { combineCommand, combineTipVM } from './combine-model.js';
import { createCombineTooltip, linkIcon } from './combine-tooltip.js';
import {
  CONTEXT_ACTION,
  contextCommand,
  equipmentVM,
  findItem,
  formatKg,
  inventoryVM,
  moveTo,
  putAll,
  quickTransfer,
  takeAll,
  type EquipSlotVM,
  type InvCommand,
  type ItemRowVM,
  type PanelVM,
} from './inventory-model.js';

export interface InventoryWindowOptions {
  root: HTMLElement;
  send: (cmd: InvCommand) => void;
  state: () => GameState;
  content: () => HudContentIndex;
  /** Key labels for the buttons (current bindings). */
  keys: () => { takeAll: string; putAll: string; combine: string };
  /** Key codes that combine the hovered item (default binding: crouch, `C`). */
  isCombineKey: (code: string) => boolean;
}

export interface InventoryWindow {
  readonly open: boolean;
  toggle(): void;
  close(): void;
  takeAll(): void;
  putAll(): void;
  /** Re-render if the state changed (call per frame; cheap when equal). */
  update(): void;
}

const div = (cls: string, text?: string): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
};

/** Item icon cell: baked 3D icon, else the vector icon, else an empty tile. */
function iconCell(cls: string, item: Pick<ItemRowVM, 'icon' | 'image'> | undefined): HTMLElement {
  const cell = div(cls);
  if (item?.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.draggable = false;
    cell.append(img);
  } else if (item?.icon) {
    const svg = createIcon(document, item.icon, 20);
    if (svg) cell.append(svg);
  }
  return cell;
}

/** Small durability bar (mockup: under the name, before `6/10`). */
function durabilityBar(v: number): HTMLElement {
  const bar = div('dz-inv__dur');
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(v * 100)}%`;
  if (v < 0.3) fill.dataset.low = 'true';
  bar.append(fill);
  return bar;
}

/**
 * Simple inventory window (mockup iso-inventory.png, reduced): own inventory (main + bags) and
 * the opened container side by side. Click moves the item across, drag drops it on a panel,
 * PPM equips / unequips / uses, buttons take or put everything.
 */
export function createInventoryWindow(opts: InventoryWindowOptions): InventoryWindow {
  const el = div('dz-inv');
  el.hidden = true;
  const head = div('dz-inv__head');
  head.append(
    div('dz-inv__title', 'Ekwipunek'),
    div(
      'dz-inv__hint',
      'Kliknij lub przeciągnij przedmiot, aby przenieść · PPM załóż / użyj · ' +
        `${opts.keys().combine} połącz · Esc zamknij`,
    ),
  );
  const cols = div('dz-inv__cols');
  const character = div('dz-inv__col');
  const own = div('dz-inv__col');
  const other = div('dz-inv__col');
  cols.append(character, own, other);
  const tooltip = createItemTooltip();
  tooltip.el.classList.add('dz-inv__tooltip');
  const comboTip = createCombineTooltip();
  el.append(head, cols, tooltip.el, comboTip.el);
  opts.root.append(el);
  /** Item under the cursor (combine key). */
  let hovered: number | undefined;
  /** Tooltip to the right of the hovered row (left when it would leave the window). */
  const placeBeside = (row: HTMLElement, w: number): { left: number; top: number } => {
    const r = row.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    const right = r.right + 12;
    const left = right + w > host.right - 16 ? r.left - 12 - w : right;
    const top = Math.max(0, Math.min(r.top - host.top, host.height - 520));
    return { left: left - host.left, top };
  };
  const showTooltip = (row: HTMLElement, item: ItemRowVM): void => {
    hovered = item.id;
    const s = opts.state();
    const it = item.combine ? findItem(s, item.id) : undefined;
    const tip = it ? combineTipVM(it, s.crafting, opts.content()) : undefined;
    if (tip) {
      tooltip.hide();
      comboTip.show(tip, {
        combine: opts.keys().combine,
        ...(item.context ? {} : { context: 'PPM' }),
      });
      comboTip.place(placeBeside(row, 380));
      return;
    }
    comboTip.hide();
    tooltip.hover(item.tooltip);
    tooltip.place(placeBeside(row, tooltip.el.offsetWidth || 300));
  };
  const hideTooltips = (): void => {
    hovered = undefined;
    tooltip.unhover();
    comboTip.hide();
  };
  const combine = (id: number | undefined): void => {
    if (id === undefined) return;
    const s = opts.state();
    const cmd = combineCommand(findItem(s, id), s.crafting);
    if (cmd) opts.send(cmd);
  };
  window.addEventListener('keydown', (e) => {
    if (!isOpen || e.repeat || !opts.isCombineKey(e.code)) return;
    combine(hovered);
  });
  const rowEls = new Map<number, { row: HTMLElement; vm: ItemRowVM }>();
  let isOpen = false;
  let last: GameState | undefined;
  let lastContent: HudContentIndex | undefined;

  const send = (cmds: (InvCommand | undefined)[]): void => {
    for (const c of cmds) if (c) opts.send(c);
  };

  const renderPanel = (p: PanelVM, extra?: HTMLElement, bar = true): HTMLElement => {
    const box = div('dz-inv__panel');
    const top = div('dz-inv__panel-head');
    top.append(
      div('dz-inv__panel-title', p.title),
      div(
        'dz-inv__panel-weight',
        p.capacityKg === null || !bar
          ? `${formatKg(p.weightKg)} kg`
          : `${formatKg(p.weightKg)} / ${formatKg(p.capacityKg)} kg`,
      ),
    );
    box.append(top);
    if (p.capacityKg !== null && bar) {
      const track = div('dz-inv__bar');
      const fill = div('dz-inv__bar-fill');
      const r = p.capacityKg > 0 ? p.weightKg / p.capacityKg : 0;
      fill.style.width = `${Math.min(100, r * 100)}%`;
      if (r > 1) fill.dataset.over = 'true';
      track.append(fill);
      box.append(track);
    }
    const list = div('dz-inv__rows');
    if (!p.rows.length) list.append(div('dz-inv__empty', 'Pusto'));
    for (const r of p.rows) {
      const row = div('dz-inv__row');
      row.draggable = true;
      if (r.equipped) row.dataset.equipped = 'true';
      if (r.combine) row.dataset.combo = r.combine.state;
      const txt = div('dz-inv__row-text');
      txt.append(div('dz-inv__row-name', r.name));
      const subText = [r.sub, r.context ? `PPM ${CONTEXT_ACTION[r.context]}` : '']
        .filter(Boolean)
        .join(' · ');
      if (subText || r.durability !== undefined || r.combine) {
        const sub = div('dz-inv__row-sub');
        if (r.durability !== undefined) sub.append(durabilityBar(r.durability));
        sub.append(subText);
        if (r.combine) {
          const hint = document.createElement('span');
          hint.className = 'dz-inv__combo-hint';
          hint.dataset.state = r.combine.state;
          hint.append(linkIcon(11), r.combine.hint);
          sub.append(hint);
        }
        txt.append(sub);
      }
      const icon = iconCell('dz-inv__icon', r);
      if (r.combine) {
        const badge = document.createElement('span');
        badge.className = 'dz-inv__cb';
        badge.dataset.state = r.combine.state;
        badge.append(linkIcon(11));
        icon.append(badge);
      }
      row.append(icon, txt, div('dz-inv__row-weight', r.weight));
      rowEls.set(r.id, { row, vm: r });
      row.addEventListener('pointerenter', () => showTooltip(row, r));
      row.addEventListener('pointerleave', hideTooltips);
      row.addEventListener('click', () => send([quickTransfer(opts.state(), r.id)]));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (!r.context && r.combine) combine(r.id);
        else send([contextCommand(opts.state(), opts.content(), r.id)]);
      });
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/x-dz-item', String(r.id));
      });
      list.append(row);
    }
    box.append(list);
    const target: ContainerId = p.container;
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      box.dataset.drop = 'true';
    });
    box.addEventListener('dragleave', () => delete box.dataset.drop);
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      delete box.dataset.drop;
      const id = Number(e.dataTransfer?.getData('text/x-dz-item'));
      if (Number.isInteger(id)) send([moveTo(opts.state(), id, target)]);
    });
    if (extra) box.append(extra);
    return box;
  };

  const equipSlot = (e: EquipSlotVM): HTMLElement => {
    const cell = div('dz-inv__eq');
    const box = iconCell('dz-inv__eq-slot', e.item);
    if (e.item) {
      box.dataset.filled = 'true';
      const item = e.item;
      box.addEventListener('pointerenter', () => showTooltip(box, item));
      box.addEventListener('pointerleave', () => tooltip.unhover());
      box.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        send([{ type: 'unequip', slot: e.slot }]);
      });
      box.addEventListener('click', () => send([{ type: 'unequip', slot: e.slot }]));
    }
    cell.append(box, div('dz-inv__eq-label', e.label));
    return cell;
  };

  /** „Postać · Wyposażenie”: total weight, equipment slots; the main inventory follows. */
  const renderCharacter = (): HTMLElement => {
    const s = opts.state();
    const inv = s.inventory;
    const box = div('dz-inv__panel');
    const top = div('dz-inv__panel-head');
    top.append(
      div('dz-inv__panel-title', 'Postać · Wyposażenie'),
      div('dz-inv__panel-weight', inv ? `${formatKg(inv.loadKg)} kg` : ''),
    );
    box.append(top);
    if (inv) {
      const line = div('dz-inv__load');
      line.append(
        div(
          'dz-inv__load-label',
          `Waga całkowita (przeciążenie od ${formatKg(inv.capacityKg)} kg)`,
        ),
        div('dz-inv__panel-weight', `${formatKg(inv.loadKg)} / ${formatKg(inv.capacityKg)} kg`),
      );
      const bar = div('dz-inv__bar');
      const fill = div('dz-inv__bar-fill');
      const r = inv.capacityKg > 0 ? inv.loadKg / inv.capacityKg : 0;
      fill.style.width = `${Math.min(100, r * 100)}%`;
      if (r > 1) fill.dataset.over = 'true';
      bar.append(fill);
      box.append(line, bar);
    }
    const grid = div('dz-inv__eq-grid');
    grid.append(...equipmentVM(s, opts.content()).map(equipSlot));
    box.append(grid);
    return box;
  };

  const button = (label: string, key: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dz-inv__btn';
    const k = document.createElement('span');
    k.className = 'dz-inv__key';
    k.textContent = key;
    b.append(label, k);
    b.addEventListener('click', onClick);
    return b;
  };

  const render = (): void => {
    const s = opts.state();
    const content = opts.content();
    last = s;
    lastContent = content;
    const vm = inventoryVM(s, content);
    const keep = hovered;
    tooltip.hide();
    comboTip.hide();
    hovered = undefined;
    rowEls.clear();
    const [main, ...bags] = vm.own;
    character.replaceChildren(
      renderCharacter(),
      ...(main ? [renderPanel(main, undefined, false)] : []),
    );
    own.replaceChildren(...bags.map((p) => renderPanel(p)));
    if (!bags.length) own.append(div('dz-inv__panel dz-inv__empty', 'Brak torby — załóż plecak'));
    if (vm.open) {
      const keys = opts.keys();
      const btns = div('dz-inv__btns');
      btns.append(
        button('Weź wszystko', keys.takeAll, () => api.takeAll()),
        button('Odłóż wszystko', keys.putAll, () => api.putAll()),
      );
      other.replaceChildren(renderPanel(vm.open, btns));
    } else {
      other.replaceChildren(
        div(
          'dz-inv__panel dz-inv__empty',
          'Brak otwartego schowka — podejdź do schowka i naciśnij F',
        ),
      );
    }
    restoreHover(keep);
  };

  /** Re-renders keep the tooltip of the row still under the cursor. */
  const restoreHover = (id: number | undefined): void => {
    const hit = id === undefined ? undefined : rowEls.get(id);
    if (hit?.row.isConnected) showTooltip(hit.row, hit.vm);
  };

  const api: InventoryWindow = {
    get open() {
      return isOpen;
    },
    toggle() {
      isOpen = !isOpen;
      el.hidden = !isOpen;
      if (!isOpen) hideTooltips();
      opts.root.dataset.modal = isOpen ? 'inventory' : '';
      if (isOpen) render();
    },
    close() {
      if (isOpen) api.toggle();
    },
    takeAll() {
      send(takeAll(opts.state()));
    },
    putAll() {
      send(putAll(opts.state()));
    },
    update() {
      if (isOpen && (opts.state() !== last || opts.content() !== lastContent)) render();
    },
  };
  return api;
}
