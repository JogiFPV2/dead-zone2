import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { createStatRows } from '../stat-row/stat-row.js';
import { renderKeyFooter } from './footer.js';
import {
  DEFAULT_ITEM_ACTIONS,
  TOOLTIP_DELAY_MS,
  TOOLTIP_HOLD_MS,
  type TooltipItem,
} from './model.js';

/** Spec §5 `HudState.tooltip`. */
export type TooltipVM = { item: TooltipItem; slot: number } | null;

export interface ItemTooltip extends Mounted<TooltipVM> {
  /** Selection changed (keys 1–5, wheel, click): visible now, fades after 2.5 s. */
  select(item: TooltipItem): void;
  /** Cursor over a slot: visible after 250 ms and stays until `unhover`. */
  hover(item: TooltipItem): void;
  unhover(): void;
  hide(): void;
  /** Pixel position from `tooltipPosition` (HUD coordinates). */
  place(pos: { left: number; top: number }): void;
}

/** Item tooltip above the selected slot. Fade motion.fast; pointer-events none. */
export function createItemTooltip(vm: TooltipVM = null, doc: Doc = defaultDoc()): ItemTooltip {
  const root = el(doc, 'div', 'dz-tooltip');
  root.setAttribute('role', 'tooltip');
  const head = el(doc, 'div', 'dz-tooltip__head');
  const name = el(doc, 'div', 'dz-tooltip__name');
  const category = el(doc, 'div', 'dz-tooltip__category');
  head.append(name, category);
  const stats = createStatRows([], doc);
  const footer = el(doc, 'div', 'dz-keyfoot');
  root.append(head, stats.el, footer);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let hovering = false;
  const render = (item: TooltipItem): void => {
    name.textContent = item.name;
    category.textContent = item.category;
    stats.update(item.stats);
    renderKeyFooter(footer, item.actions ?? DEFAULT_ITEM_ACTIONS, doc);
  };
  const setVisible = (on: boolean): void => {
    setData(root, 'visible', on);
    root.setAttribute('aria-hidden', String(!on));
  };
  const hide = (): void => {
    clearTimeout(timer);
    hovering = false;
    setVisible(false);
  };
  const select = (item: TooltipItem): void => {
    clearTimeout(timer);
    render(item);
    setVisible(true);
    if (!hovering) timer = setTimeout(() => setVisible(false), TOOLTIP_HOLD_MS);
  };
  const hover = (item: TooltipItem): void => {
    clearTimeout(timer);
    hovering = true;
    render(item);
    timer = setTimeout(() => setVisible(true), TOOLTIP_DELAY_MS);
  };
  const update = (p: TooltipVM): void => {
    if (p) select(p.item);
    else hide();
  };
  setVisible(false);
  if (vm) update(vm);
  return {
    el: root,
    update,
    select,
    hover,
    unhover: hide,
    hide,
    place: ({ left, top }) => {
      root.style.transform = `translate(${left}px, ${top}px)`;
    },
    destroy: () => {
      clearTimeout(timer);
      root.remove();
    },
  };
}
