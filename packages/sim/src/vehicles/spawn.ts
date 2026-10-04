import { CHUNK_SIZE, type SimVehicleSpawn } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import { atan2Bam } from '../core/dmath.js';
import { dsincos } from './math.js';
import { vehicleTypes } from './seats.js';
import type { Vehicle } from './types.js';

const f = Math.fround;

/**
 * Adds a parked vehicle (engine off, handbrake on, doors closed). It gets a StableId from the
 * world counter but no ECS entity: vehicles live in `w.physics.vehicles` and the vehicle
 * snapshot block. `fuel` defaults to full. Returns the StableId.
 */
export function spawnVehicle(
  w: SimWorld,
  type: number,
  x: number,
  y: number,
  z = 0,
  headingRad = 0,
  fuel?: number,
): number {
  const t = vehicleTypes(w)[type];
  if (!t) throw new Error(`spawnVehicle: no vehicle type #${type}`);
  const id = w.nextStableId++;
  const [s, c] = dsincos(headingRad);
  const n = t.seats.length;
  const v: Vehicle = {
    id,
    type,
    x: f(x),
    y: f(y),
    z: f(z),
    hx: f(c),
    hy: f(s),
    heading: atan2Bam(f(s), f(c)),
    vx: 0,
    vy: 0,
    angVel: 0,
    speed: 0,
    throttle: 0,
    brake: 0,
    steerInput: 0,
    handbrake: true,
    steer: 0,
    headlights: false,
    engineOn: false,
    doorsOpen: 0,
    doorTicks: new Array<number>(n).fill(0),
    occupants: new Array<number>(n).fill(0),
    fuel: f(Math.min(fuel ?? t.fuelMax, t.fuelMax)),
    fuelMax: f(t.fuelMax),
    containers: [],
    slip: 0,
    wheelSpin: 0,
    susp: [0.5, 0.5, 0.5, 0.5],
    zones: [100, 100, 100, 100],
    engine: 100,
    tires: [100, 100, 100, 100],
    windows: [100, 100, 100, 100],
    grab: new Array<number>(n).fill(0),
    grabBy: new Array<number>(n).fill(0),
    contacts: [],
    cx: Math.floor(x / CHUNK_SIZE),
    cy: Math.floor(y / CHUNK_SIZE),
    frozenAt: -1,
  };
  w.physics.vehicles.set(id, v);
  return id;
}

/** `createSim({ spawnVehicles })` / worker init: type id (default: the first type). */
export function spawnVehicles(w: SimWorld, list: readonly SimVehicleSpawn[]): number[] {
  const index = w.survival?.content.vehicleTypeIndex;
  return list.map((s) => {
    const type = s.type !== undefined ? index?.get(s.type) : 0;
    if (type === undefined) throw new Error(`spawnVehicles: unknown vehicle type ${s.type}`);
    return spawnVehicle(w, type, s.x, s.y, s.z ?? 0, s.heading ?? 0, s.fuel);
  });
}
