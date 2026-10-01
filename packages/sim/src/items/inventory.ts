import type { CommandRejectReason, EquipSlot } from '@deadzone/protocol';
import { ModSlot } from '../content/adapter.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { modded } from '../survival/state.js';
import { restamp, spoilageOf } from './spoilage.js';
import {
  containerWeight,
  defOf,
  dropEmptyPile,
  isInside,
  itemWeight,
  removeFrom,
  rootContainer,
  stackLimit,
  unequipEverywhere,
  type ItemContainer,
  type ItemInstance,
  type ItemStore,
  type PlayerItems,
} from './store.js';
import { floorZ } from '../world/levels.js';

/** Reach for containers and items (docs 2.4: ≤ 1.5 tiles, same floor). */
export const INTERACT_RANGE_TILES = 1.5;
const EPS = 1e-6;

export const stableIdOf = (w: SimWorld, eid: number): number => w.c.StableId.value[eid] ?? 0;

export function playerItems(w: SimWorld, eid: number): PlayerItems | undefined {
  return w.items?.players.get(stableIdOf(w, eid));
}

/** Tile (x, y, z) within reach of the player (distance to the tile centre). */
export function tileInReach(w: SimWorld, eid: number, x: number, y: number, z: number): boolean {
  const { Position } = w.c;
  if (floorZ(w, eid) !== z) return false;
  const dx = x + 0.5 - (Position.x[eid] ?? 0);
  const dy = y + 0.5 - (Position.y[eid] ?? 0);
  return dx * dx + dy * dy <= INTERACT_RANGE_TILES * INTERACT_RANGE_TILES;
}

/**
 * The player may look into / take from container `id`: own inventory (and bags in it), or world
 * storage / ground pile in reach (and bags or placed storage lying there). World storage must be
 * searched by this player first.
 */
export function canReach(w: SimWorld, eid: number, id: number): boolean {
  const st = w.items;
  if (!st) return false;
  const root = rootContainer(st, id);
  if (!root) return false;
  if (root.kind === 'inventory') return root.owner === stableIdOf(w, eid);
  if (!tileInReach(w, eid, root.x, root.y, root.z)) return false;
  return root.kind !== 'world' || root.searchedBy.includes(stableIdOf(w, eid));
}

/** Carry capacity in kg (`worldSettings.carry.baseCapacityKg` × / + `carry-capacity-kg` mods). */
export function carryCapacity(w: SimWorld, eid: number): number {
  const st = w.items!;
  const base = st.content.carry.baseCapacityKg;
  const s = w.survival;
  return Math.max(0, s ? modded(s, eid, ModSlot['carry-capacity-kg'], base) : base);
}

export const hardLimit = (w: SimWorld, eid: number): number =>
  carryCapacity(w, eid) * w.items!.content.carry.hardLimitMultiplier;

/** Bag worn in one of its own slots (only then `weightReductionPct` applies). */
export function wornBag(st: ItemStore, p: PlayerItems, item: ItemInstance): boolean {
  const def = defOf(st, item);
  if (def.kind !== 'container') return false;
  for (const [slot, id] of p.slots) if (id === item.id && def.bag.slots.includes(slot)) return true;
  return false;
}

/** Carried weight: main inventory with bag reduction on worn bags' contents. */
export function carriedLoad(st: ItemStore, p: PlayerItems): number {
  const inv = st.containers.get(p.inventory);
  let sum = 0;
  for (const id of inv?.items ?? []) {
    const item = st.items.get(id);
    if (!item) continue;
    sum += defOf(st, item).weightKg * item.count;
    if (item.inner) {
      const def = defOf(st, item);
      const red = def.kind === 'container' && wornBag(st, p, item) ? def.bag.weightReductionPct : 0;
      sum += containerWeight(st, item.inner) * (1 - red / 100);
    }
  }
  return sum;
}

/** Speed factor of worn / held bags: Π (1 − `bag.movementPenalty` × fill). */
export function bagSpeedFactor(st: ItemStore, p: PlayerItems): number {
  let f = 1;
  const seen = new Set<number>();
  for (const id of p.slots.values()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = st.items.get(id);
    if (!item?.inner) continue;
    const def = defOf(st, item);
    if (def.kind !== 'container' || def.bag.movementPenalty <= 0) continue;
    const fill = Math.min(1, containerWeight(st, item.inner) / def.bag.capacityKg);
    f *= 1 - def.bag.movementPenalty * fill;
  }
  return f;
}

/** Whether `item` (n pieces) may go into `target`; returns a reject reason. */
export function checkFits(
  w: SimWorld,
  eid: number,
  item: ItemInstance,
  n: number,
  target: ItemContainer,
): CommandRejectReason | undefined {
  const st = w.items!;
  if (item.inner && isInside(st, target.id, item.inner)) return 'invalid-target';
  if (item.loc === target.id && n === item.count) return 'invalid-target';
  const def = defOf(st, item);
  if (target.acceptsTags && !target.acceptsTags.some((t) => def.tags.includes(t)))
    return 'no-space';
  const moved = n === item.count ? itemWeight(st, item) : def.weightKg * n;
  if (target.capacityKg !== Infinity) {
    if (containerWeight(st, target.id) + moved > target.capacityKg + EPS) return 'no-space';
  }
  const p = playerItems(w, eid);
  if (p && isInside(st, target.id, p.inventory) && !isInside(st, item.loc, p.inventory)) {
    if (carriedLoad(st, p) + moved > hardLimit(w, eid) + EPS) return 'no-space';
  }
  return undefined;
}

const sameState = (st: ItemStore, a: ItemInstance, b: ItemInstance): boolean =>
  a.def === b.def &&
  a.condition === b.condition &&
  a.uses === b.uses &&
  !a.inner &&
  !b.inner &&
  (!spoilageOf(defOf(st, a)) || (a.ageMin === b.ageMin && a.ageStamp === b.ageStamp));

/**
 * Moves `n` of `item` into `target` (no checks: see `checkFits`). Re-stamps spoilage, merges into
 * matching stacks up to `maxStack`, splits the source stack, unequips an item that leaves the
 * inventory. Returns the instance now holding the moved pieces (the last one touched).
 */
export function moveItem(
  w: SimWorld,
  item: ItemInstance,
  target: ItemContainer,
  n: number,
): ItemInstance {
  const st = w.items!;
  const minute = gameMinuteAt(w.clock, w.tick);
  restamp(st, item, minute);
  const source = st.containers.get(item.loc);
  const def = defOf(st, item);
  const take = Math.min(n, item.count);
  let left = take;
  let last: ItemInstance | undefined;
  const max = stackLimit(st, def);
  if (max > 1) {
    for (const id of target.items) {
      const other = st.items.get(id);
      if (!other || other === item || other.count >= max || !sameState(st, other, item)) continue;
      restamp(st, other, minute);
      const k = Math.min(left, max - other.count);
      other.count += k;
      left -= k;
      last = other;
      if (left === 0) break;
    }
  }
  if (take === item.count) {
    // The whole instance moves (or has been merged away completely).
    if (source) removeFrom(source, item.id);
    unequipEverywhere(st, item.id);
    if (left === 0) {
      st.items.delete(item.id);
    } else {
      item.count = left;
      item.loc = target.id;
      item.placed = false;
      target.items.push(item.id);
      last = item;
    }
  } else {
    item.count -= take;
    if (left > 0) {
      const clone: ItemInstance = { ...item, id: st.nextItemId++, count: left, loc: target.id };
      clone.placed = false;
      st.items.set(clone.id, clone);
      target.items.push(clone.id);
      last = clone;
    }
  }
  if (source) dropEmptyPile(st, source);
  st.version++;
  return last ?? item;
}

const HANDS: readonly EquipSlot[] = ['hand_primary', 'hand_secondary'];

/** Long guns and two-handed melee weapons may be carried on the back alongside a bag. */
export function backWeapon(st: ItemStore, item: ItemInstance): boolean {
  const def = defOf(st, item);
  if (def.kind === 'weapon_melee') return def.melee.twoHanded;
  return (
    def.kind === 'weapon_ranged' &&
    (def.ranged.category === 'shotgun' || def.ranged.category === 'rifle')
  );
}

/** Slots an item may go to: bags their `bag.slots`, clothing its slot, weapons the hands/back. */
export function allowedSlots(st: ItemStore, item: ItemInstance): readonly EquipSlot[] {
  const def = defOf(st, item);
  if (def.kind === 'container') return def.bag.slots;
  if (def.kind === 'clothing') return [def.clothing.slot];
  return backWeapon(st, item) ? [...HANDS, 'back'] : HANDS;
}

export function twoHanded(st: ItemStore, item: ItemInstance): boolean {
  const def = defOf(st, item);
  if (def.kind === 'weapon_melee') return def.melee.twoHanded;
  if (def.kind === 'weapon_ranged') return def.ranged.twoHanded;
  return false;
}

/** Puts an item that lies in the main inventory into `slot` (displacing what was there). */
export function equip(st: ItemStore, p: PlayerItems, item: ItemInstance, slot: EquipSlot): void {
  unequipEverywhere(st, item.id);
  if (slot === 'back' && backWeapon(st, item)) {
    p.backWeapon = item.id;
    st.version++;
    return;
  }
  const slots = twoHanded(st, item) && HANDS.includes(slot) ? HANDS : [slot];
  for (const s of slots) {
    const prev = p.slots.get(s);
    if (prev !== undefined) for (const [k, id] of [...p.slots]) if (id === prev) p.slots.delete(k);
  }
  for (const s of slots) p.slots.set(s, item.id);
  st.version++;
}
