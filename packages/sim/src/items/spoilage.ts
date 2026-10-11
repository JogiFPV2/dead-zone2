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

const FREEZER = { freezeAfterMin: 360, thawMin: 720, frozenSpoilageMultiplier: 0.05 };
const freezerCfg = (st: ItemStore) => st.content.utilities?.freezer ?? FREEZER;

/** The container freezes now: category `freezer` with power (or not needing it). */
export function freezesNow(st: ItemStore, containerId: number): boolean {
  const c = st.containers.get(containerId);
  if (!c || c.type < 0) return false;
  const t = st.content.containerTypes[c.type]!;
  return t.category === 'freezer' && (!t.requiresPower || st.powered);
}

export function ageAt(st: ItemStore, item: ItemInstance, minute: number): number {
  const dt = minute - item.ageStamp;
  if (dt <= 0) return Math.fround(item.ageMin);
  const rate = spoilageMultiplier(st, item.loc);
  // Thawing: the frozen stretch ages at the frozen rate (or the container's, if colder).
  const frozen = item.thawUntil !== undefined ? Math.min(dt, item.thawUntil - item.ageStamp) : 0;
  if (frozen <= 0) return Math.fround(item.ageMin + dt * rate);
  const fr = Math.min(rate, freezerCfg(st).frozenSpoilageMultiplier);
  return Math.fround(item.ageMin + frozen * fr + (dt - frozen) * rate);
}

/**
 * Frozen at `minute`: in a working freezer for `freezeAfterMin` (since the last stamp), or still
 * thawing (`thawUntil`).
 */
export function isFrozen(st: ItemStore, item: ItemInstance, minute: number): boolean {
  if (!spoilageOf(defOf(st, item))) return false;
  if (item.thawUntil !== undefined && minute < item.thawUntil) return true;
  return freezesNow(st, item.loc) && minute - item.ageStamp >= freezerCfg(st).freezeAfterMin;
}

/** Minutes left until a frozen item out of the cold has thawed (0 = not thawing). */
export function thawLeftMin(st: ItemStore, item: ItemInstance, minute: number): number {
  if (item.thawUntil === undefined || freezesNow(st, item.loc)) return 0;
  return Math.max(0, item.thawUntil - minute);
}

/**
 * Writes the age so far before the item changes container (or the multiplier changes, e.g. the
 * power goes off). Frozen food starts thawing (`thawUntil`), unless it stays in a working
 * freezer (then the next stretch keeps it frozen anyway).
 */
export function restamp(st: ItemStore, item: ItemInstance, minute: number): void {
  if (!spoilageOf(defOf(st, item))) {
    item.ageStamp = minute;
    return;
  }
  // Frozen solid in a working freezer: a full thaw from now. Already thawing: keeps its end.
  const solid = freezesNow(st, item.loc) && isFrozen(st, item, minute);
  const thawing = item.thawUntil !== undefined && minute < item.thawUntil;
  item.ageMin = ageAt(st, item, minute);
  item.ageStamp = minute;
  if (solid) item.thawUntil = minute + freezerCfg(st).thawMin;
  else if (!thawing) delete item.thawUntil;
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
