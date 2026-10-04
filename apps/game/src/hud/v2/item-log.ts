import './item-log.css';
import { createIcon } from '@deadzone/ui';
import { itemImage } from '../item-icons.js';
import {
  itemLogOpacity,
  itemLogRemaining,
  itemLogText,
  pruneItemLog,
  pushItemLog,
  type ItemDelta,
  type ItemLogEntry,
} from './item-log-model.js';

export interface ItemLog {
  readonly el: HTMLElement;
  push(changes: readonly ItemDelta[], now: number): void;
  /** Ages / fades rows (call at the HUD rate). */
  frame(now: number): void;
  /** Drops every row (HUD editor sample off). */
  clear(now: number): void;
}

export interface ItemLogOptions {
  name: (def: string) => string;
  /** Vector icon name for items without a baked icon. */
  vectorIcon: (def: string) => string;
}

const EXIT_MS = 160;

/** „Ostatnie przedmioty” (HUD v2 spec §5): max 4 rows, ~4 s each, newest on top. */
export function createItemLog(opts: ItemLogOptions): ItemLog {
  const el = document.createElement('div');
  el.className = 'dz-itemlog';
  el.hidden = true;
  const head = document.createElement('div');
  head.className = 'dz-itemlog__head';
  head.textContent = 'Ostatnie przedmioty';
  const list = document.createElement('div');
  list.className = 'dz-itemlog__list';
  el.append(head, list);

  let log: ItemLogEntry[] = [];
  let nextId = 1;
  const rows = new Map<number, { row: HTMLElement; text: HTMLElement; time: HTMLElement }>();

  const icon = (def: string): HTMLElement => {
    const cell = document.createElement('span');
    cell.className = 'dz-itemlog__ic';
    const src = def ? itemImage(def) : undefined;
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      cell.append(img);
    } else {
      const svg = createIcon(document, def ? opts.vectorIcon(def) : 'info', 14);
      if (svg) cell.append(svg);
    }
    return cell;
  };

  const render = (now: number): void => {
    const ids = new Set(log.map((e) => e.id));
    for (const [id, r] of rows) {
      if (ids.has(id) || r.row.dataset.leaving) continue;
      r.row.dataset.leaving = 'true';
      setTimeout(() => {
        r.row.remove();
        el.hidden = log.length === 0 && list.childElementCount === 0;
      }, EXIT_MS);
      rows.delete(id);
    }
    log.forEach((e, i) => {
      let r = rows.get(e.id);
      if (!r) {
        const row = document.createElement('div');
        row.className = 'dz-itemlog__row';
        row.dataset.kind = e.kind;
        const text = document.createElement('span');
        text.className = 'dz-itemlog__text';
        const time = document.createElement('span');
        time.className = 'dz-itemlog__time';
        row.append(icon(e.def), text, time);
        r = { row, text, time };
        rows.set(e.id, r);
      }
      const t = itemLogText(e, e.def ? opts.name(e.def) : '');
      if (r.text.textContent !== t) r.text.textContent = t;
      r.time.textContent = itemLogRemaining(e, now);
      r.row.style.opacity = String(itemLogOpacity(i, log.length));
      if (list.children[i] !== r.row) list.insertBefore(r.row, list.children[i] ?? null);
    });
    el.hidden = log.length === 0 && list.childElementCount === 0;
  };

  return {
    el,
    push(changes, now) {
      if (!changes.length) return;
      for (const c of changes) {
        log = pushItemLog(log, c, now, nextId++);
        // A merged entry moves to the top: re-insert its row there.
      }
      render(now);
    },
    clear(now) {
      log = [];
      render(now);
    },
    frame(now) {
      const before = log.length;
      log = pruneItemLog(log, now);
      if (before || list.childElementCount) render(now);
    },
  };
}
