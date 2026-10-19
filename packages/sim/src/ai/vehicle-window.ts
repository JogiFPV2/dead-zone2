import { sortedQuery, type SimWorld } from '../core/world.js';
import { circleVsObb, obbOf } from '../vehicles/geometry.js';
import { seatPoint, vehicleTypes } from '../vehicles/seats.js';
import type { Vehicle } from '../vehicles/types.js';
import { segDist2, vehicleOpeningsOf, type VehicleOpening } from '../vehicles/windows.js';
import { circleOverlaps } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { floorZ } from '../world/levels.js';
import { walkableLine } from '../world/los.js';
import { ZombieState, type AiWorld } from './state.js';

/**
 * Target `vehicle window` (docs 2.5 `ai`): a zombie chasing a player who sits in a slow car
 * (≤ `physics.vehicle.shakeOffSpeed`) with a broken window on the side of the player's seat
 * walks to a stand point just outside that opening and stays there facing the seat. The attack
 * through the window and the pull-out are the vehicle mechanic (`vehicles/windows.ts`
 * `windowAccess` / `windowGrabStep`); this only steers. Several zombies spread over the
 * reachable openings (fewest assigned first, then the nearest) and, at one opening, along it.
 * No reachable opening (intact windows, or only ones that don't reach the seat) = the old
 * chase: walk to the car and bang on the body. Derived each tick from saved state (not saved,
 * not hashed), only for active zombies within `ai.farTiles` of their target, in a fixed order
 * (distance, then StableId), so it is deterministic and survives save / load.
 */

export interface WindowGoal {
  /** Next waypoint (the stand point, or a corner around the car on the way). */
  x: number;
  y: number;
  /** Stand point at the opening and the seat to face. */
  sx: number;
  sy: number;
  ax: number;
  ay: number;
  /** Vehicle StableId and window index (0..3 front, rear, left, right). */
  vehicle: number;
  window: number;
  /** Near the car with a walkable line to the waypoint: steer straight (no flow / A*). */
  local: boolean;
}

/** Stand point: zombie radius + this outside the outline. */
const STAND_GAP = 0.1;
/** Spacing of extra zombies along one opening. */
const SLOT_SPACING = 0.6;
/** Margin of the detour corners around the car (beyond the zombie radius). */
const CORNER_GAP = 0.15;
/** Steer straight when this close to the car's outline. */
const LOCAL_TILES = 4;
/** At the stand point within this. */
export const WINDOW_ARRIVE = 0.12;

interface Slot {
  o: VehicleOpening;
  wi: number;
  load: number;
}

interface Candidate {
  eid: number;
  sid: number;
  v: Vehicle;
  seat: number;
  d2: number;
}

const f = Math.fround;
const WINDOWS = ['front', 'rear', 'left', 'right'] as const;

/** Recomputes `ai.windowGoals` (call after the brain updated the states of this tick). */
export function assignVehicleWindows(w: SimWorld, ai: AiWorld, grid: TileGrid): void {
  ai.windowGoals.clear();
  if (w.physics.vehicles.size === 0) return;
  const vcfg = w.physics.cfg.vehicle;
  const far2 = ai.cfg.ai.farTiles * ai.cfg.ai.farTiles;
  // Seated players in slow cars with broken windows: StableId → (car, seat).
  const seated = new Map<number, { v: Vehicle; seat: number }>();
  for (const v of [...w.physics.vehicles.values()].sort((a, b) => a.id - b.id)) {
    const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
    if (sp > vcfg.shakeOffSpeed || !v.windows.some((hp) => hp <= 0)) continue;
    v.occupants.forEach((sid, seat) => {
      if (sid) seated.set(sid, { v, seat });
    });
  }
  if (seated.size === 0) return;
  const { Position, Zombie, StableId } = w.c;
  const cands: Candidate[] = [];
  for (const eid of sortedQuery(w, 'zombies', [Zombie])) {
    if (Zombie.state[eid] !== ZombieState.chase || (Zombie.hp[eid] ?? 0) <= 0) continue;
    const at = seated.get(Zombie.targetId[eid] ?? 0);
    if (!at || floorZ(w, eid) !== Math.floor(at.v.z)) continue;
    const dx = at.v.x - (Position.x[eid] ?? 0);
    const dy = at.v.y - (Position.y[eid] ?? 0);
    const d2 = dx * dx + dy * dy;
    if (d2 > far2) continue;
    cands.push({ eid, sid: StableId.value[eid] ?? 0, v: at.v, seat: at.seat, d2 });
  }
  if (cands.length === 0) return;
  // Closest first: a zombie already at a window keeps it.
  cands.sort((a, b) => a.d2 - b.d2 || a.sid - b.sid);
  const slots = new Map<number, Slot[]>();
  for (const c of cands) {
    let list = slots.get(c.v.id);
    if (!list) {
      list = vehicleOpeningsOf(w, c.v).map((o) => ({ o, wi: WINDOWS.indexOf(o.window), load: 0 }));
      slots.set(c.v.id, list);
    }
    const goal = pick(w, grid, c, list, vcfg.seatReachTiles);
    if (goal) ai.windowGoals.set(c.eid, goal);
  }
}

/** Opening with the fewest zombies, then the nearest stand point; undefined = none reachable. */
function pick(
  w: SimWorld,
  grid: TileGrid,
  c: Candidate,
  list: Slot[],
  seatReach: number,
): WindowGoal | undefined {
  const t = vehicleTypes(w)[c.v.type];
  if (!t) return undefined;
  const { Position, Collider } = w.c;
  const x = Position.x[c.eid] ?? 0;
  const y = Position.y[c.eid] ?? 0;
  const z = Math.floor(c.v.z);
  const r = Collider.radius[c.eid] ?? 0.3;
  const seat = seatPoint(c.v, t, c.seat);
  let best: { s: Slot; sx: number; sy: number; d2: number } | undefined;
  for (const s of list) {
    if (!s.o.seats.includes(c.seat)) continue;
    const p = standPoint(w, grid, c.v, s, seat, r, z, seatReach);
    if (!p) continue;
    const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (!best || s.load < best.s.load || (s.load === best.s.load && d2 < best.d2))
      best = { s, sx: p.x, sy: p.y, d2 };
  }
  if (!best) return undefined;
  best.s.load++;
  const way = detour(c.v, t.length / 2, t.width / 2, r, x, y, best.sx, best.sy);
  const ox = Math.abs((x - c.v.x) * c.v.hx + (y - c.v.y) * c.v.hy) - t.length / 2;
  const oy = Math.abs(-(x - c.v.x) * c.v.hy + (y - c.v.y) * c.v.hx) - t.width / 2;
  const near = ox <= LOCAL_TILES && oy <= LOCAL_TILES;
  return {
    x: f(way.x),
    y: f(way.y),
    sx: f(best.sx),
    sy: f(best.sy),
    ax: f(seat.x),
    ay: f(seat.y),
    vehicle: c.v.id,
    window: best.s.wi,
    local: near && walkableLine(grid, z, x, y, way.x, way.y),
  };
}

/**
 * Stand point outside opening `s` facing the seat: along the opening as close to the seat as
 * it goes, the k-th zombie there shifted ±`SLOT_SPACING` (the base spot when that slot is out
 * of reach). Free of walls and other cars, within `seatReach` of the seat.
 */
function standPoint(
  w: SimWorld,
  grid: TileGrid,
  v: Vehicle,
  s: Slot,
  seat: { x: number; y: number },
  r: number,
  z: number,
  seatReach: number,
): { x: number; y: number } | undefined {
  const o = s.o;
  const ax = -o.ny;
  const ay = o.nx;
  const lim = o.halfLen * 0.9;
  const base = Math.max(-lim, Math.min(lim, (seat.x - o.x) * ax + (seat.y - o.y) * ay));
  const out = r + STAND_GAP;
  const at = (along: number) => {
    const px = o.x + ax * along + o.nx * out;
    const py = o.y + ay * along + o.ny * out;
    // The mechanic measures the seat to the opening's segment (`seatInReach`); margin for the
    // f32 rounding of positions.
    if (segDist2(o, seat.x, seat.y) > (seatReach - 0.05) * (seatReach - 0.05)) return undefined;
    if (circleOverlaps(grid, z, px, py, r)) return undefined;
    for (const u of w.physics.vehicles.values()) {
      if (u.id === v.id || Math.floor(u.z) !== z) continue;
      const tu = vehicleTypes(w)[u.type];
      if (tu && circleVsObb(obbOf(u, tu), px, py, r)) return undefined;
    }
    return { x: px, y: py };
  };
  const k = s.load;
  if (k > 0) {
    const step = Math.ceil(k / 2) * SLOT_SPACING * (k % 2 === 1 ? 1 : -1);
    const along = base + step;
    if (along >= -lim && along <= lim) {
      const p = at(along);
      if (p) return p;
    }
  }
  return at(base);
}

/**
 * Next waypoint from (x, y) to the stand point around the car: shortest path over the corners
 * of the outline (grown by the zombie radius + `CORNER_GAP`), in the car's frame, segments that
 * cross the car's box are not allowed. Straight when the line is clear.
 */
function detour(
  v: Vehicle,
  hl: number,
  hw: number,
  r: number,
  x: number,
  y: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const loc = (px: number, py: number) => ({
    l: (px - v.x) * v.hx + (py - v.y) * v.hy,
    s: -(px - v.x) * v.hy + (py - v.y) * v.hx,
  });
  const bl = hl + r * 0.9;
  const bw = hw + r * 0.9;
  const a = loc(x, y);
  const b = loc(sx, sy);
  // Already touching the box (pushed out to exactly r): just walk to the stand point.
  if (Math.abs(a.l) < bl && Math.abs(a.s) < bw) return { x: sx, y: sy };
  if (!crosses(a.l, a.s, b.l, b.s, bl, bw)) return { x: sx, y: sy };
  const cl = hl + r + CORNER_GAP;
  const cw = hw + r + CORNER_GAP;
  // Nodes: 0 = zombie, 1..4 = corners, 5 = stand point. Dijkstra over 6 nodes.
  const nodes = [a, { l: cl, s: cw }, { l: cl, s: -cw }, { l: -cl, s: -cw }, { l: -cl, s: cw }, b];
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      const p = nodes[u]!;
      const q = nodes[k]!;
      if (crosses(p.l, p.s, q.l, q.s, bl, bw)) continue;
      const d = dist[u]! + Math.sqrt((q.l - p.l) * (q.l - p.l) + (q.s - p.s) * (q.s - p.s));
      if (d < dist[k]!) {
        dist[k] = d;
        prev[k] = u;
      }
    }
  }
  if (prev[5] === -1) return { x: sx, y: sy };
  let k = 5;
  while (prev[k] !== 0) k = prev[k]!;
  const c = nodes[k]!;
  return { x: v.x + v.hx * c.l - v.hy * c.s, y: v.y + v.hy * c.l + v.hx * c.s };
}

/** Segment (l0,s0)→(l1,s1) passes through the open box |l| < bl, |s| < bw (slab test). */
function crosses(l0: number, s0: number, l1: number, s1: number, bl: number, bw: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const slab = (p: number, d: number, h: number): boolean => {
    if (Math.abs(d) < 1e-9) return p > -h && p < h;
    let a = (-h - p) / d;
    let b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 < t1;
  };
  if (!slab(l0, l1 - l0, bl)) return false;
  if (!slab(s0, s1 - s0, bw)) return false;
  return t1 - t0 > 1e-6;
}
