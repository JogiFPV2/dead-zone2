import type { CommandRejectReason } from '@deadzone/protocol';
import { emitNoise } from '../ai/noise.js';
import { gameMinuteAt } from '../core/clock.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import type { SimWorld } from '../core/world.js';
import { carriedItems } from '../items/actions.js';
import { playerItems } from '../items/inventory.js';
import { createItem, type ItemInstance } from '../items/store.js';
import { floorZ } from '../world/levels.js';
import { doorPoint, playerEidOf, seatOf, vehicleTypes } from './seats.js';
import { vehicleSettings } from './settings.js';
import type { Vehicle } from './types.js';

/**
 * Locks and keys (docs/sim-architecture.md „Pojazdy — rozgrywka”). A key is an item
 * (`worldSettings.vehicles.keyItem`) with `vehicle` = the StableId of the only car it fits; the
 * key in the ignition is virtual (`Vehicle.keyIn`) until the driver takes it out. The engine
 * runs with the key in the ignition, with the key carried by the driver, or hotwired.
 */

/** Carried key of vehicle `v` (inventory and bags), or undefined. */
export function carriedKey(w: SimWorld, eid: number, v: Vehicle): ItemInstance | undefined {
  const st = w.items;
  const p = playerItems(w, eid);
  if (!st || !p) return undefined;
  return carriedItems(st, p.inventory).find((i) => i.vehicle === v.id);
}

/** Creates a key of `v` in container `loc` (undefined when the content has no key item). */
export function createKey(w: SimWorld, v: Vehicle, loc: number): ItemInstance | undefined {
  const st = w.items;
  const def = st?.content.itemIndex.get(vehicleSettings(w).keyItem);
  if (!st || def === undefined || !st.containers.has(loc)) return undefined;
  const item = createItem(st, def, loc, 1, gameMinuteAt(w.clock, w.tick));
  item.vehicle = v.id;
  return item;
}

/** Why the engine of `v` cannot start now (undefined = it can). */
export function startBlock(w: SimWorld, v: Vehicle): CommandRejectReason | undefined {
  if (v.engine <= 0) return 'invalid-state';
  if (v.fuel <= 0) return 'no-fuel';
  if ((v.battery ?? 100) <= 0) return 'no-power';
  if (v.keyIn || v.hotwired) return undefined;
  const sid = v.occupants[0] ?? 0;
  const eid = sid ? playerEidOf(w, sid) : undefined;
  return eid !== undefined && carriedKey(w, eid, v) ? undefined : 'no-key';
}

/** Starts the engine when it is off and may start (`engineStart`); true when it runs now. */
export function tryStartEngine(w: SimWorld, v: Vehicle): boolean {
  if (v.engineOn) return true;
  if ((v.occupants[0] ?? 0) === 0 || startBlock(w, v)) return false;
  v.engineOn = true;
  w.events.push({ type: 'engineStart', tick: w.tick, vehicleId: v.id });
  return true;
}

export function stopEngine(w: SimWorld, v: Vehicle, reason: 'key' | 'driver'): void {
  if (!v.engineOn) return;
  v.engineOn = false;
  v.throttle = 0;
  w.events.push({ type: 'engineStop', tick: w.tick, vehicleId: v.id, reason });
}

export function setLocked(
  w: SimWorld,
  eid: number,
  v: Vehicle,
  locked: boolean,
  by: 'inside' | 'key' | 'window',
): void {
  v.locked = locked;
  w.events.push({
    type: 'vehicleLocked',
    tick: w.tick,
    vehicleId: v.id,
    playerId: w.c.Player.id[eid] ?? 0,
    locked,
    by,
  });
}

/** The player stands within `enterRange` of one of the car's doors (same level). */
export function atAnyDoor(w: SimWorld, eid: number, v: Vehicle): boolean {
  const t = vehicleTypes(w)[v.type];
  if (!t || floorZ(w, eid) !== Math.floor(v.z)) return false;
  const cfg = w.physics.cfg.vehicle;
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  return t.seats.some((_, s) => {
    const d = doorPoint(v, t, s, cfg);
    return (px - d.x) ** 2 + (py - d.y) ** 2 <= cfg.enterRange * cfg.enterRange;
  });
}

/** `lockVehicle`: from a seat always, from outside with the key at a door. */
export function applyLock(
  w: SimWorld,
  eid: number,
  vehicleId: number,
  locked: boolean,
): CommandRejectReason | undefined {
  const v = w.physics.vehicles.get(vehicleId);
  if (!v) return 'invalid-target';
  if (v.locked === locked) return 'invalid-state';
  const at = seatOf(w, w.c.StableId.value[eid] ?? 0);
  if (at?.v === v) {
    setLocked(w, eid, v, locked, 'inside');
    return undefined;
  }
  if (at || !atAnyDoor(w, eid, v)) return 'out-of-range';
  if (!carriedKey(w, eid, v)) return 'no-key';
  setLocked(w, eid, v, locked, 'key');
  return undefined;
}

/** The player's driver seat (vehicle), or undefined. */
export function drivenBy(w: SimWorld, eid: number): Vehicle | undefined {
  const at = seatOf(w, w.c.StableId.value[eid] ?? 0);
  return at && at.seat === 0 ? at.v : undefined;
}

/** `takeVehicleKey`: the key from the ignition into the inventory. */
export function applyTakeKey(w: SimWorld, eid: number): CommandRejectReason | undefined {
  const v = drivenBy(w, eid);
  const p = playerItems(w, eid);
  if (!v || !p || !v.keyIn) return 'invalid-state';
  const key = createKey(w, v, p.inventory);
  if (!key) return 'invalid-state';
  v.keyIn = false;
  w.items!.version++;
  w.events.push({
    type: 'vehicleKeyTaken',
    tick: w.tick,
    vehicleId: v.id,
    playerId: w.c.Player.id[eid] ?? 0,
    itemId: key.id,
  });
  // The carried key still fits: the engine keeps running only when hotwired (PZ: key out = off).
  if (!v.hotwired) stopEngine(w, v, 'key');
  return undefined;
}

/** `vehicleEngine {on}`. */
export function applyEngine(
  w: SimWorld,
  eid: number,
  on: boolean,
): CommandRejectReason | undefined {
  const v = drivenBy(w, eid);
  if (!v || v.engineOn === on) return 'invalid-state';
  if (!on) {
    stopEngine(w, v, 'driver');
    return undefined;
  }
  const block = startBlock(w, v);
  if (block) return block;
  tryStartEngine(w, v);
  return undefined;
}

/** `horn`: noise + `vehicleHorn`, at most once per `horn.cooldownSec` (extra presses ignored). */
export function applyHorn(w: SimWorld, eid: number): CommandRejectReason | undefined {
  const v = drivenBy(w, eid);
  if (!v) return 'invalid-state';
  const h = vehicleSettings(w).horn;
  const cd = Math.round(h.cooldownSec * TICKS_PER_SECOND);
  if (v.hornTick >= 0 && w.tick - v.hornTick < cd) return undefined;
  v.hornTick = w.tick;
  emitNoise(w, v.x, v.y, v.z, h.noise.radiusTiles, h.noise.volume, 'vehicle', 0, {
    eid,
    kind: 'horn',
  });
  w.events.push({
    type: 'vehicleHorn',
    tick: w.tick,
    vehicleId: v.id,
    playerId: w.c.Player.id[eid] ?? 0,
    x: v.x,
    y: v.y,
  });
  return undefined;
}

/** Fields added with vehicle gameplay (states and saves from before: unlocked, key inside). */
export function ensureVehicleGameplay(v: Vehicle): void {
  if (typeof v.locked !== 'boolean') v.locked = false;
  if (typeof v.keyIn !== 'boolean') v.keyIn = true;
  if (typeof v.hotwired !== 'boolean') v.hotwired = false;
  if (typeof v.hornTick !== 'number') v.hornTick = -1;
  if (!Array.isArray(v.containers)) v.containers = [];
}
