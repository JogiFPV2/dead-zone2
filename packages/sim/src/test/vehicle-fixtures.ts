import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import type { SimVehicleSpawn, SimZombieSpawn } from '@deadzone/protocol';
import { createSim, type Sim, type SimOptions, type VehicleInfo } from '../sim.js';
import { NOON } from './ai-fixtures.js';
import { fixturePack } from './content-fixtures.js';
import { buildMap, type MapSpec } from './fixtures.js';

/** Like `base:sedan` (1200 kg, 4.6 × 1.8 m, driver on the left). */
export const SEDAN = {
  id: 'fixture:sedan',
  name: 'vehicle.fixture.sedan',
  length: 4.6,
  width: 1.8,
  wheelbase: 2.7,
  track: 1.55,
  wheelRadius: 0.32,
  mass: 1200,
  enginePower: 90,
  maxSpeed: 45,
  fuelMax: 50,
  consumption: 0.004,
  seats: [
    { id: 'driver', doorSide: 'left', offset: { x: 0.1, y: -0.4 } },
    { id: 'front-passenger', doorSide: 'right', offset: { x: 0.1, y: 0.4 } },
    { id: 'rear-left', doorSide: 'left', offset: { x: -0.8, y: -0.4 } },
    { id: 'rear-right', doorSide: 'right', offset: { x: -0.8, y: 0.4 } },
  ],
  trunkCapacity: 60,
  gloveboxCapacity: 3,
};

/** A zombie that barely moves or senses (ramming tests: closing speed = car speed). */
export const DUMMY_ZOMBIE = {
  id: 'fixture:dummy',
  name: 'zombie.fixture.dummy',
  health: 50,
  speed: { wanderTilesPerSec: 0.01, chaseTilesPerSec: 0.01 },
  damage: { min: 1, max: 2 },
  attackCooldownSec: 1,
  biteChance: 0,
  sightRangeTiles: 1,
  hearingRangeTiles: 1,
  lootTable: 'fixture:zombie',
};

let cached: ContentBundle | undefined;
export const vehicleContent = (): ContentBundle =>
  (cached ??= buildContentBundle([
    {
      ...fixturePack(),
      files: [
        ...fixturePack().files,
        { path: 'vehicle-types/sedan.json', json: SEDAN },
        { path: 'zombie-types/dummy.json', json: DUMMY_ZOMBIE },
      ],
    },
  ]));

/** Driver door of a car at (x, y) heading +x (left side = −y). */
export const driverDoor = (x: number, y: number) => ({ x: x + 0.1, y: y - 1.3 });

export interface VehicleSimOptions extends Partial<Omit<SimOptions, 'map'>> {
  map?: MapSpec;
  /** Car position (heading +x by default); the player spawns at its driver door. */
  car?: SimVehicleSpawn;
  zombies?: readonly SimZombieSpawn[];
}

/** Fixture sim (256 × 128 open floor) with one sedan; the player stands at the driver door. */
export function vehicleSim(opts: VehicleSimOptions = {}): Sim {
  const { map, car, zombies, ...rest } = opts;
  const c = car ?? { x: 20, y: 64 };
  return createSim({
    seed: 7,
    map: buildMap({ width: 256, height: 128, ...map }),
    spawn: driverDoor(c.x, c.y),
    content: vehicleContent(),
    dev: true,
    clockStart: NOON,
    spawnVehicles: [c],
    ...(zombies ? { spawnZombies: zombies } : {}),
    ...rest,
  });
}

/** Per-sim command sender (hash-comparable runs). */
export function controls(sim: Sim, playerId = 0, seqStart = 0) {
  let seq = seqStart;
  const send = (c: Record<string, unknown>) => {
    const r = sim.enqueue({ ...c, tick: sim.tick, playerId, seq: seq++ } as never);
    if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  };
  return {
    enter: (vehicleId: number, seat = 0) => send({ type: 'enterVehicle', vehicleId, seat }),
    exit: () => send({ type: 'exitVehicle' }),
    drive: (throttle: number, brake = 0, steer = 0, handbrake = false) =>
      send({ type: 'drive', throttle, brake, steer, handbrake }),
    move: (dx: number, dy: number) => send({ type: 'move', dx, dy }),
    get seq() {
      return seq;
    },
  };
}

export const car = (sim: Sim, i = 0): VehicleInfo => sim.getVehicles()[i]!;

/** Sim with the player already in the driver seat (one tick stepped). */
export function seatedSim(opts: VehicleSimOptions = {}): {
  sim: Sim;
  ctl: ReturnType<typeof controls>;
} {
  const sim = vehicleSim(opts);
  const ctl = controls(sim);
  ctl.enter(car(sim).stableId);
  sim.step();
  return { sim, ctl };
}
