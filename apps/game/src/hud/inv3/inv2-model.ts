import type { EquipSlot } from '@deadzone/protocol';
import type { InvRowVM } from './inv3-model.js';

/** Inventory v2 phone filter rail (inventory-v2-spec §4): category chips with counters. */
export type Inv2Category = 'all' | 'weapon' | 'food' | 'medical' | 'tools' | 'clothing' | 'other';

export const INV2_CATEGORIES: readonly { id: Inv2Category; label: string; short: string }[] = [
  { id: 'all', label: 'Wszystko', short: 'Wsz.' },
  { id: 'weapon', label: 'Broń', short: 'Broń' },
  { id: 'food', label: 'Jedzenie', short: 'Jedz.' },
  { id: 'medical', label: 'Medyczne', short: 'Med.' },
  { id: 'tools', label: 'Narzędzia', short: 'Narz.' },
  { id: 'clothing', label: 'Ubrania', short: 'Ubr.' },
  { id: 'other', label: 'Inne', short: 'Inne' },
];

const BY_KIND: Readonly<Record<string, Exclude<Inv2Category, 'all'>>> = {
  weapon_melee: 'weapon',
  weapon_ranged: 'weapon',
  ammo: 'weapon',
  ammo_box: 'weapon',
  magazine: 'weapon',
  food: 'food',
  drink: 'food',
  medical: 'medical',
  tool: 'tools',
  clothing: 'clothing',
  container: 'clothing',
};

/** Item kind (content `kind`) → rail category; unknown kinds are „Inne”. */
export const categoryOfKind = (kind: string | undefined): Exclude<Inv2Category, 'all'> =>
  (kind !== undefined ? BY_KIND[kind] : undefined) ?? 'other';

type KindOf = (def: string) => string | undefined;

/** Items per category (stack counts) over the given rows; `all` = every item. */
export function categoryCounts(
  rows: readonly InvRowVM[],
  kindOf: KindOf,
): Record<Inv2Category, number> {
  const n: Record<Inv2Category, number> = {
    all: 0,
    weapon: 0,
    food: 0,
    medical: 0,
    tools: 0,
    clothing: 0,
    other: 0,
  };
  for (const r of rows) {
    n.all += r.count;
    n[categoryOfKind(kindOf(r.def))] += r.count;
  }
  return n;
}

export const filterRows = (
  rows: readonly InvRowVM[],
  cat: Inv2Category,
  kindOf: KindOf,
): InvRowVM[] =>
  cat === 'all' ? [...rows] : rows.filter((r) => categoryOfKind(kindOf(r.def)) === cat);

/**
 * POSTAĆ strip (inventory-v2-spec §1, mobile: 44 px slots in a row): right / left hand, backpack,
 * torso, legs, hands. A slot shows the first equipped item of its slots.
 */
export const INV2_SLOTS: readonly {
  key: string;
  label: string;
  short: string;
  slots: readonly EquipSlot[];
}[] = [
  { key: 'P', label: 'Prawa ręka', short: 'P', slots: ['hand_primary'] },
  { key: 'L', label: 'Lewa ręka', short: 'L', slots: ['hand_secondary'] },
  { key: 'back', label: 'Plecak', short: 'Plec.', slots: ['back'] },
  { key: 'torso', label: 'Korpus', short: 'Korp.', slots: ['torso_outer', 'torso_inner'] },
  { key: 'legs', label: 'Nogi', short: 'Nogi', slots: ['legs'] },
  { key: 'hands', label: 'Dłonie', short: 'Dłon.', slots: ['hands'] },
];

export interface Inv2SlotVM {
  key: string;
  label: string;
  short: string;
  itemId?: number;
}

export function characterSlots(equipped: Partial<Record<EquipSlot, number>>): Inv2SlotVM[] {
  return INV2_SLOTS.map((s) => {
    const id = s.slots.map((k) => equipped[k]).find((x) => x !== undefined);
    return {
      key: s.key,
      label: s.label,
      short: s.short,
      ...(id !== undefined ? { itemId: id } : {}),
    };
  });
}

/**
 * Inventory v2 tap on panel `to` (spec, mobile: „tap na drugi panel lub pusty slot przenosi
 * zaznaczony”): the side to move from, or undefined (nothing selected there → a plain select).
 */
export function tapMoveFrom(
  to: 'own' | 'box',
  selectedCount: Readonly<Record<'own' | 'box', number>>,
): 'own' | 'box' | undefined {
  const from = to === 'own' ? 'box' : 'own';
  return selectedCount[from] > 0 ? from : undefined;
}

/** Inventory v2 long press (spec, mobile: 400 ms; the shared LONG_PRESS_MS stays 450 elsewhere). */
export const INV2_LONG_PRESS_MS = 400;

export type Inv2ActionId = 'context' | 'combine' | 'move' | 'drop';
export interface Inv2Action {
  id: Inv2ActionId;
  label: string;
}

const CONTEXT_LABEL: Readonly<Record<string, string>> = {
  equip: 'Załóż',
  unequip: 'Zdejmij',
  use: 'Użyj',
  watch: 'Oglądaj',
};

/**
 * Long-press menu of an item (mockup: Użyj · Załóż · Połącz… · Przenieś do … · Upuść); the first
 * entry is the default action.
 */
export function itemActions(o: {
  side: 'own' | 'box';
  context?: string;
  combine?: boolean;
  /** Name of the opened container (own side) — undefined: nothing to move into. */
  boxName?: string;
}): Inv2Action[] {
  const a: Inv2Action[] = [];
  if (o.context && CONTEXT_LABEL[o.context])
    a.push({ id: 'context', label: CONTEXT_LABEL[o.context]! });
  if (o.combine) a.push({ id: 'combine', label: 'Połącz…' });
  if (o.side === 'box') a.push({ id: 'move', label: 'Weź do plecaka' });
  else if (o.boxName) a.push({ id: 'move', label: `Przenieś: ${o.boxName}` });
  if (o.side === 'own') a.push({ id: 'drop', label: 'Upuść' });
  return a;
}
