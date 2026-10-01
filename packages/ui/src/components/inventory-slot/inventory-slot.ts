import { defaultDoc, el, setData, type Doc, type Mounted } from '../../dom/h.js';
import { createIcon } from '../../icons/icon.js';
import { slotCount, slotState, type SlotItem } from './model.js';

export interface InventorySlotProps {
  item: SlotItem | null;
  /** Keybind digit shown top-left (`1`–`5`); omit in inventory grids. */
  keybind?: string;
  selected?: boolean;
  /**
   * `true` in inventory screens: real `:hover` turns on the hover state.
   * On the hotbar hover has no visual state (spec: "tylko ekwipunek / kursor").
   */
  hoverable?: boolean;
  /** Force the hover state (preview, gamepad cursor). */
  hover?: boolean;
  onSelect?: () => void;
}

/** 64×64 slot. State in `data-state` (empty|filled|selected|disabled|hover). */
export function createInventorySlot(
  props: InventorySlotProps,
  doc: Doc = defaultDoc(),
): Mounted<InventorySlotProps> {
  const root = el(doc, 'div', 'dz-slot');
  const key = el(doc, 'span', 'dz-slot__key');
  const icon = el(doc, 'span', 'dz-slot__icon');
  const count = el(doc, 'span', 'dz-slot__count');
  root.append(key, icon, count);
  let onSelect: (() => void) | undefined;
  // Clicks on HUD elements must not reach the game canvas (spec §5).
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    if (root.dataset.state !== 'disabled') onSelect?.();
  });

  let iconName: string | undefined;
  const update = (p: InventorySlotProps): void => {
    onSelect = p.onSelect;
    const state = slotState({
      item: p.item,
      selected: p.selected ?? false,
      hover: p.hover ?? false,
    });
    root.dataset.state = state;
    setData(root, 'hoverable', p.hoverable ?? false);
    // Selected empty slot: selected border on the empty background.
    setData(root, 'empty', p.item === null);
    root.setAttribute('aria-selected', String(p.selected ?? false));
    root.setAttribute('aria-disabled', String(state === 'disabled'));
    if (p.item) root.title = p.item.name;
    else root.removeAttribute('title');
    key.textContent = p.keybind ?? '';
    const image = p.item?.image;
    const nextIcon = image ? `img:${image}` : p.item?.icon;
    if (nextIcon !== iconName) {
      iconName = nextIcon;
      setData(icon, 'image', Boolean(image));
      if (image) {
        const img = doc.createElement('img');
        img.className = 'dz-slot__img';
        img.src = image;
        img.alt = '';
        img.draggable = false;
        icon.replaceChildren(img);
      } else {
        const svg = nextIcon ? createIcon(doc, nextIcon, 24) : null;
        icon.replaceChildren(...(svg ? [svg] : []));
      }
    }
    count.textContent = slotCount(p.item);
  };
  update(props);
  return { el: root, update, destroy: () => root.remove() };
}
