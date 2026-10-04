import { VEHICLE_VIEW_TILES, type VehicleStateView } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { vehicleContainer } from './containers.js';
import { carriedKey } from './keys.js';
import { seatOf, vehicleTypes } from './seats.js';

/**
 * Gameplay state of the cars around player `eid` (`SimViewPatch.vehicles`): within
 * `VEHICLE_VIEW_TILES` plus the one it sits in, sorted by id.
 */
export function vehicleStateViews(w: SimWorld, eid: number): VehicleStateView[] {
  const out: VehicleStateView[] = [];
  const { Position } = w.c;
  const ex = Position.x[eid] ?? 0;
  const ey = Position.y[eid] ?? 0;
  const r2 = VEHICLE_VIEW_TILES * VEHICLE_VIEW_TILES;
  const inside = seatOf(w, w.c.StableId.value[eid] ?? 0)?.v.id;
  const types = vehicleTypes(w);
  for (const v of w.physics.vehicles.values()) {
    if (v.id !== inside && (v.x - ex) ** 2 + (v.y - ey) ** 2 > r2) continue;
    const trunk = vehicleContainer(w, v, 'vehicle-trunk');
    const glovebox = vehicleContainer(w, v, 'vehicle-glovebox');
    out.push({
      vehicleId: v.id,
      type: types[v.type]?.id ?? '',
      locked: v.locked,
      keyInIgnition: v.keyIn,
      hasKey: carriedKey(w, eid, v) !== undefined,
      hotwired: v.hotwired,
      engineOn: v.engineOn,
      fuel: Math.round(v.fuel * 10) / 10,
      fuelMax: v.fuelMax,
      ...(trunk ? { trunk: trunk.id } : {}),
      ...(glovebox ? { glovebox: glovebox.id } : {}),
    });
  }
  return out.sort((a, b) => a.vehicleId - b.vehicleId);
}
