import { unpackKey } from '../openings/state.js';
import type {
  ActionView,
  GroundPileView,
  ContainerView,
  EquipSlot,
  InventoryView,
  ItemView,
  NearbyContainerView,
  StorageMarkerView,
} from '@deadzone/protocol';
import { previewLootWeight } from './loot.js';
import { viewKind } from './search.js';
import { ACTION_KINDS, actionPart } from '../actions/queue.js';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import {
  canReach,
  carriedLoad,
  carryCapacity,
  hardLimit,
  playerItems,
  stableIdOf,
  tileInReach,
} from './inventory.js';
import { freshness } from './spoilage.js';
import { combineMarks } from '../crafting/crafting.js';
import {
  containerWeight,
  defOf,
  itemWeight,
  tileKey,
  type ItemContainer,
  type ItemStore,
} from './store.js';
import { floorZ } from '../world/levels.js';
import { accessTile, isVehicleContainer, vehicleContainerBlock } from '../vehicles/containers.js';

/** Ground piles without a capacity count as full at this many stacks. */
const PILE_FULL_STACKS = 10;
const previewCache = new WeakMap<ItemStore, Map<number, number>>();

/**
 * Fill 0..1 rounded to 0.05: contents weight / capacity (ground piles: stacks / 10). World
 * storage before its loot is generated: the weight the first search will generate.
 */
export function fillPct(st: ItemStore, c: ItemContainer): number {
  let f: number;
  if (c.capacityKg === Infinity) f = c.items.length / PILE_FULL_STACKS;
  else {
    let kg: number;
    if (c.lootDone) kg = containerWeight(st, c.id);
    else {
      let cache = previewCache.get(st);
      if (!cache) previewCache.set(st, (cache = new Map<number, number>()));
      kg = cache.get(c.id) ?? previewLootWeight(st, c);
      cache.set(c.id, kg);
      kg += containerWeight(st, c.id);
    }
    f = c.capacityKg > 0 ? kg / c.capacityKg : 0;
  }
  return Math.round(Math.min(1, f) * 20) / 20;
}

/** World storage on the player's floor within `radius` tiles (fill markers), by id. */
export function storagesView(w: SimWorld, eid: number, radius: number): StorageMarkerView[] {
  const st = w.items;
  if (!st) return [];
  const { Position } = w.c;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const sid = stableIdOf(w, eid);
  const out: StorageMarkerView[] = [];
  for (const ids of st.worldByTile.values()) {
    for (const id of ids) {
      const c = st.containers.get(id);
      if (!c || c.z !== z) continue;
      const dx = c.x + 0.5 - px;
      const dy = c.y + 0.5 - py;
      if (dx * dx + dy * dy > radius * radius) continue;
      const v: StorageMarkerView = {
        id,
        x: c.x,
        y: c.y,
        z: c.z,
        fillPct: fillPct(st, c),
        searched: c.searchedBy.includes(sid),
      };
      if (c.type >= 0) v.type = st.content.containerTypes[c.type]!.id;
      out.push(v);
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

const kg = (v: number): number => Math.round(v * 1000) / 1000;

type Marks = ReadonlyMap<number, { recipes: string[]; ready: boolean }>;

function itemView(st: ItemStore, id: number, minute: number, marks?: Marks): ItemView | undefined {
  const item = st.items.get(id);
  if (!item) return undefined;
  const def = defOf(st, item);
  const v: ItemView = { id, def: def.id, count: item.count, weightKg: kg(itemWeight(st, item)) };
  if (item.condition > 0) v.condition = item.condition;
  if (item.uses > 0 || def.kind === 'weapon_ranged' || def.kind === 'magazine') v.uses = item.uses;
  const fr = freshness(st, item, minute);
  if (fr) v.freshness = fr;
  if (item.inner) v.container = item.inner;
  if (item.placed) v.placed = true;
  if (item.vehicle !== undefined) v.vehicle = item.vehicle;
  const slots: EquipSlot[] = [];
  for (const p of st.players.values()) {
    for (const [slot, other] of p.slots) if (other === id) slots.push(slot);
    if (p.backWeapon === id) slots.push('back');
  }
  if (slots.length > 0) v.equipped = slots.sort();
  const mark = marks?.get(item.def);
  if (mark) v.combine = mark;
  return v;
}

export function containerView(w: SimWorld, id: number, marks?: Marks): ContainerView | undefined {
  const st = w.items;
  const c = st?.containers.get(id);
  if (!st || !c) return undefined;
  const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
  const v: ContainerView = {
    id,
    kind: viewKind(c),
    capacityKg: c.capacityKg === Infinity ? null : c.capacityKg,
    weightKg: kg(containerWeight(st, id)),
    items: c.items.flatMap((i) => itemView(st, i, minute, marks) ?? []),
  };
  if (c.type >= 0) v.type = st.content.containerTypes[c.type]!.id;
  if (c.kind === 'world' || c.kind === 'ground' || c.kind === 'corpse')
    Object.assign(v, { x: c.x, y: c.y, z: c.z });
  if (isVehicleContainer(c.kind)) v.vehicle = c.owner;
  return v;
}

/** Main inventory and the containers of every carried bag (depth first). */
export function carriedContainerIds(st: ItemStore, root: number, out: number[] = []): number[] {
  out.push(root);
  for (const id of st.containers.get(root)?.items ?? []) {
    const inner = st.items.get(id)?.inner;
    if (inner) carriedContainerIds(st, inner, out);
  }
  return out;
}

/** Inventory header plus every carried container (full view). */
export function inventoryView(w: SimWorld, eid: number): InventoryView | undefined {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return undefined;
  const cap = carryCapacity(w, eid);
  const load = carriedLoad(st, p);
  const equipped: Partial<Record<EquipSlot, number>> = {};
  for (const [slot, id] of [...p.slots].sort((a, b) => (a[0] < b[0] ? -1 : 1))) equipped[slot] = id;
  // The character panel has one back slot; show the weapon there when present while the
  // backpack remains equipped in the item view as well.
  if (p.backWeapon) equipped.back = p.backWeapon;
  const marks = combineMarks(w, eid);
  return {
    container: p.inventory,
    loadKg: kg(load),
    capacityKg: kg(cap),
    hardLimitKg: kg(hardLimit(w, eid)),
    carryLoad: Math.round((w.survival?.carryLoad[eid] ?? 0) * 10) / 10,
    equipped,
    containers: carriedContainerIds(st, p.inventory).flatMap(
      (id) => containerView(w, id, marks) ?? [],
    ),
  };
}

/** Non-empty ground piles on the player's floor within `radius` tiles, by id. */
export function groundPilesView(w: SimWorld, eid: number, radius: number): GroundPileView[] {
  const st = w.items;
  if (!st) return [];
  const { Position } = w.c;
  const px = Position.x[eid] ?? 0;
  const py = Position.y[eid] ?? 0;
  const z = floorZ(w, eid);
  const out: GroundPileView[] = [];
  for (const id of st.ground.values()) {
    const c = st.containers.get(id);
    if (!c || c.z !== z || c.items.length === 0) continue;
    const dx = c.x + 0.5 - px;
    const dy = c.y + 0.5 - py;
    if (dx * dx + dy * dy > radius * radius) continue;
    out.push({ id, x: c.x, y: c.y, z: c.z });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Storage and ground piles in reach (3×3 tiles around the player), by container id. */
export function nearbyView(w: SimWorld, eid: number): NearbyContainerView[] {
  const st = w.items;
  if (!st) return [];
  const { Position } = w.c;
  const px = Math.floor(Position.x[eid] ?? 0);
  const py = Math.floor(Position.y[eid] ?? 0);
  const z = floorZ(w, eid);
  const sid = stableIdOf(w, eid);
  const out: NearbyContainerView[] = [];
  for (let y = py - 2; y <= py + 2; y++) {
    for (let x = px - 2; x <= px + 2; x++) {
      if (!tileInReach(w, eid, x, y, z)) continue;
      const key = tileKey(x, y, z);
      const ids = [...(st.worldByTile.get(key) ?? [])];
      const pile = st.ground.get(key);
      if (pile !== undefined) ids.push(pile);
      for (const id of ids) {
        const c = st.containers.get(id);
        if (!c) continue;
        const v: NearbyContainerView = {
          id,
          kind: viewKind(c),
          x,
          y,
          z,
          searched: c.kind !== 'world' || c.searchedBy.includes(sid),
          fillPct: fillPct(st, c),
        };
        if (c.type >= 0) v.type = st.content.containerTypes[c.type]!.id;
        out.push(v);
      }
    }
  }
  // Zombie corpses in reach (searched like storage; contents only after the search).
  for (const [zsid, id] of st.corpses) {
    const c = st.containers.get(id);
    if (!c || !tileInReach(w, eid, c.x, c.y, c.z)) continue;
    out.push({
      id,
      kind: 'corpse',
      x: c.x,
      y: c.y,
      z: c.z,
      searched: c.searchedBy.includes(sid),
      fillPct: c.lootDone ? fillPct(st, c) : 0,
      corpse: zsid,
    });
  }
  // Trunks behind unlocked cars and the glovebox of the car the player sits in.
  const ex = Position.x[eid] ?? 0;
  const ey = Position.y[eid] ?? 0;
  for (const v of w.physics.vehicles.values()) {
    // Cheap distance cut first (a trunk is at most ~3.5 m from the car's centre).
    if (v.containers.length === 0 || (v.x - ex) ** 2 + (v.y - ey) ** 2 > 64) continue;
    for (const id of v.containers) {
      const c = st.containers.get(id);
      if (!c || vehicleContainerBlock(w, eid, c)) continue;
      const at = accessTile(w, c)!;
      out.push({
        id,
        kind: viewKind(c),
        ...at,
        searched: c.searchedBy.includes(sid),
        fillPct: c.lootDone ? fillPct(st, c) : 0,
        vehicle: v.id,
        ...(c.type >= 0 ? { type: st.content.containerTypes[c.type]!.id } : {}),
      });
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

export function openContainerView(w: SimWorld, eid: number): ContainerView | null {
  const p = playerItems(w, eid);
  if (!p?.open || !canReach(w, eid, p.open)) return null;
  return containerView(w, p.open) ?? null;
}

export function actionView(w: SimWorld, eid: number): ActionView | null {
  const p = playerItems(w, eid);
  const a = p?.current;
  if (!p || !a) return null;
  const span = a.endTick - a.startTick;
  const progress = span > 0 ? Math.min(1, Math.max(0, (w.tick - a.startTick) / span)) : 1;
  const v: ActionView = {
    kind: ACTION_KINDS[a.kind] ?? 'search',
    startTick: a.startTick,
    endTick: a.endTick,
    queued: p.queue.length,
    progress: Math.round(progress * 20) / 20,
  };
  if (a.spot) v.spot = { ...a.spot };
  if (a.edge !== undefined) v.edge = unpackKey(a.edge);
  if (a.vehicle !== undefined)
    v.vehicle = { vehicleId: a.vehicle, ...(a.seat !== undefined ? { seat: a.seat } : {}) };
  if (a.item) v.item = a.item;
  if (a.container) v.container = a.container;
  if (a.recipe) v.recipe = w.items!.content.recipes[a.recipe - 1]?.id ?? '';
  const part = actionPart(a);
  if (part) v.part = part;
  return v;
}
