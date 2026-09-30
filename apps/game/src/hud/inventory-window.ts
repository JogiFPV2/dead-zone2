import './inventory-window.css';
import type { ContainerId } from '@deadzone/protocol';
import type { GameState } from '../state/game-state.js';
import type { HudContentIndex } from './content-index.js';
import {
  contextCommand,
  formatKg,
  inventoryVM,
  moveTo,
  putAll,
  quickTransfer,
  takeAll,
  type InvCommand,
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
  const own = div('dz-inv__col');
  const other = div('dz-inv__col');
  cols.append(own, other);
  el.append(head, cols);
  opts.root.append(el);
  let isOpen = false;
  let last: GameState | undefined;
  let lastContent: HudContentIndex | undefined;

  const send = (cmds: (InvCommand | undefined)[]): void => {
    for (const c of cmds) if (c) opts.send(c);
  };

  const renderPanel = (p: PanelVM, extra?: HTMLElement): HTMLElement => {
    const box = div('dz-inv__panel');
    const top = div('dz-inv__panel-head');
    top.append(
      div('dz-inv__panel-title', p.title),
      div(
        'dz-inv__panel-weight',
        p.capacityKg === null
          ? `${formatKg(p.weightKg)} kg`
          : `${formatKg(p.weightKg)} / ${formatKg(p.capacityKg)} kg`,
      ),
    );
    box.append(top);
    if (p.capacityKg !== null) {
      const bar = div('dz-inv__bar');
      const fill = div('dz-inv__bar-fill');
      const r = p.capacityKg > 0 ? p.weightKg / p.capacityKg : 0;
      fill.style.width = `${Math.min(100, r * 100)}%`;
      if (r > 1) fill.dataset.over = 'true';
      bar.append(fill);
      box.append(bar);
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
      if (subText) txt.append(div('dz-inv__row-sub', subText));
      row.append(div('dz-inv__icon'), txt, div('dz-inv__row-weight', r.weight));
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
    own.replaceChildren(...vm.own.map((p) => renderPanel(p)));
    if (!vm.own.length) own.append(div('dz-inv__panel dz-inv__empty', 'Brak ekwipunku'));
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
