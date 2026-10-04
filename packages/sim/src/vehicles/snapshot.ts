import {
  encodeVehicleSnapshot,
  vehicleSnapshotByteLength,
  type SnapshotVehicle,
} from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { datan2 } from '../core/dmath.js';
import { sortedVehicles } from './system.js';
import type { Vehicle } from './types.js';

/** Nose direction in radians [0, 2π) (like entity `facingRad`). */
export function facingRadOf(v: Vehicle): number {
  const a = datan2(v.hy, v.hx);
  return Math.fround(a < 0 ? a + 6.283185307179586 : a);
}

/** Sim → client view of one vehicle (snapshot block `vehicles`, protocol `VehicleField`). */
export function snapshotVehicle(v: Vehicle): SnapshotVehicle {
  return {
    stableId: v.id,
    variant: v.type,
    x: v.x,
    y: v.y,
    z: v.z,
    facingRad: facingRadOf(v),
    speed: v.speed,
    steer: v.steer,
    brakeLight: v.brake > 0 && v.speed > 0.05,
    headlights: v.headlights,
    doorsOpen: v.doorsOpen,
    driverId: v.occupants[0] ?? 0,
    slip: v.slip,
    wheelsSpin: v.wheelSpin,
    suspension: [v.susp[0] ?? 0.5, v.susp[1] ?? 0.5, v.susp[2] ?? 0.5, v.susp[3] ?? 0.5],
    damage: {
      front: (v.zones[0] ?? 100) / 100,
      rear: (v.zones[1] ?? 100) / 100,
      left: (v.zones[2] ?? 100) / 100,
      right: (v.zones[3] ?? 100) / 100,
    },
  };
}

/** Vehicle block of the render snapshot (StableId order; frozen cars included, they are parked). */
export const writeVehicleSnapshot = (w: SimWorld, buf?: ArrayBuffer): ArrayBuffer =>
  encodeVehicleSnapshot(sortedVehicles(w).map(snapshotVehicle), buf);

export const vehicleSnapshotBytes = (w: SimWorld): number =>
  vehicleSnapshotByteLength(w.physics.vehicles.size);
