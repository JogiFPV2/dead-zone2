import { meleeStatsFor } from '@deadzone/content';
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
import { isVehicleContainer, vehicleContainerBlock } from '../vehicles/containers.js';
import { anchorRect, rectInReach } from '../furniture/footprint.js';
import { gridOf } from '../ai/commands.js';
import { reachLine } from '../world/los.js';
import type { TileRect } from '../world/furniture.js';

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

/** Why a reach target fails: too far / other floor (`out-of-range`) or behind a wall (`wall`). */
export type ReachBlock = 'out-of-range' | 'wall';

/**
 * Nothing blocks the line from the player to the nearest point of tile rectangle `r` (docs 9.69):
 * `reachLine`: walls, closed windows, closed doors, fences, barricades, corners, exact walls
 * `wallSegments` block; open / broken windows and open doors let through. Same tile always passes.
 */
export function lineToRect(w: SimWorld, eid: number, r: TileRect, z: number): boolean {
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  const m = 0.01;
  const tx = Math.min(Math.max(px, r.x + m), r.x + r.w - m);
  const ty = Math.min(Math.max(py, r.y + m), r.y + r.h - m);
  if (Math.floor(tx) === Math.floor(px) && Math.floor(ty) === Math.floor(py)) return true;
  return reachLine(gridOf(w), z, px, py, tx, ty);
}

/** Tile (x, y, z) reachable: in range and not behind a wall. */
export function tileReachBlock(
  w: SimWorld,
  eid: number,
  x: number,
  y: number,
  z: number,
): ReachBlock | undefined {
  if (!tileInReach(w, eid, x, y, z)) return 'out-of-range';
  return lineToRect(w, eid, { x, y, w: 1, h: 1 }, z) ? undefined : 'wall';
}

/**
 * The player may look into / take from container `id`: own inventory (and bags in it), or world
 * storage / ground pile / corpse in reach (and bags or placed storage lying there). World storage
 * and corpses must be searched by this player first; hidden caches are never reachable.
 */
export function canReach(w: SimWorld, eid: number, id: number): boolean {
  return reachBlock(w, eid, id) === undefined;
}

/** `canReach` with the reason (`out-of-range` also for "not searched yet" / hidden). */
export function reachBlock(w: SimWorld, eid: number, id: number): ReachBlock | undefined {
  const st = w.items;
  if (!st) return 'out-of-range';
  const root = rootContainer(st, id);
  if (!root) return 'out-of-range';
  if (root.kind === 'inventory')
    return root.owner === stableIdOf(w, eid) ? undefined : 'out-of-range';
  // Hidden caches are found by a spot search only (they become ground piles then).
  if (root.kind === 'hidden') return 'out-of-range';
  const b = containerReachBlock(w, eid, root);
  if (b) return b;
  const searchable =
    root.kind === 'world' || root.kind === 'corpse' || isVehicleContainer(root.kind);
  return !searchable || root.searchedBy.includes(stableIdOf(w, eid)) ? undefined : 'out-of-range';
}

/**
 * A placed container (world storage, ground pile, corpse) is within reach of its tile; a vehicle
 * trunk from behind the unlocked car, a glovebox from a front seat (`vehicles/containers.ts`).
 */
export function containerInReach(w: SimWorld, eid: number, c: ItemContainer): boolean {
  return containerReachBlock(w, eid, c) === undefined;
}

/** `containerInReach` with the reason; placed containers also need a clear line (docs 9.69). */
export function containerReachBlock(
  w: SimWorld,
  eid: number,
  c: ItemContainer,
): ReachBlock | undefined {
  if (isVehicleContainer(c.kind))
    return vehicleContainerBlock(w, eid, c) === undefined ? undefined : 'out-of-range';
  // Furniture footprint: world storage from any tile next to the piece (docs 9.49).
  const r =
    c.kind === 'world' && w.furniture
      ? anchorRect(w, c.x, c.y, c.z)
      : { x: c.x, y: c.y, w: 1, h: 1 };
  const inRange =
    c.kind === 'world' && w.furniture
      ? rectInReach(w, eid, r, c.z)
      : tileInReach(w, eid, c.x, c.y, c.z);
  if (!inRange) return 'out-of-range';
  return lineToRect(w, eid, r, c.z) ? undefined : 'wall';
}

/**
 * For the client (hide the loot hint): container `container` or tile `{x, y, z}` reachable by
 * player entity `eid` — `undefined` when yes, else `out-of-range` / `wall`. Read-only.
 */
export function reachTarget(
  w: SimWorld,
  eid: number,
  target: { container: number } | { x: number; y: number; z: number },
): ReachBlock | undefined {
  if ('container' in target) {
    const c = w.items?.containers.get(target.container);
    if (!c || c.kind === 'hidden') return 'out-of-range';
    if (c.kind === 'inventory') return reachBlock(w, eid, c.id);
    return containerReachBlock(w, eid, rootContainer(w.items!, c.id) ?? c);
  }
  return tileReachBlock(w, eid, target.x, target.y, target.z);
}

/** `reachTarget(...) === undefined`. */
export const canReachTarget = (
  w: SimWorld,
  eid: number,
  target: { container: number } | { x: number; y: number; z: number },
): boolean => reachTarget(w, eid, target) === undefined;

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
  (a.burnt ?? false) === (b.burnt ?? false) &&
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

/** Hand that attacks / shoots (`setActiveHand`, default right). */
export function activeHandOf(p: PlayerItems): 'hand_primary' | 'hand_secondary' {
  return p.activeHand ?? 'hand_primary';
}

/** Long guns and two-handed melee weapons may be carried on the back alongside a bag. */
export function backWeapon(st: ItemStore, item: ItemInstance): boolean {
  const def = defOf(st, item);
  if (def.kind === 'weapon_melee') return def.melee.twoHanded;
  return (
    def.kind === 'weapon_ranged' &&
    (def.ranged.category === 'shotgun' || def.ranged.category === 'rifle')
  );
}

/**
 * Slots an item may go to: bags their `bag.slots`, clothing its slot, long weapons the back, and
 * any item the hands (quick slots 1 and 2: anything can be held, harmless items only push).
 */
export function allowedSlots(st: ItemStore, item: ItemInstance): readonly EquipSlot[] {
  const def = defOf(st, item);
  const own =
    def.kind === 'container' ? def.bag.slots : def.kind === 'clothing' ? [def.clothing.slot] : [];
  if (own.length > 0) return [...new Set([...own, ...HANDS])];
  return backWeapon(st, item) ? [...HANDS, 'back'] : HANDS;
}

/** Held with both hands: weapons by their data, any other item by `meleeStatsFor` (heavy ones). */
export function twoHanded(st: ItemStore, item: ItemInstance): boolean {
  const def = defOf(st, item);
  if (def.kind === 'weapon_melee') return def.melee.twoHanded;
  if (def.kind === 'weapon_ranged') return def.ranged.twoHanded;
  if (def.kind === 'container' || def.kind === 'clothing') return false;
  return meleeStatsFor(def).twoHanded;
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
