import { CHUNK_SIZE } from '@deadzone/protocol';
import type { SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import { stairWorld, type Stair } from '../world/levels.js';

/**
 * Goals on another floor (docs/sim-architecture.md 9.17, "Piętra"). `Zombie.tz` holds the floor
 * of the goal (`Zombie.tx`/`ty`), e.g. a noise heard through a ceiling. While the zombie stands
 * on another floor than its goal, locomotion asks `crossFloorWaypoint` for the nearest passage
 * (a flight of stairs, `world/levels.ts`) to the next floor towards the goal and walks there
 * instead, one floor at a time; without one it walks to the goal's projection on its own floor
 * (below / above the source) and investigates there, as before stairs existed.
 *
 * The flight itself is walked by physics (`physicsLevelMove`, the movement hook): the AI only
 * steers into the entrance (bottom edge going up, the top landing going down) and then along
 * the flight until it leaves it on the other level.
 *
 * Floors are compared as `Math.floor(z)`, so a fractional z on stairs counts as the lower floor.
 */

/** Floor index of a z coordinate (stairs give fractional z). */
export const floorOf = (z: number): number => Math.floor(z);

/** Passages are looked up in the chunks within this many chunks of the zombie (5×5 chunks). */
export const PASSAGE_SEARCH_CHUNKS = 2;

/**
 * A way from floor `fromZ` to `toZ` = fromZ ± 1: the approach tile (`ax`, `ay`) on `fromZ`
 * (in front of the entrance going up, the top landing going down), its centre (`x`, `y`) and
 * the point inside the flight to steer at from the approach tile (`inX`, `inY`).
 */
export interface FloorPassage {
  x: number;
  y: number;
  ax: number;
  ay: number;
  inX: number;
  inY: number;
  fromZ: number;
  toZ: number;
  stair: Stair;
}

/**
 * Passages per (approach chunk, floor, up / down) of a grid. Derived from static map data; on
 * lazy worlds (sim LOD) stairs are registered as chunks come close, so the cache is rebuilt
 * when `grid.stairs` grew (else a run and its loaded save would see different passages).
 */
const passageCache = new WeakMap<TileGrid, { n: number; m: Map<string, FloorPassage[]> }>();

const bucketKey = (cx: number, cy: number, z: number, up: boolean): string =>
  `${cx},${cy},${z},${up ? 1 : 0}`;

function passagesOf(grid: TileGrid): Map<string, FloorPassage[]> {
  const hit = passageCache.get(grid);
  if (hit && hit.n === grid.stairs.length) return hit.m;
  nearCache.delete(grid);
  const m = new Map<string, FloorPassage[]>();
  const add = (p: FloorPassage): void => {
    // The approach tile must have a floor (else the flight cannot be entered from that side).
    if (grid.isVoid(p.ax, p.ay, p.fromZ)) return;
    const k = bucketKey(
      Math.floor(p.ax / CHUNK_SIZE),
      Math.floor(p.ay / CHUNK_SIZE),
      p.fromZ,
      p.toZ > p.fromZ,
    );
    const list = m.get(k);
    if (list) list.push(p);
    else m.set(k, [p]);
  };
  for (const s of grid.stairs) {
    // Up: in front of the bottom edge on s.z, steer to the middle of the first tile.
    const bottomIn = stairWorld(s, 0.6, 0.5);
    add({
      ax: s.tx - s.dx,
      ay: s.ty - s.dy,
      x: s.tx - s.dx + 0.5,
      y: s.ty - s.dy + 0.5,
      inX: bottomIn.x,
      inY: bottomIn.y,
      fromZ: s.z,
      toZ: s.z + 1,
      stair: s,
    });
    // Down: the landing tile past the top on s.z + 1, steer into the last tile.
    const topIn = stairWorld(s, s.len - 0.6, 0.5);
    const ex = s.tx + s.dx * s.len;
    const ey = s.ty + s.dy * s.len;
    add({
      ax: ex,
      ay: ey,
      x: ex + 0.5,
      y: ey + 0.5,
      inX: topIn.x,
      inY: topIn.y,
      fromZ: s.z + 1,
      toZ: s.z,
      stair: s,
    });
  }
  passageCache.set(grid, { n: grid.stairs.length, m });
  return m;
}

/** Passages within `PASSAGE_SEARCH_CHUNKS` of chunk (cx, cy), memoised per chunk (derived). */
const nearCache = new WeakMap<TileGrid, Map<string, readonly FloorPassage[]>>();
const NONE: readonly FloorPassage[] = [];

function candidates(
  grid: TileGrid,
  ccx: number,
  ccy: number,
  z: number,
  up: boolean,
): readonly FloorPassage[] {
  const all = passagesOf(grid); // first: drops `nearCache` when stairs were added
  let memo = nearCache.get(grid);
  if (!memo) {
    memo = new Map();
    nearCache.set(grid, memo);
  }
  const key = bucketKey(ccx, ccy, z, up);
  let list = memo.get(key);
  if (list) return list;
  const found: FloorPassage[] = [];
  const R = PASSAGE_SEARCH_CHUNKS;
  for (let cy = ccy - R; cy <= ccy + R; cy++) {
    for (let cx = ccx - R; cx <= ccx + R; cx++)
      found.push(...(all.get(bucketKey(cx, cy, z, up)) ?? NONE));
  }
  list = found.length > 0 ? found : NONE;
  memo.set(key, list);
  return list;
}

/**
 * Nearest passage from (x, y) on floor `z` one floor towards `toZ` (up: a flight starting on
 * `z`; down: a flight from z − 1 entered at its top), among the chunks within
 * `PASSAGE_SEARCH_CHUNKS` of (x, y). Deterministic: distance² to the approach tile centre, then
 * ty, tx, stair id. Straight-line distance: an unreachable passage makes the zombie give up the
 * goal like any unreachable goal (A* fails, `stuckTicks`).
 */
export function nearestPassage(
  grid: TileGrid,
  z: number,
  x: number,
  y: number,
  toZ: number,
): FloorPassage | undefined {
  if (toZ === z || grid.stairs.length === 0) return undefined;
  const list = candidates(
    grid,
    Math.floor(Math.floor(x) / CHUNK_SIZE),
    Math.floor(Math.floor(y) / CHUNK_SIZE),
    z,
    toZ > z,
  );
  let best: FloorPassage | undefined;
  let bestD2 = Infinity;
  for (const p of list) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (
      !best ||
      d2 < bestD2 ||
      (d2 === bestD2 &&
        (p.ay < best.ay ||
          (p.ay === best.ay &&
            (p.ax < best.ax || (p.ax === best.ax && p.stair.id < best.stair.id)))))
    ) {
      best = p;
      bestD2 = d2;
    }
  }
  return best;
}

/** Steering waypoint across floors; `direct` = walk straight at it (no A* / flow field). */
export interface FloorWaypoint {
  x: number;
  y: number;
  direct: boolean;
}

/** Flight the zombie's physics body is on, if any. */
function flightOf(w: SimWorld, eid: number): Stair | undefined {
  const b = w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
  return b && b.stair > 0 ? w.physics.stairs[b.stair - 1] : undefined;
}

/**
 * Waypoint for a zombie whose goal is on another floor, or undefined (goal on its floor, or no
 * passage within reach: keep steering to `tx`/`ty` on its own floor).
 * - On a flight: straight on along it, up when the goal is above its base level, else down.
 * - On the approach tile of the nearest passage: straight into the flight (physics takes over).
 * - Elsewhere: to the approach tile (A* on its own floor).
 */
export function crossFloorWaypoint(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  x: number,
  y: number,
  z: number,
): FloorWaypoint | undefined {
  const floor = floorOf(z);
  const goal = w.c.Zombie.tz[eid] ?? floor;
  if (goal === floor) return undefined;
  const s = flightOf(w, eid);
  if (s) {
    const p = stairWorld(s, goal > s.z ? s.len + 0.6 : -0.6, 0.5);
    return { x: p.x, y: p.y, direct: true };
  }
  const p = nearestPassage(grid, floor, x, y, goal);
  if (!p) return undefined;
  if (Math.floor(x) === p.ax && Math.floor(y) === p.ay) return { x: p.inX, y: p.inY, direct: true };
  return { x: p.x, y: p.y, direct: false };
}

/** True when the zombie's goal is on another floor than the zombie. */
export const goalOnOtherFloor = (w: SimWorld, eid: number, z: number): boolean =>
  (w.c.Zombie.tz[eid] ?? 0) !== floorOf(z);

/**
 * The goal counts as reached in the plane only on its floor, or when no passage leads there
 * (then the zombie investigates the projection on its own floor, as without stairs).
 */
export function onGoalFloor(
  w: SimWorld,
  grid: TileGrid,
  eid: number,
  x: number,
  y: number,
  z: number,
): boolean {
  const floor = floorOf(z);
  const goal = w.c.Zombie.tz[eid] ?? floor;
  if (goal === floor) return true;
  if (flightOf(w, eid)) return false;
  return nearestPassage(grid, floor, x, y, goal) === undefined;
}
