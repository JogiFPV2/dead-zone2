import './inventory-window.css';
import type { ContainerId } from '@deadzone/protocol';
import { createIcon, createItemTooltip } from '@deadzone/ui';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import {
  contextCommand,
  equipmentVM,
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
  keys: () => { takeAll: string; putAll: string };
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

const CONTEXT_LABEL = { equip: 'załóż', unequip: 'zdejmij', use: 'użyj' } as const;

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
      'Kliknij lub przeciągnij przedmiot, aby przenieść · PPM załóż / użyj · Esc zamknij',
    ),
  );
  const cols = div('dz-inv__cols');
  const character = div('dz-inv__col');
  const own = div('dz-inv__col');
  const other = div('dz-inv__col');
  cols.append(character, own, other);
  const tooltip = createItemTooltip();
  tooltip.el.classList.add('dz-inv__tooltip');
  el.append(head, cols, tooltip.el);
  opts.root.append(el);
  /** Tooltip to the right of the hovered row (left when it would leave the window). */
  const showTooltip = (row: HTMLElement, item: ItemRowVM): void => {
    tooltip.hover(item.tooltip);
    const r = row.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    const w = tooltip.el.offsetWidth || 300;
    const right = r.right + 12;
    const left = right + w > host.right - 16 ? r.left - 12 - w : right;
    tooltip.place({ left: left - host.left, top: r.top - host.top });
  };
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
      const txt = div('dz-inv__row-text');
      txt.append(div('dz-inv__row-name', r.name));
      const subText = [r.sub, r.context ? `PPM ${CONTEXT_LABEL[r.context]}` : '']
        .filter(Boolean)
        .join(' · ');
      if (subText || r.durability !== undefined) {
        const sub = div('dz-inv__row-sub');
        if (r.durability !== undefined) sub.append(durabilityBar(r.durability));
        sub.append(subText);
        txt.append(sub);
      }
      row.append(iconCell('dz-inv__icon', r), txt, div('dz-inv__row-weight', r.weight));
      row.addEventListener('pointerenter', () => showTooltip(row, r));
      row.addEventListener('pointerleave', () => tooltip.unhover());
      row.addEventListener('click', () => send([quickTransfer(opts.state(), r.id)]));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        send([contextCommand(opts.state(), opts.content(), r.id)]);
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
    tooltip.hide();
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
  };

  const api: InventoryWindow = {
    get open() {
      return isOpen;
    },
    toggle() {
      isOpen = !isOpen;
      el.hidden = !isOpen;
      if (!isOpen) tooltip.hide();
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
