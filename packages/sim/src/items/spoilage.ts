import type { Freshness } from '@deadzone/protocol';
import type { ItemDef } from '../content/adapter.js';
import { defOf, type ItemInstance, type ItemStore } from './store.js';

/**
 * Lazy spoilage (docs 2.5 `spoilage`): no per-tick work. An item keeps `ageMin` (effective age at
 * `ageStamp`); the age now is `ageMin + (now − ageStamp) × multiplier of its container`. Moving
 * the item re-stamps it first, so every stretch is aged at the rate of where it was.
 */
export function spoilageOf(def: ItemDef): { freshMin: number; rottenMin: number } | undefined {
  if (def.kind === 'food') return def.food.spoilage;
  if (def.kind === 'drink') return def.drink.spoilage;
  return undefined;
}

/**
 * Spoilage rate of a container: storage type `spoilageMultiplier` (fridge ×0.3, freezer ×0.05)
 * when it has power or needs none; everything else ×1 (a bag inside a fridge does not cool).
 */
export function spoilageMultiplier(st: ItemStore, containerId: number): number {
  const c = st.containers.get(containerId);
  if (!c || c.type < 0) return 1;
  const t = st.content.containerTypes[c.type]!;
  if (t.requiresPower && !st.powered) return 1;
  return t.spoilageMultiplier;
}

export function ageAt(st: ItemStore, item: ItemInstance, minute: number): number {
  const dt = minute - item.ageStamp;
  return Math.fround(item.ageMin + (dt > 0 ? dt * spoilageMultiplier(st, item.loc) : 0));
}

/** Writes the age so far before the item changes container (or the multiplier changes). */
export function restamp(st: ItemStore, item: ItemInstance, minute: number): void {
  if (!spoilageOf(defOf(st, item))) {
    item.ageStamp = minute;
    return;
  }
  item.ageMin = ageAt(st, item, minute);
  item.ageStamp = minute;
}

export function freshness(
  st: ItemStore,
  item: ItemInstance,
  minute: number,
): Freshness | undefined {
  const sp = spoilageOf(defOf(st, item));
  if (!sp) return undefined;
  const age = ageAt(st, item, minute);
  return age < sp.freshMin ? 'fresh' : age < sp.rottenMin ? 'stale' : 'rotten';
}
