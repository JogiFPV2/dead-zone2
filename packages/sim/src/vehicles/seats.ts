import type { VehicleTypeDef } from '../content/adapter.js';
import type { SimWorld } from '../core/world.js';
import type { VehicleConfig } from './config.js';
import type { Vehicle } from './types.js';

/** World point of `seat` (content offset: x forward, y to the right). */
export function seatPoint(v: Vehicle, t: VehicleTypeDef, seat: number): { x: number; y: number } {
  const o = t.seats[seat]!.offset;
  return { x: v.x + v.hx * o.x - v.hy * o.y, y: v.y + v.hy * o.x + v.hx * o.y };
}

/** Where a player stands to get in / ends up getting out: outside the seat's door. */
export function doorPoint(
  v: Vehicle,
  t: VehicleTypeDef,
  seat: number,
  cfg: VehicleConfig,
): { x: number; y: number } {
  const s = t.seats[seat]!;
  const side = s.doorSide === 'right' ? 1 : -1;
  const lat = side * (t.width / 2 + cfg.doorGap);
  return { x: v.x + v.hx * s.offset.x - v.hy * lat, y: v.y + v.hy * s.offset.x + v.hx * lat };
}

/** Entity of the player with StableId `sid` (occupants are players), or undefined. */
export function playerEidOf(w: SimWorld, sid: number): number | undefined {
  for (const eid of w.players.values()) if (w.c.StableId.value[eid] === sid) return eid;
  return undefined;
}

/** Vehicle and seat the player `sid` sits in. */
export function seatOf(w: SimWorld, sid: number): { v: Vehicle; seat: number } | undefined {
  for (const v of w.physics.vehicles.values()) {
    const seat = v.occupants.indexOf(sid);
    if (seat >= 0) return { v, seat };
  }
  return undefined;
}

export const vehicleTypes = (w: SimWorld): readonly VehicleTypeDef[] =>
  w.survival?.content.vehicleTypes ?? [];
