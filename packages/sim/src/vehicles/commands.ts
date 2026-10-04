import type { Command, CommandRejectReason } from '@deadzone/protocol';
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

type VehicleCommand = Extract<Command, { type: 'enterVehicle' | 'exitVehicle' | 'drive' }>;

export const isVehicleCommand = (cmd: Command): cmd is VehicleCommand =>
  cmd.type === 'enterVehicle' || cmd.type === 'exitVehicle' || cmd.type === 'drive';

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

function enter(
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
    if (!v.engineOn && v.fuel > 0 && v.engine > 0) {
      v.engineOn = true;
      w.events.push({ type: 'engineStart', tick: w.tick, vehicleId: v.id });
    }
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

function exit(w: SimWorld, grid: TileGrid, eid: number): CommandRejectReason | undefined {
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
  unseat(w, eid, v, seat, d.x, d.y);
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
  if (cmd.headlights !== undefined) v.headlights = cmd.headlights;
  return undefined;
}

/** `enterVehicle` / `exitVehicle` (instant stubs, a timed action later) and `drive`. */
export function applyVehicleCommand(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  cmd: VehicleCommand,
): CommandRejectReason | undefined {
  if (cmd.type === 'enterVehicle') return enter(w, eid, cmd.vehicleId, cmd.seat);
  if (cmd.type === 'exitVehicle') return exit(w, grid, eid);
  return drive(w, eid, cmd);
}
