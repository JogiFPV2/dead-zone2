import type { SimWorld } from '../core/world.js';
import { floorZ } from '../world/levels.js';
import { circleVsObb, obbOf } from './geometry.js';
import { seatOf, vehicleTypes } from './seats.js';
import type { Vehicle } from './types.js';

/** Player `eid` stands on foot, on the car's level, within `reach` of the car body. */
export function onFootNear(w: SimWorld, eid: number, v: Vehicle, reach: number): boolean {
  const t = vehicleTypes(w)[v.type];
  if (!t || seatOf(w, w.c.StableId.value[eid] ?? 0)) return false;
  if (floorZ(w, eid) !== Math.floor(v.z)) return false;
  const px = w.c.Position.x[eid] ?? 0;
  const py = w.c.Position.y[eid] ?? 0;
  return circleVsObb(obbOf(v, t), px, py, reach) !== undefined;
}
