import type { FloorHudVM } from '../hud/floor-hud.js';
import { NO_BUILDING, type ChunkSource } from '../world/chunk.js';
import { scanBuilding, type BuildingPlan } from './building-plan.js';
import { DemoFloorIntel, SimFloorIntel, type FloorIntel } from './floor-intel.js';

/** Building lookup the game already has (structures / town kit). */
export interface BuildingAt {
  at(tx: number, ty: number, z: number): number;
}

export interface FloorsFrame {
  x: number;
  y: number;
  /** Player level (floor of the body). */
  z: number;
  tick: number;
}

export interface Floors {
  readonly intel: FloorIntel;
  /** Per-frame: the HUD view model (badge, minimap plan, zombies of ±1 floors). */
  frame(f: FloorsFrame): FloorHudVM;
  /** Building the player is in, with its level (big map default floor). */
  current(): { plan: BuildingPlan; z: number } | undefined;
  /** Big map click: the building at world point (x, y) (any level), or undefined. */
  pick(x: number, y: number): BuildingPlan | undefined;
}

/**
 * Glue between the map, the player and the floor UI: finds the building around the player,
 * caches its plans (static map data, scanned once per building) and keeps the floor intel
 * (`SimFloorIntel` from the sim, or the `?floorsDemo=1` review data — floor-intel.ts).
 */
export function createFloors(
  source: ChunkSource,
  lookup: BuildingAt,
  opts: { demo?: boolean; intel?: FloorIntel } = {},
): Floors {
  const plans = new Map<number, BuildingPlan | undefined>();
  const demo = opts.demo ? new DemoFloorIntel() : undefined;
  const intel: FloorIntel = demo ?? opts.intel ?? new SimFloorIntel();
  let demoFor = NO_BUILDING;
  let cur: { plan: BuildingPlan; z: number } | undefined;

  const planOf = (id: number, x: number, y: number, z: number) => {
    if (!plans.has(id)) plans.set(id, scanBuilding(source, id, x, y, z));
    return plans.get(id);
  };
  return {
    intel,
    frame(f) {
      const id = lookup.at(Math.floor(f.x), Math.floor(f.y), f.z);
      const plan = id !== NO_BUILDING ? planOf(id, f.x, f.y, f.z) : undefined;
      cur = plan ? { plan, z: f.z } : undefined;
      if (demo && plan && demoFor !== id) {
        demoFor = id;
        demo.setup(plan, f, f.tick);
      }
      const zombies = intel.sensedZombies();
      return plan
        ? {
            inside: true,
            z: f.z,
            zMin: plan.zMin,
            zMax: plan.zMax,
            building: id,
            plan: plan.floors.get(f.z),
            zombies,
          }
        : { inside: false, z: f.z, zMin: 0, zMax: 0, zombies };
    },
    current: () => cur,
    pick(x, y) {
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      for (const z of [0, 1, -1, 2]) {
        const id = lookup.at(tx, ty, z);
        if (id !== NO_BUILDING) return planOf(id, x, y, z);
      }
      return undefined;
    },
  };
}
