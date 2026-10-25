import type { BuildingPlan, FloorPlan, PlanRoom } from './building-plan.js';
import type { FloorIntel, RoomState, SeenZombie } from './floor-intel.js';

/** Rooms counted on the plan: everything but stair halls (corridors still count). */
export const countedRoom = (r: PlanRoom): boolean => r.area > 0;

export interface FloorStats {
  rooms: number;
  searched: number;
  seen: number;
  unknown: number;
  /** The player knows anything about this floor (selector: bright number vs „—”). */
  visited: boolean;
}

export function floorStats(plan: FloorPlan, intel: FloorIntel): FloorStats {
  const s: FloorStats = { rooms: 0, searched: 0, seen: 0, unknown: 0, visited: false };
  for (const r of plan.rooms) {
    if (!countedRoom(r)) continue;
    s.rooms++;
    const st: RoomState = intel.room(r, plan.z);
    if (st === 'searched') s.searched++;
    else if (st === 'seen') s.seen++;
    else s.unknown++;
  }
  s.visited = s.searched + s.seen > 0;
  return s;
}

/** Inside the building's footprint box (with a small margin for points on the outline). */
export const inBox = (b: BuildingPlan['box'], x: number, y: number, margin = 0.5): boolean =>
  x >= b.x0 - margin && x <= b.x1 + margin && y >= b.y0 - margin && y <= b.y1 + margin;

/** Zombies last seen on floor z of the building. */
export const zombiesOnFloor = (
  plan: BuildingPlan,
  z: number,
  list: readonly SeenZombie[],
): SeenZombie[] => list.filter((p) => Math.floor(p.z) === z && inBox(plan.box, p.x, p.y));

/** „widziane 3 h temu” from sim ticks (20 Hz). */
export function agoText(nowTick: number, tick: number, tickMs = 50): string {
  const min = Math.max(0, Math.round(((nowTick - tick) * tickMs) / 60000));
  if (min < 1) return 'widziane teraz';
  if (min < 60) return `widziane ${min} min temu`;
  return `widziane ${Math.round(min / 60)} h temu`;
}

/**
 * Pixels per metre for the plan column: the whole floor fits `maxW × maxH`, at most 14 px/m
 * (small houses do not blow up), at least 2 px/m.
 */
export const planScale = (w: number, h: number, maxW: number, maxH: number): number =>
  Math.max(2, Math.min(14, maxW / Math.max(1, w), maxH / Math.max(1, h)));
