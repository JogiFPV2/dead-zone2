import type { EquipSlot } from '@deadzone/protocol';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';
import { itemViewName } from '../crafting-labels.js';
import { itemImage } from '../item-icons.js';
import type { InvCommand } from '../inventory-model.js';
import { dollDropSlot, dollVM, pct, DOLL_SLOTS } from './paperdoll-model.js';

/**
 * Character drawing beside the player panel (Paweł 25.11): a person with a place per worn
 * thing. The inventory window drags list items onto it (`dropTarget` / `drop`); a worn thing
 * dragged off the drawing, double-clicked or right-clicked comes off (`unequip`).
 */
export interface PaperDoll {
  readonly el: HTMLElement;
  render(s: GameState, content: HudContentIndex): void;
  /** Drop on the drawing under a point: the place it goes to (undefined = does not fit / not over). */
  dropTarget(
    x: number,
    y: number,
    def: string,
    content: HudContentIndex,
  ): { over: true; slot?: EquipSlot; label: string } | undefined;
  /** Highlights the place a drag would go (undefined = none). */
  highlight(slot: EquipSlot | undefined): void;
}

const LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  DOLL_SLOTS.map((d) => [d.slot, d.label]),
);

/** Person outline (viewBox 0 0 100 220), painted-style flat shapes. */
const BODY_SVG = `<svg viewBox="0 0 100 220" class="dz-pd__svg" aria-hidden="true">
  <g fill="currentColor">
    <ellipse cx="50" cy="20" rx="13" ry="15"/>
    <rect x="45" y="33" width="10" height="8" rx="2"/>
    <path d="M30 42h40l6 6 4 50-9 2-5-40-1 44H35l-1-44-5 40-9-2 4-50z"/>
    <path d="M35 104h30l2 56-2 46H53l-2-46-2 46H36l-2-46z"/>
    <rect x="15" y="98" width="10" height="13" rx="4"/>
    <rect x="75" y="98" width="10" height="13" rx="4"/>
    <rect x="32" y="204" width="16" height="8" rx="3"/>
    <rect x="52" y="204" width="16" height="8" rx="3"/>
  </g>
</svg>`;

export function createPaperDoll(send: (cmds: InvCommand[]) => void): PaperDoll {
  const el = document.createElement('div');
  el.className = 'dz-pd';
  el.dataset.sec = 'doll';
  const head = document.createElement('div');
  head.className = 'dz-pd__head';
  head.textContent = 'POSTAĆ';
  const fig = document.createElement('div');
  fig.className = 'dz-pd__fig';
  fig.innerHTML = BODY_SVG;
  const stats = document.createElement('div');
  stats.className = 'dz-pd__stats';
  const hint = document.createElement('div');
  hint.className = 'dz-pd__hint';
  hint.textContent = 'Przeciągnij ubranie na postać, żeby założyć.';
  el.append(head, fig, stats, hint);

  const chips = new Map<EquipSlot, HTMLElement>();
  for (const d of DOLL_SLOTS) {
    const c = document.createElement('div');
    c.className = `dz-pd__slot dz-pd__slot--${d.side}`;
    c.dataset.dollSlot = d.slot;
    c.style.top = `${d.y * 100}%`;
    fig.append(c);
    chips.set(d.slot, c);
  }

  // Taking off: double click, right click, or drag off the drawing.
  let drag:
    { slot: EquipSlot; pointer: number; x: number; y: number; ghost?: HTMLElement } | undefined;
  const takeOff = (slot: EquipSlot) => send([{ type: 'unequip', slot }]);
  fig.addEventListener('dblclick', (e) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-doll-slot]')?.dataset
      .dollSlot as EquipSlot | undefined;
    if (slot && chips.get(slot)?.dataset.filled) takeOff(slot);
  });
  fig.addEventListener('contextmenu', (e) => {
    const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-doll-slot]')?.dataset
      .dollSlot as EquipSlot | undefined;
    if (!slot || !chips.get(slot)?.dataset.filled) return;
    e.preventDefault();
    takeOff(slot);
  });
  fig.addEventListener('pointerdown', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-doll-slot]');
    if (!chip?.dataset.filled || e.button !== 0) return;
    e.stopPropagation();
    drag = {
      slot: chip.dataset.dollSlot as EquipSlot,
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
    };
  });
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!drag.ghost) {
      const src = chips.get(drag.slot)!;
      const g = src.cloneNode(true) as HTMLElement;
      g.className = 'dz-pd__ghost';
      document.body.append(g);
      drag.ghost = g;
    }
    drag.ghost.style.left = `${e.clientX + 10}px`;
    drag.ghost.style.top = `${e.clientY + 8}px`;
    const off = !document.elementFromPoint(e.clientX, e.clientY)?.closest('.dz-pd__fig');
    drag.ghost.dataset.off = String(off);
  };
  const onUp = (e: PointerEvent) => {
    const d = drag;
    if (!d || e.pointerId !== d.pointer) return;
    drag = undefined;
    d.ghost?.remove();
    if (!d.ghost) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.dz-pd__fig');
    if (!over) takeOff(d.slot);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  const render = (s: GameState, content: HudContentIndex): void => {
    const vm = dollVM(s, content);
    for (const d of vm.slots) {
      const c = chips.get(d.slot)!;
      c.replaceChildren();
      const ic = document.createElement('span');
      ic.className = 'dz-pd__ic';
      const img = d.item ? itemImage(d.item.def) : undefined;
      if (img) {
        const i = document.createElement('img');
        i.src = img;
        i.alt = '';
        i.draggable = false;
        ic.append(i);
      }
      const t = document.createElement('span');
      t.className = 'dz-pd__t';
      t.textContent = d.item ? itemViewName(d.item) : d.label;
      c.append(ic, t);
      if (d.item) {
        c.dataset.filled = 'true';
        c.title = `${d.label}: ${itemViewName(d.item)} (przeciągnij poza postać lub kliknij dwa razy, żeby zdjąć)`;
      } else {
        delete c.dataset.filled;
        c.title = d.label;
      }
    }
    const t = vm.totals;
    stats.innerHTML = [
      ['Ciepło', t.warmth],
      ['Woda', t.water],
      ['Zadrapania', t.scratch],
      ['Ugryzienia', t.bite],
    ]
      .map(
        ([k, v]) =>
          `<div class="dz-pd__st"><span>${k}</span><span class="dz-pd__bar"><i style="width:${pct(v as number)}"></i></span><b>${pct(v as number)}</b></div>`,
      )
      .join('');
  };

  return {
    el,
    render,
    dropTarget(x, y, def, content) {
      const under = document.elementFromPoint(x, y);
      if (!under?.closest('.dz-pd__fig')) return undefined;
      const over = under.closest<HTMLElement>('[data-doll-slot]')?.dataset.dollSlot as
        EquipSlot | undefined;
      const slot = dollDropSlot(content, def, over);
      return slot
        ? { over: true, slot, label: `ZAŁÓŻ: ${LABEL[slot]?.toUpperCase() ?? slot}` }
        : { over: true, label: 'NIE PASUJE' };
    },
    highlight(slot) {
      for (const [k, c] of chips) {
        if (k === slot) c.dataset.drop = 'ok';
        else delete c.dataset.drop;
      }
    },
  };
}
