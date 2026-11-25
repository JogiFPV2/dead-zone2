import type { EquipSlot, ItemView } from '@deadzone/protocol';
import type { GameState } from '../../state/game-state.js';
import type { HudContentIndex } from '../content-index.js';
import { findItem } from '../inventory-model.js';

/**
 * Character drawing in the inventory (Paweł 25.11): a person with a place for every worn thing.
 * Dragging clothes from the list onto the drawing puts them on; dragging them off takes them
 * off. Totals: warmth, water resistance and protection of what is worn.
 */

/** Places on the drawing, top to bottom; `x` / `y` = where the place sits (0..1 of the box). */
export const DOLL_SLOTS: readonly {
  slot: EquipSlot;
  label: string;
  side: 'L' | 'R';
  y: number;
}[] = [
  { slot: 'head', label: 'Głowa', side: 'L', y: 0.05 },
  { slot: 'face', label: 'Twarz', side: 'R', y: 0.05 },
  { slot: 'torso_inner', label: 'Koszulka', side: 'L', y: 0.24 },
  { slot: 'torso_outer', label: 'Kurtka / bluza', side: 'R', y: 0.24 },
  { slot: 'back', label: 'Plecy', side: 'R', y: 0.41 },
  { slot: 'hands', label: 'Dłonie', side: 'L', y: 0.41 },
  { slot: 'hand_secondary', label: 'Lewa ręka', side: 'L', y: 0.56 },
  { slot: 'hand_primary', label: 'Prawa ręka', side: 'R', y: 0.56 },
  { slot: 'belt', label: 'Pas', side: 'R', y: 0.72 },
  { slot: 'legs', label: 'Spodnie', side: 'L', y: 0.72 },
  { slot: 'feet', label: 'Buty', side: 'L', y: 0.9 },
];

export interface DollSlotVM {
  slot: EquipSlot;
  label: string;
  side: 'L' | 'R';
  y: number;
  item?: ItemView;
}

export interface DollTotals {
  /** Warmth of all clothes (Σ insulation, 0..1). */
  warmth: number;
  /** Best water resistance of an outer layer (0..1). */
  water: number;
  /** Mean protection over the body parts (head, torso, hands, legs, feet). */
  scratch: number;
  bite: number;
}

export interface DollVM {
  slots: DollSlotVM[];
  totals: DollTotals;
}

const CLOTHES: readonly EquipSlot[] = [
  'head',
  'face',
  'torso_inner',
  'torso_outer',
  'hands',
  'legs',
  'feet',
];
/** Body parts for the mean protection: torso takes the better of its two layers. */
const PARTS: readonly (readonly EquipSlot[])[] = [
  ['head'],
  ['torso_inner', 'torso_outer'],
  ['hands'],
  ['legs'],
  ['feet'],
];

export function dollVM(s: GameState, content: HudContentIndex): DollVM {
  const eq = s.inventory?.equipped ?? {};
  const itemIn = (slot: EquipSlot): ItemView | undefined => {
    const id = eq[slot];
    return id === undefined ? undefined : findItem(s, id);
  };
  const slots = DOLL_SLOTS.map((d) => {
    const item = itemIn(d.slot);
    return { ...d, ...(item ? { item } : {}) };
  });
  const stats = (slot: EquipSlot) => {
    const it = itemIn(slot);
    return it ? content.items.get(it.def)?.clothing : undefined;
  };
  let warmth = 0;
  let water = 0;
  for (const slot of CLOTHES) {
    const c = stats(slot);
    if (!c) continue;
    warmth += c.insulation;
    water = Math.max(water, c.waterResistance);
  }
  const mean = (k: 'scratch' | 'bite') =>
    PARTS.reduce((n, p) => n + Math.max(0, ...p.map((sl) => stats(sl)?.[k] ?? 0)), 0) /
    PARTS.length;
  return {
    slots,
    totals: { warmth: Math.min(1, warmth), water, scratch: mean('scratch'), bite: mean('bite') },
  };
}

/**
 * Where a dragged item goes when dropped on the drawing: the place under the pointer if the item
 * fits there, else its own place (clothes, bags) when dropped anywhere on the body.
 */
export function dollDropSlot(
  content: HudContentIndex,
  def: string,
  over: EquipSlot | undefined,
): EquipSlot | undefined {
  const slots = content.items.get(def)?.equipSlots ?? [];
  if (over && slots.includes(over)) return over;
  if (over === 'hand_primary' || over === 'hand_secondary') return undefined;
  return slots[0];
}

/** `0.35` → `35%`. */
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
