import type { Command, CommandRejectReason } from '@deadzone/protocol';
import { gameMinuteAt } from '../core/clock.js';
import type { SimWorld } from '../core/world.js';
import { interruptActions, newAction, startAction } from '../actions/queue.js';
import { bodyPartIndex } from '../survival/state.js';
import { addPieces, carriedItems } from './actions.js';
import {
  allowedSlots,
  canReach,
  carriedLoad,
  checkFits,
  equip,
  hardLimit,
  moveItem,
  playerItems,
  stableIdOf,
  tileInReach,
} from './inventory.js';
import {
  containerWeight,
  defOf,
  groundPile,
  isInside,
  placeableType,
  type ItemInstance,
  type PlayerItems,
} from './store.js';

export type ItemCommand = Extract<
  Command,
  {
    type:
      | 'pickUp'
      | 'drop'
      | 'moveItem'
      | 'takeItem'
      | 'takeAll'
      | 'putItem'
      | 'equip'
      | 'unequip'
      | 'openContainer'
      | 'closeContainer'
      | 'useItem'
      | 'cancelAction'
      | 'placeStorage'
      | 'pickUpStorage'
      | 'bandage'
      | 'debugGiveItem';
  }
>;

const ITEM_COMMANDS = new Set<string>([
  'pickUp',
  'drop',
  'moveItem',
  'takeItem',
  'takeAll',
  'putItem',
  'equip',
  'unequip',
  'openContainer',
  'closeContainer',
  'useItem',
  'cancelAction',
  'placeStorage',
  'pickUpStorage',
  'bandage',
  'debugGiveItem',
]);
export const isItemCommand = (cmd: Command): cmd is ItemCommand => ITEM_COMMANDS.has(cmd.type);

/** Gameplay validation + effect of inventory, container and action commands. */
export function applyItemCommand(
  w: SimWorld,
  eid: number,
  cmd: ItemCommand,
): CommandRejectReason | undefined {
  if (cmd.type === 'debugGiveItem' && !w.dev) return 'dev-only';
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return 'invalid-state';
  if (w.survival?.asleep[eid] && cmd.type !== 'cancelAction') return 'invalid-state';
  const reachable = (id: number): ItemInstance | CommandRejectReason => {
    const item = st.items.get(id);
    if (!item) return 'no-item';
    return canReach(w, eid, item.loc) ? item : 'out-of-range';
  };
  const move = (item: ItemInstance, to: number, count: number | undefined) => {
    const target = st.containers.get(to);
    if (!target) return 'no-item';
    if (!canReach(w, eid, to)) return 'out-of-range';
    const n = Math.min(count ?? item.count, item.count);
    if (n < item.count && item.inner) return 'invalid-target';
    const reason = checkFits(w, eid, item, n, target);
    if (reason) return reason;
    moveItem(w, item, target, n);
    return undefined;
  };

  switch (cmd.type) {
    case 'pickUp': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      return move(item, p.inventory, cmd.count);
    }
    case 'drop': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      const { x, y, z } = playerTile(w, eid);
      return move(item, groundPile(st, x, y, z).id, cmd.count);
    }
    case 'moveItem': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      return move(item, cmd.to, cmd.count);
    }
    case 'takeItem': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      if (item.loc !== cmd.container) return 'invalid-target';
      return move(item, p.inventory, cmd.count);
    }
    case 'takeAll': {
      const c = st.containers.get(cmd.container);
      if (!c || (c.kind === 'world' && !c.searchedBy.includes(stableIdOf(w, eid))))
        return 'no-item';
      if (!canReach(w, eid, c.id)) return 'out-of-range';
      if (c.id === p.inventory || isInside(st, c.id, p.inventory)) return 'invalid-target';
      if (c.items.length === 0) return 'no-item';
      const inv = st.containers.get(p.inventory)!;
      let taken = 0;
      for (const id of [...c.items]) {
        const item = st.items.get(id);
        if (!item || checkFits(w, eid, item, item.count, inv)) continue;
        moveItem(w, item, inv, item.count);
        taken++;
      }
      return taken > 0 ? undefined : 'no-space';
    }
    case 'putItem': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      if (!isInside(st, item.loc, p.inventory)) return 'invalid-target';
      return move(item, cmd.container, cmd.count);
    }
    case 'equip': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      if (!allowedSlots(st, item).includes(cmd.slot)) return 'invalid-target';
      if (item.loc !== p.inventory) {
        const reason = move(item, p.inventory, item.count);
        if (reason) return reason;
      }
      equip(st, p, item, cmd.slot);
      return undefined;
    }
    case 'unequip': {
      if (cmd.slot === 'back' && p.backWeapon) {
        p.backWeapon = 0;
        st.version++;
        return undefined;
      }
      const id = p.slots.get(cmd.slot);
      if (id === undefined) return 'invalid-target';
      for (const [slot, other] of [...p.slots]) if (other === id) p.slots.delete(slot);
      st.version++;
      return undefined;
    }
    case 'openContainer':
      return openContainer(w, eid, p, cmd.container);
    case 'closeContainer':
      if (!p.open) return 'invalid-state';
      p.open = 0;
      st.version++;
      return undefined;
    case 'useItem': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      const kind = defOf(st, item).kind;
      if (kind === 'food') return startAction(w, eid, newAction('eat', { item: item.id }));
      if (kind === 'drink') return startAction(w, eid, newAction('drink', { item: item.id }));
      if (kind === 'ammo_box') return startAction(w, eid, newAction('unpack', { item: item.id }));
      if (kind === 'literature') return startAction(w, eid, newAction('read', { item: item.id }));
      if (kind === 'medical') {
        if (!cmd.part) return 'invalid-target';
        const part = bodyPartIndex(cmd.part);
        return startAction(w, eid, newAction('bandage', { item: item.id, part }));
      }
      return 'no-item';
    }
    case 'bandage': {
      const bandages = w.survival?.content.bandageItems;
      if (!bandages) return 'invalid-state';
      if (cmd.itemId !== undefined && !bandages.has(cmd.itemId)) return 'unknown-item';
      const item = carriedItems(st, p.inventory).find((i) => {
        const id = defOf(st, i).id;
        return bandages.has(id) && (cmd.itemId === undefined || id === cmd.itemId);
      });
      if (!item) return 'no-item';
      const part = bodyPartIndex(cmd.part);
      return startAction(w, eid, newAction('bandage', { item: item.id, part }));
    }
    case 'cancelAction':
      if (!p.current) return 'invalid-state';
      interruptActions(w, eid, 'cancelled');
      return undefined;
    case 'placeStorage': {
      const item = reachable(cmd.item);
      if (typeof item === 'string') return item;
      if (placeableType(st, defOf(st, item)) < 0) return 'invalid-target';
      const z = playerTile(w, eid).z;
      if (!tileInReach(w, eid, cmd.x, cmd.y, z)) return 'out-of-range';
      const pile = groundPile(st, cmd.x, cmd.y, z);
      if (item.loc !== pile.id) moveItem(w, item, pile, 1);
      item.placed = true;
      st.version++;
      return undefined;
    }
    case 'pickUpStorage':
      return pickUpStorage(w, eid, p, cmd.container);
    case 'debugGiveItem': {
      const def = st.content.itemIndex.get(cmd.itemId);
      if (def === undefined) return 'unknown-item';
      addPieces(st, def, p.inventory, cmd.count ?? 1, gameMinuteAt(w.clock, w.tick));
      return undefined;
    }
  }
}

export function playerTile(w: SimWorld, eid: number): { x: number; y: number; z: number } {
  const { Position } = w.c;
  return {
    x: Math.floor(Position.x[eid] ?? 0),
    y: Math.floor(Position.y[eid] ?? 0),
    z: Position.z[eid] ?? 0,
  };
}

/**
 * Opens a container for the loot panel: bags, ground piles and storage already searched by this
 * player open at once; world storage otherwise starts the timed `search`.
 */
function openContainer(
  w: SimWorld,
  eid: number,
  p: PlayerItems,
  id: number,
): CommandRejectReason | undefined {
  const st = w.items!;
  const c = st.containers.get(id);
  if (!c) return 'no-item';
  if (c.kind === 'world' && !c.searchedBy.includes(stableIdOf(w, eid))) {
    return startAction(w, eid, newAction('search', { container: id }));
  }
  if (!canReach(w, eid, id)) return 'out-of-range';
  p.open = id;
  st.version++;
  w.events.push({
    type: 'containerOpened',
    tick: w.tick,
    playerId: w.c.Player.id[eid] ?? 0,
    container: id,
    firstSearch: false,
  });
  return undefined;
}

/**
 * A map storage whose type has `pickupItem` (e.g. `base:wooden-crate`) becomes that item in the
 * main inventory; its contents move into the item's own container. Only after a search (like
 * taking items), so the loot is generated and nothing is lost.
 */
function pickUpStorage(
  w: SimWorld,
  eid: number,
  p: PlayerItems,
  id: number,
): CommandRejectReason | undefined {
  const st = w.items!;
  const c = st.containers.get(id);
  if (!c || c.kind !== 'world') return 'no-item';
  const pickup = st.content.containerTypes[c.type]?.pickupItem;
  const def = pickup === undefined ? undefined : st.content.itemIndex.get(pickup);
  if (def === undefined) return 'invalid-target';
  if (!canReach(w, eid, id)) return 'out-of-range';
  const weight = st.content.items[def]!.weightKg + containerWeight(st, c.id);
  if (carriedLoad(st, p) + weight > hardLimit(w, eid) + 1e-6) return 'no-space';
  const minute = gameMinuteAt(w.clock, w.tick);
  addPieces(st, def, p.inventory, 1, minute);
  const inv = st.containers.get(p.inventory)!;
  const item = st.items.get(inv.items[inv.items.length - 1]!)!;
  const inner = item.inner ? st.containers.get(item.inner) : undefined;
  for (const childId of [...c.items]) {
    const child = st.items.get(childId);
    if (child && inner) moveItem(w, child, inner, child.count);
  }
  st.containers.delete(c.id);
  const key = `${c.x},${c.y},${c.z}`;
  const onTile = st.worldByTile.get(key);
  const at = onTile?.indexOf(c.id) ?? -1;
  if (onTile && at >= 0) onTile.splice(at, 1);
  if (p.open === c.id) p.open = 0;
  st.version++;
  return undefined;
}
