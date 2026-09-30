/** InventorySlot rules (spec §3.5, §5 ItemVM). */

export type SlotState = 'empty' | 'filled' | 'selected' | 'disabled' | 'hover';
export const SLOT_STATES = [
  'empty',
  'filled',
  'selected',
  'disabled',
  'hover',
] as const satisfies readonly SlotState[];

/** Subset of spec ItemVM the slot needs. */
export interface SlotItem {
  id: string;
  name: string;
  /** Icon name from `@deadzone/ui` icons; unknown names render no icon. */
  icon: string;
  count?: number;
  stackable: boolean;
  /** false = no ammo / broken / action in progress → `disabled`. */
  usable: boolean;
}

export interface SlotStateInput {
  item: SlotItem | null;
  selected?: boolean;
  /** Pointer is over the slot (inventory screens only). */
  hover?: boolean;
}

/**
 * Precedence: disabled > selected > hover > filled/empty.
 * An empty slot can be selected (keys 1–5 cycle through all slots).
 */
export function slotState({ item, selected = false, hover = false }: SlotStateInput): SlotState {
  if (item && !item.usable) return 'disabled';
  if (selected) return 'selected';
  if (hover) return 'hover';
  return item ? 'filled' : 'empty';
}

/** Counter only for stackable items. */
export const slotCount = (item: SlotItem | null): string =>
  item?.stackable && item.count !== undefined ? String(item.count) : '';
