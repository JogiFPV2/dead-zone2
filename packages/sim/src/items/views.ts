import type {
  ActionView,
  ContainerView,
  EquipSlot,
  InventoryView,
  ItemView,
  NearbyContainerView,
} from '@deadzone/protocol';
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
import { containerWeight, defOf, itemWeight, tileKey, type ItemStore } from './store.js';

const kg = (v: number): number => Math.round(v * 1000) / 1000;

function itemView(st: ItemStore, id: number, minute: number): ItemView | undefined {
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
  const slots: EquipSlot[] = [];
  for (const p of st.players.values()) {
    for (const [slot, other] of p.slots) if (other === id) slots.push(slot);
  }
  if (slots.length > 0) v.equipped = slots.sort();
  return v;
}

export function containerView(w: SimWorld, id: number): ContainerView | undefined {
  const st = w.items;
  const c = st?.containers.get(id);
  if (!st || !c) return undefined;
  const minute = gameMinuteAt(w.clock, Math.max(0, w.tick - 1));
  const v: ContainerView = {
    id,
    kind: c.kind,
    capacityKg: c.capacityKg === Infinity ? null : c.capacityKg,
    weightKg: kg(containerWeight(st, id)),
    items: c.items.flatMap((i) => itemView(st, i, minute) ?? []),
  };
  if (c.type >= 0) v.type = st.content.containerTypes[c.type]!.id;
  if (c.kind === 'world' || c.kind === 'ground') Object.assign(v, { x: c.x, y: c.y, z: c.z });
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
  return {
    container: p.inventory,
    loadKg: kg(load),
    capacityKg: kg(cap),
    hardLimitKg: kg(hardLimit(w, eid)),
    carryLoad: Math.round((w.survival?.carryLoad[eid] ?? 0) * 10) / 10,
    equipped,
    containers: carriedContainerIds(st, p.inventory).flatMap((id) => containerView(w, id) ?? []),
  };
}

/** Storage and ground piles in reach (3×3 tiles around the player), by container id. */
export function nearbyView(w: SimWorld, eid: number): NearbyContainerView[] {
  const st = w.items;
  if (!st) return [];
  const { Position } = w.c;
  const px = Math.floor(Position.x[eid] ?? 0);
  const py = Math.floor(Position.y[eid] ?? 0);
  const z = Position.z[eid] ?? 0;
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
          kind: c.kind,
          x,
          y,
          z,
          searched: c.kind !== 'world' || c.searchedBy.includes(sid),
        };
        if (c.type >= 0) v.type = st.content.containerTypes[c.type]!.id;
        out.push(v);
      }
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
  const v: ActionView = {
    kind: ACTION_KINDS[a.kind] ?? 'search',
    startTick: a.startTick,
    endTick: a.endTick,
    queued: p.queue.length,
  };
  if (a.item) v.item = a.item;
  if (a.container) v.container = a.container;
  const part = actionPart(a);
  if (part) v.part = part;
  return v;
}
