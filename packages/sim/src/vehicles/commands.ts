import { VEHICLE_PARTS, type Command, type CommandRejectReason } from '@deadzone/protocol';
import { atan2Bam } from '../core/dmath.js';
import type { SimWorld } from '../core/world.js';
import { canAct } from '../physics/modifiers.js';
import { setState } from '../physics/reactions.js';
import { circleOverlaps } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { walkableLine } from '../world/los.js';
import { circleVsObb, obbOf } from './geometry.js';
import { doorPoint, seatOf, seatPoint, vehicleTypes } from './seats.js';
import type { Vehicle } from './types.js';
import type { VehicleTypeDef } from '../content/adapter.js';
import { interruptOnMove, newAction, startAction } from '../actions/queue.js';
import {
  applyEngine,
  applyHorn,
  applyLock,
  applyTakeKey,
  carriedKey,
  drivenBy,
  setLocked,
  tryStartEngine,
} from './keys.js';
import { vehicleSettings } from './settings.js';
import { setVehiclePartHp } from './damage.js';

const VEHICLE_COMMANDS = [
  'enterVehicle',
  'exitVehicle',
  'drive',
  'lockVehicle',
  'hotwire',
  'takeVehicleKey',
  'vehicleEngine',
  'horn',
  'refuelVehicle',
  'fillFuelCan',
  'siphonFuel',
  'repairVehicle',
  'debugDamageVehicle',
] as const;
type VehicleCommand = Extract<Command, { type: (typeof VEHICLE_COMMANDS)[number] }>;

export const isVehicleCommand = (cmd: Command): cmd is VehicleCommand =>
  (VEHICLE_COMMANDS as readonly string[]).includes(cmd.type);

const speedOf = (v: Vehicle): number => Math.sqrt(v.vx * v.vx + v.vy * v.vy);

/** Resets the driver controls (driver left). */
export function releaseControls(v: Vehicle): void {
  v.throttle = 0;
  v.brake = 0;
  v.steerInput = 0;
  v.handbrake = true;
}

export function openDoor(w: SimWorld, v: Vehicle, seat: number): void {
  v.doorsOpen |= 1 << seat;
  v.doorTicks[seat] = w.physics.cfg.vehicle.doorOpenTicks;
}

/** Puts the player into the seat (also used after loading old states and by tests). */
export function seatPlayer(w: SimWorld, eid: number, v: Vehicle, seat: number): void {
  const sid = w.c.StableId.value[eid] ?? 0;
  const b = w.physics.bodies.get(sid)!;
  v.occupants[seat] = sid;
  setState(b, 'driving', w.tick);
  b.vehicle = v.id;
  b.seat = seat;
  b.vel = { x: 0, y: 0 };
  b.maxSpeed = 0;
  w.c.Velocity.x[eid] = 0;
  w.c.Velocity.y[eid] = 0;
  w.c.MoveIntent.dx[eid] = 0;
  w.c.MoveIntent.dy[eid] = 0;
  pinOccupant(w, eid, v, seat);
}

/** Moves the player to its seat (every tick while seated). */
export function pinOccupant(w: SimWorld, eid: number, v: Vehicle, seat: number): void {
  const t = vehicleTypes(w)[v.type]!;
  const p = seatPoint(v, t, seat);
  const { Position, Facing, Velocity } = w.c;
  Position.x[eid] = Math.fround(p.x);
  Position.y[eid] = Math.fround(p.y);
  Position.z[eid] = v.z;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Facing.angle[eid] = atan2Bam(v.hy, v.hx);
}

/** Why player `eid` cannot get into `seat` of `vehicleId` now (undefined = it can). */
export function enterBlock(
  w: SimWorld,
  eid: number,
  vehicleId: number,
  seat: number,
): CommandRejectReason | undefined {
  const sid = w.c.StableId.value[eid] ?? 0;
  const b = w.physics.bodies.get(sid);
  if (!b || !canAct(b.state) || b.state === 'driving' || b.stair) return 'invalid-state';
  if (w.survival?.asleep[eid] || seatOf(w, sid)) return 'invalid-state';
  const v = w.physics.vehicles.get(vehicleId);
  const t = v ? vehicleTypes(w)[v.type] : undefined;
  if (!v || !t || seat >= t.seats.length || v.occupants[seat] !== 0) return 'invalid-target';
  if (Math.floor(w.c.Position.z[eid] ?? 0) !== Math.floor(v.z)) return 'out-of-range';
  const cfg = w.physics.cfg.vehicle;
  const d = doorPoint(v, t, seat, cfg);
  const dx = (w.c.Position.x[eid] ?? 0) - d.x;
  const dy = (w.c.Position.y[eid] ?? 0) - d.y;
  if (dx * dx + dy * dy > cfg.enterRange * cfg.enterRange) return 'out-of-range';
  if (speedOf(v) > cfg.enterMaxSpeed) return 'invalid-state';
  if (v.locked && !carriedKey(w, eid, v) && !doorWindowBroken(v, t, seat)) return 'locked';
  return undefined;
}

/** The window on the side of `seat`'s door is shattered (a hand reaches the lock). */
function doorWindowBroken(v: Vehicle, t: VehicleTypeDef, seat: number): boolean {
  const side = t.seats[seat]?.doorSide === 'right' ? 3 : 2;
  return (v.windows[side] ?? 100) <= 0;
}

/**
 * Gets in now (the end of the `enterVehicle` action, or at once with `enterSec` 0): checks
 * again, unlocks a locked car (key or broken window), seats the player; the driver starts the
 * engine when it may (key, fuel, working engine).
 */
export function enterNow(
  w: SimWorld,
  eid: number,
  vehicleId: number,
  seat: number,
): CommandRejectReason | undefined {
  const reason = enterBlock(w, eid, vehicleId, seat);
  if (reason) return reason;
  const v = w.physics.vehicles.get(vehicleId)!;
  if (v.locked) setLocked(w, eid, v, false, carriedKey(w, eid, v) ? 'key' : 'window');
  const sid = w.c.StableId.value[eid] ?? 0;
  seatPlayer(w, eid, v, seat);
  openDoor(w, v, seat);
  const playerId = w.c.Player.id[eid] ?? 0;
  w.events.push({
    type: 'vehicleEnter',
    tick: w.tick,
    vehicleId: v.id,
    playerId,
    entity: sid,
    seat,
  });
  if (seat === 0) {
    v.handbrake = false;
    tryStartEngine(w, v);
  }
  return undefined;
}

/** Takes `eid` out of its seat at the door point (no checks; `exit` checks, deaths skip them). */
export function unseat(
  w: SimWorld,
  eid: number,
  v: Vehicle,
  seat: number,
  x: number,
  y: number,
  reason: 'exit' | 'pulled' = 'exit',
): void {
  const sid = v.occupants[seat]!;
  v.occupants[seat] = 0;
  openDoor(w, v, seat);
  const b = w.physics.bodies.get(sid);
  if (b && b.state === 'driving') setState(b, 'idle', w.tick);
  if (b) {
    b.vehicle = 0;
    b.seat = -1;
  }
  w.c.Position.x[eid] = Math.fround(x);
  w.c.Position.y[eid] = Math.fround(y);
  const playerId = w.c.Player.id[eid] ?? 0;
  w.events.push({
    type: 'vehicleExit',
    tick: w.tick,
    vehicleId: v.id,
    playerId,
    entity: sid,
    seat,
    reason,
  });
  if (seat === 0) {
    releaseControls(v);
    if (v.engineOn) {
      v.engineOn = false;
      w.events.push({ type: 'engineStop', tick: w.tick, vehicleId: v.id, reason: 'driver-left' });
    }
  }
}

/** Where player `eid` would get out (vehicle, seat, door point), or why it cannot. */
export function exitBlock(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
): { v: Vehicle; seat: number; x: number; y: number } | CommandRejectReason {
  const sid = w.c.StableId.value[eid] ?? 0;
  const at = seatOf(w, sid);
  if (!at) return 'invalid-state';
  const { v, seat } = at;
  const t = vehicleTypes(w)[v.type]!;
  const cfg = w.physics.cfg.vehicle;
  if (speedOf(v) > cfg.exitMaxSpeed) return 'invalid-state';
  const z = Math.floor(v.z);
  const d = doorPoint(v, t, seat, cfg);
  const s = seatPoint(v, t, seat);
  const r = w.c.Collider.radius[eid] ?? 0.3;
  // Free path: from the seat through the door to a free spot (no wall, no other car).
  if (!walkableLine(grid, z, s.x, s.y, d.x, d.y) || circleOverlaps(grid, z, d.x, d.y, r))
    return 'no-space';
  for (const u of w.physics.vehicles.values()) {
    const tu = vehicleTypes(w)[u.type]!;
    if (u !== v && Math.floor(u.z) === z && circleVsObb(obbOf(u, tu), d.x, d.y, r))
      return 'no-space';
  }
  return { v, seat, x: d.x, y: d.y };
}

/** Gets out now (end of the `exitVehicle` action, or at once with `exitSec` 0). */
export function exitNow(w: SimWorld, grid: TileGrid, eid: number): CommandRejectReason | undefined {
  const at = exitBlock(w, grid, eid);
  if (typeof at === 'string') return at;
  unseat(w, eid, at.v, at.seat, at.x, at.y);
  return undefined;
}

function drive(
  w: SimWorld,
  eid: number,
  cmd: Extract<Command, { type: 'drive' }>,
): CommandRejectReason | undefined {
  const sid = w.c.StableId.value[eid] ?? 0;
  const at = seatOf(w, sid);
  if (!at || at.seat !== 0) return 'invalid-state';
  const v = at.v;
  v.throttle = Math.fround(cmd.throttle);
  v.brake = Math.fround(cmd.brake);
  v.steerInput = Math.fround(cmd.steer);
  v.handbrake = cmd.handbrake;
  // Gas / brake is moving, like walking: it stops `hotwire` (and any other timed action).
  if (v.throttle !== 0 || v.brake !== 0) interruptOnMove(w, eid);
  if (cmd.headlights !== undefined) v.headlights = cmd.headlights;
  return undefined;
}

/**
 * `enterVehicle` / `exitVehicle` (timed actions `enterVehicle` / `exitVehicle`, at once with
 * `enterSec` / `exitSec` 0; Fizyka's instant stubs `enterNow` / `exitNow` are the final step),
 * `drive`, `lockVehicle`, `hotwire` (timed), `takeVehicleKey`, `vehicleEngine`, `horn`.
 */
export function applyVehicleCommand(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cmd: VehicleCommand,
): CommandRejectReason | undefined {
  const cfg = vehicleSettings(w);
  switch (cmd.type) {
    case 'enterVehicle': {
      const reason = enterBlock(w, eid, cmd.vehicleId, cmd.seat);
      if (reason) return reason;
      if (cfg.enterSec <= 0 || !w.items) return enterNow(w, eid, cmd.vehicleId, cmd.seat);
      const a = newAction('enterVehicle');
      a.vehicle = cmd.vehicleId;
      a.seat = cmd.seat;
      return startAction(w, eid, a);
    }
    case 'exitVehicle': {
      const at = exitBlock(w, grid, eid);
      if (typeof at === 'string') return at;
      if (cfg.exitSec <= 0 || !w.items) return exitNow(w, grid, eid);
      const a = newAction('exitVehicle');
      a.vehicle = at.v.id;
      a.seat = at.seat;
      return startAction(w, eid, a);
    }
    case 'drive':
      return drive(w, eid, cmd);
    case 'lockVehicle':
      return applyLock(w, eid, cmd.vehicleId, cmd.locked);
    case 'hotwire': {
      const v = drivenBy(w, eid);
      if (!v) return 'invalid-state';
      const a = newAction('hotwire');
      a.vehicle = v.id;
      return startAction(w, eid, a);
    }
    case 'takeVehicleKey':
      return applyTakeKey(w, eid);
    case 'vehicleEngine':
      return applyEngine(w, eid, cmd.on);
    case 'horn':
      return applyHorn(w, eid);
    case 'refuelVehicle': {
      // Exactly one source: a carried gas can (`item`) or the pump on a tile (`pump`).
      if ((cmd.item === undefined) === (cmd.pump === undefined)) return 'invalid-target';
      const a = newAction('refuel', { item: cmd.item ?? 0 });
      a.vehicle = cmd.vehicleId;
      if (cmd.pump) a.pump = [cmd.pump.x, cmd.pump.y];
      return startAction(w, eid, a);
    }
    case 'siphonFuel': {
      const a = newAction('siphonFuel', { item: cmd.item });
      a.vehicle = cmd.vehicleId;
      return startAction(w, eid, a);
    }
    case 'fillFuelCan': {
      const a = newAction('fillFuel', { item: cmd.item });
      a.pump = [cmd.x, cmd.y];
      return startAction(w, eid, a);
    }
    case 'repairVehicle': {
      const a = newAction('repairVehicle');
      a.vehicle = cmd.vehicleId;
      a.seat = VEHICLE_PARTS.indexOf(cmd.part);
      return startAction(w, eid, a);
    }
    case 'debugDamageVehicle': {
      if (!w.dev) return 'dev-only';
      const v = w.physics.vehicles.get(cmd.vehicleId);
      if (!v || !setVehiclePartHp(w, v, cmd.part, cmd.hp)) return 'invalid-target';
      return undefined;
    }
  }
}
