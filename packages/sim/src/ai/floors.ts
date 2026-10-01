import type { SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';

/**
 * Goals on another floor (docs/sim-architecture.md, "Piętra"). `Zombie.tz` holds the floor of the
 * goal (`Zombie.tx`/`ty`), e.g. a noise heard through a ceiling. While the zombie stands on another
 * floor than its goal, locomotion asks `crossFloorWaypoint` for the nearest passage (stairs) to
 * that floor and walks there instead; without one it walks to the goal's projection on its own
 * floor (below / above the source) and investigates there.
 *
 * Floors are compared as `Math.floor(z)`, so a fractional z on stairs counts as the lower floor.
 */

/** Floor index of a z coordinate (stairs give fractional z). */
export const floorOf = (z: number): number => Math.floor(z);

/** A way from floor `fromZ` towards `toZ` (stairs entry tile centre on `fromZ`). */
export interface FloorPassage {
  x: number;
  y: number;
  fromZ: number;
  toZ: number;
}

/**
 * Nearest passage from (x, y) on floor `z` leading towards floor `toZ`.
 *
 * TODO(floors): stub until the physics PR lands `stairsAt` / `SimChunk.stairs` in `world/`:
 * then scan the stairs of the floor (deterministic order: distance², then ty, tx) and return the
 * closest one going up (`toZ > z`) or down. No pathfinding over stairs yet: the zombie walks to
 * the entry with its usual straight line / A* on its own floor, physics moves it along the stairs.
 */
export function nearestPassage(
  _grid: TileGrid,
  _z: number,
  _x: number,
  _y: number,
  _toZ: number,
): FloorPassage | undefined {
  return undefined;
}

/**
 * Waypoint for a zombie whose goal is on another floor: the passage entry, or undefined (same
 * floor, or no passage: keep steering to `tx`/`ty` on its own floor).
 */
export function crossFloorWaypoint(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  x: number,
  y: number,
  z: number,
): { x: number; y: number } | undefined {
  const floor = floorOf(z);
  const goal = w.c.Zombie.tz[eid] ?? floor;
  if (goal === floor) return undefined;
  const p = nearestPassage(grid, floor, x, y, goal);
  return p ? { x: p.x, y: p.y } : undefined;
}

/** True when the zombie's goal is on another floor than the zombie. */
export const goalOnOtherFloor = (w: SimWorld, eid: number, z: number): boolean =>
  (w.c.Zombie.tz[eid] ?? 0) !== floorOf(z);
