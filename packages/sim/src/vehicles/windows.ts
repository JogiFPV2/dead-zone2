import { VEHICLE_ZONES, type VehiclePart, type VehicleZone } from '@deadzone/protocol';
import { ZombieState } from '../ai/state.js';
import type { VehicleTypeDef } from '../content/adapter.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { physicsCanAct, physicsVehicleHit } from '../physics/system.js';
import type { TileGrid } from '../world/grid.js';
import { circleOverlaps } from '../world/collision.js';
import { floorZ } from '../world/levels.js';
import { walkableLine } from '../world/los.js';
import { unseat } from './commands.js';
import type { VehicleConfig } from './config.js';
import { damageVehiclePart } from './damage.js';
import { circleVsObb, obbOf, zoneAt } from './geometry.js';
import { doorPoint, playerEidOf, seatPoint, vehicleTypes } from './seats.js';
import type { Vehicle } from './types.js';

/**
 * Zombies reaching into a car through a broken window (`windows[i]` at 0 hp): a zombie standing
 * by the window can hit the people in the seats on that side (no car protection there, see
 * `combat/system.ts` `zombieAttacks`) and, after `pullTicks` of contact, pull one of them out
 * (`pullOutDriver`: forced exit through that side + knock-down, `vehicleExit {reason:
 * 'pulled'}`). A car faster than `shakeOffSpeed` shakes them off (stagger). Zombies never get
 * inside. The zombie AI is not touched: `vehicleOpenings` is the query for Symulacja's targeting.
 * Deterministic: vehicles / seats / zombies in StableId order, one `rng.physics` draw per roll.
 */

const f = Math.fround;
/** Body zone parts by side (front, rear, left, right). */
const BODY_PARTS: readonly VehiclePart[] = ['bodyFront', 'bodyRear', 'bodyLeft', 'bodyRight'];
const WINDOW_PARTS: readonly VehiclePart[] = [
  'windowFront',
  'windowRear',
  'windowLeft',
  'windowRight',
];

/** A broken window of a car: where a zombie can reach in (world tiles). */
export interface VehicleOpening {
  window: VehicleZone;
  part: VehiclePart;
  /** Centre of the opening on the car's outline and its outward normal (unit). */
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Half length of the opening along the outline (tiles): the segment is centre ± this. */
  halfLen: number;
  /** Seats reachable through it (seat indices; 0 = driver). */
  seats: number[];
}

/** Window `i` (front, rear, left, right) as a segment on the outline + the seats behind it. */
function windowGeom(v: Vehicle, t: VehicleTypeDef, i: number): VehicleOpening {
  const hl = t.length / 2;
  const hw = t.width / 2;
  // Local (l along the nose, s to the right) → world; right = (−hy, hx).
  const at = (l: number, s: number) => ({
    x: v.x + v.hx * l - v.hy * s,
    y: v.y + v.hy * l + v.hx * s,
  });
  const lc = i === 0 ? hl : i === 1 ? -hl : 0;
  const sc = i === 2 ? -hw : i === 3 ? hw : 0;
  const c = at(lc, sc);
  const nl = i === 0 ? 1 : i === 1 ? -1 : 0;
  const ns = i === 2 ? -1 : i === 3 ? 1 : 0;
  const seats: number[] = [];
  t.seats.forEach((s, k) => {
    const ok =
      i === 0
        ? s.offset.x > 0
        : i === 1
          ? s.offset.x <= 0
          : i === 2
            ? s.doorSide === 'left'
            : s.doorSide === 'right';
    if (ok) seats.push(k);
  });
  return {
    window: VEHICLE_ZONES[i]!,
    part: WINDOW_PARTS[i]!,
    x: f(c.x),
    y: f(c.y),
    nx: f(v.hx * nl - v.hy * ns),
    ny: f(v.hy * nl + v.hx * ns),
    halfLen: f(i < 2 ? hw * 0.8 : hl * 0.6),
    seats,
  };
}

/** Broken windows of `v` (StableId order of the windows: front, rear, left, right). */
export function vehicleOpeningsOf(w: SimWorld, v: Vehicle): VehicleOpening[] {
  const t = vehicleTypes(w)[v.type];
  if (!t) return [];
  const out: VehicleOpening[] = [];
  for (let i = 0; i < 4; i++) if ((v.windows[i] ?? 100) <= 0) out.push(windowGeom(v, t, i));
  return out;
}

/** Distance² from (px, py) to the opening segment. */
export function segDist2(o: VehicleOpening, px: number, py: number): number {
  // Segment direction = normal rotated 90°.
  const dx = -o.ny;
  const dy = o.nx;
  const rx = px - o.x;
  const ry = py - o.y;
  const along = Math.max(-o.halfLen, Math.min(o.halfLen, rx * dx + ry * dy));
  const ex = rx - along * dx;
  const ey = ry - along * dy;
  return ex * ex + ey * ey;
}

/** Zombie `zid` can reach seat `seat` of `v` through opening `o` (outside, near both). */
function reaches(
  w: SimWorld,
  v: Vehicle,
  t: VehicleTypeDef,
  o: VehicleOpening,
  seat: number,
  zid: number,
  cfg: VehicleConfig,
): boolean {
  if (!o.seats.includes(seat)) return false;
  const x = w.c.Position.x[zid] ?? 0;
  const y = w.c.Position.y[zid] ?? 0;
  // Outside the car, on the window's side.
  if ((x - o.x) * o.nx + (y - o.y) * o.ny < 0) return false;
  const r = (w.c.Collider.radius[zid] ?? 0.3) + cfg.windowReachTiles;
  if (segDist2(o, x, y) > r * r) return false;
  return seatInReach(o, seatPoint(v, t, seat), cfg);
}

/**
 * Seat point `s` is within `seatReachTiles` of the opening's segment (the arm goes in through
 * the opening; measured to the segment, so the windscreen reaches the front row and the rear
 * window the back row across the bonnet / boot). Shared with the AI stand points.
 */
export function seatInReach(
  o: VehicleOpening,
  s: { x: number; y: number },
  cfg: VehicleConfig,
): boolean {
  return segDist2(o, s.x, s.y) <= cfg.seatReachTiles * cfg.seatReachTiles;
}

const speedOf = (v: Vehicle) => Math.sqrt(v.vx * v.vx + v.vy * v.vy);

/**
 * `zombieAttacks` hook: window (0..3) through which zombie `zid` can hit the seated player
 * `sid`, or −1 (intact windows, wrong side, too far, the car too fast: the car protects).
 */
export function windowAccess(w: SimWorld, zid: number, sid: number): number {
  for (const v of [...w.physics.vehicles.values()].sort((a, b) => a.id - b.id)) {
    const seat = v.occupants.indexOf(sid);
    if (seat < 0) continue;
    const t = vehicleTypes(w)[v.type];
    const cfg = w.physics.cfg.vehicle;
    if (!t || speedOf(v) > cfg.shakeOffSpeed || floorZ(w, zid) !== Math.floor(v.z)) return -1;
    for (let i = 0; i < 4; i++) {
      if ((v.windows[i] ?? 100) > 0) continue;
      if (reaches(w, v, t, windowGeom(v, t, i), seat, zid, cfg)) return i;
    }
    return -1;
  }
  return -1;
}

/** A zombie at the car of a seated target (`carContact`). */
export interface CarContact {
  vehicle: Vehicle;
  /** Window (0..3) through which it reaches the target's seat, or −1 (the car protects). */
  access: number;
  /** Side of the car it stands at (zone: front 0, rear 1, left 2, right 3). */
  side: number;
}

/**
 * `zombieAttacks` reach for a seated target `sid`: the zombie's edge is within `reach` of the
 * car's box on the car's level and the car is ≤ `shakeOffSpeed`; undefined otherwise (out of
 * reach, no swing).
 */
export function carContact(
  w: SimWorld,
  zid: number,
  sid: number,
  reach: number,
): CarContact | undefined {
  for (const v of [...w.physics.vehicles.values()].sort((a, b) => a.id - b.id)) {
    if (!v.occupants.includes(sid)) continue;
    const t = vehicleTypes(w)[v.type];
    const cfg = w.physics.cfg.vehicle;
    if (!t || speedOf(v) > cfg.shakeOffSpeed || floorZ(w, zid) !== Math.floor(v.z))
      return undefined;
    const x = w.c.Position.x[zid] ?? 0;
    const y = w.c.Position.y[zid] ?? 0;
    const obb = obbOf(v, t);
    if (!circleVsObb(obb, x, y, (w.c.Collider.radius[zid] ?? 0.3) + reach)) return undefined;
    return { vehicle: v, access: windowAccess(w, zid, sid), side: zoneAt(obb, x, y) };
  }
  return undefined;
}

/**
 * A zombie blow at the car (target behind an intact window): the window on the side it stands
 * loses `zombieWindowDmg`; at 0 hp `vehiclePartBroken` at the zombie's position — the opening for
 * `windowAccess`. The body zone on that side loses `zombieBodyDmg` (a wrecked front: the engine).
 */
export function zombieHitsWindow(w: SimWorld, zid: number, c: CarContact): void {
  const cfg = w.physics.cfg.vehicle;
  const x = w.c.Position.x[zid] ?? 0;
  const y = w.c.Position.y[zid] ?? 0;
  if (cfg.zombieWindowDmg > 0)
    damageVehiclePart(w, c.vehicle, WINDOW_PARTS[c.side]!, cfg.zombieWindowDmg, x, y);
  if (!(cfg.zombieBodyDmg > 0)) return;
  // The body zone on that side; a wrecked front exposes the engine (docs 9.74).
  const zone = BODY_PARTS[c.side]!;
  const wrecked = (c.vehicle.zones[c.side] ?? 100) <= 0;
  const part: VehiclePart = wrecked && c.side === 0 ? 'engine' : zone;
  if (wrecked && part === zone) return;
  damageVehiclePart(w, c.vehicle, part, cfg.zombieBodyDmg, x, y);
}

/**
 * Forced exit of seat `seat` (default the driver) through the side of window `window` (side
 * windows: the seat's door point; front / rear: just outside that end, else the door point), a
 * knock-down away from the car and `vehicleExit {reason: 'pulled'}`. A driver leaving stops
 * the engine (`engineStop` `driver-left`). False when the seat is empty or no spot is free.
 */
export function pullOutDriver(
  w: SimWorld,
  grid: TileGrid,
  vehicleId: number,
  seat = 0,
  window?: number,
): boolean {
  const v = w.physics.vehicles.get(vehicleId);
  const t = v ? vehicleTypes(w)[v.type] : undefined;
  const sid = v?.occupants[seat] ?? 0;
  const eid = sid ? playerEidOf(w, sid) : undefined;
  if (!v || !t || eid === undefined) return false;
  const cfg = w.physics.cfg.vehicle;
  const z = Math.floor(v.z);
  const r = w.c.Collider.radius[eid] ?? 0.3;
  const free = (p: { x: number; y: number }) => {
    if (circleOverlaps(grid, z, p.x, p.y, r)) return false;
    for (const u of w.physics.vehicles.values()) {
      const tu = vehicleTypes(w)[u.type];
      if (tu && Math.floor(u.z) === z && circleVsObb(obbOf(u, tu), p.x, p.y, r)) return false;
    }
    return true;
  };
  const s = seatPoint(v, t, seat);
  const cands: { x: number; y: number }[] = [];
  if (window === 0 || window === 1) {
    const o = windowGeom(v, t, window);
    const d = cfg.doorGap + r;
    cands.push({ x: o.x + o.nx * d, y: o.y + o.ny * d });
  } else if (window === 2 || window === 3) {
    // Through the side window on the other side than the door (front passenger pulled left).
    const door = doorPoint(v, t, seat, cfg);
    const o = windowGeom(v, t, window);
    const d = cfg.doorGap;
    const along = (door.x - v.x) * v.hx + (door.y - v.y) * v.hy;
    cands.push({
      x: v.x + v.hx * along + o.nx * (t.width / 2 + d),
      y: v.y + v.hy * along + o.ny * (t.width / 2 + d),
    });
  }
  cands.push(doorPoint(v, t, seat, cfg));
  const p = cands.find((c) => free(c) && walkableLine(grid, z, s.x, s.y, c.x, c.y));
  if (!p) return false;
  unseat(w, eid, v, seat, p.x, p.y, 'pulled');
  // Knocked down, falling away from the car.
  let dx = p.x - v.x;
  let dy = p.y - v.y;
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  dx /= l;
  dy /= l;
  physicsVehicleHit(w, eid, v.id, 'knockdown', dx, dy, cfg.pullImpulse);
  return true;
}

/**
 * Per active car and tick (`vehicleSystem`): contact of zombies at broken windows with the
 * seats behind them. `grab[seat]` counts the contact ticks of zombie `grabBy[seat]`
 * (StableId); from `pullTicks` each tick rolls `pullChancePerTick` to pull the person out. A car
 * faster than `shakeOffSpeed` shakes the grabbing zombies off (stagger away from the car).
 */
export function windowGrabStep(w: SimWorld, grid: TileGrid, v: Vehicle): void {
  const cfg = w.physics.cfg.vehicle;
  const ai = w.ai;
  const t = vehicleTypes(w)[v.type];
  const any = v.grab.some((g) => g > 0);
  const openings = t ? vehicleOpeningsOf(w, v) : [];
  if (!ai || !t || openings.length === 0) {
    if (any) clearGrabs(v);
    return;
  }
  if (speedOf(v) > cfg.shakeOffSpeed) {
    if (any) shakeOff(w, v);
    return;
  }
  const z = Math.floor(v.z);
  for (let seat = 0; seat < v.occupants.length; seat++) {
    const sid = v.occupants[seat]!;
    if (!sid) {
      v.grab[seat] = 0;
      v.grabBy[seat] = 0;
      continue;
    }
    // Nearest zombie chasing this person that reaches the seat through an opening.
    let best = -1;
    let bestD = Infinity;
    let bestWin = -1;
    for (const o of openings) {
      if (!o.seats.includes(seat)) continue;
      const wi = VEHICLE_ZONES.indexOf(o.window);
      ai.spatial.query(o.x, o.y, o.halfLen + cfg.seatReachTiles, (zid) => {
        const Z = w.c.Zombie;
        if ((Z.hp[zid] ?? 0) <= 0 || floorZ(w, zid) !== z) return;
        if (Z.state[zid] !== ZombieState.chase || Z.targetId[zid] !== sid) return;
        if (!physicsCanAct(w, zid) || !reaches(w, v, t, o, seat, zid, cfg)) return;
        const d = segDist2(o, w.c.Position.x[zid] ?? 0, w.c.Position.y[zid] ?? 0);
        const zs = w.c.StableId.value[zid] ?? 0;
        // Ties: lower StableId (deterministic whatever the query order).
        const bs = best >= 0 ? (w.c.StableId.value[best] ?? 0) : 0;
        if (d < bestD || (d === bestD && zs < bs)) {
          best = zid;
          bestD = d;
          bestWin = wi;
        }
      });
    }
    if (best < 0) {
      v.grab[seat] = 0;
      v.grabBy[seat] = 0;
      continue;
    }
    const zs = w.c.StableId.value[best] ?? 0;
    if (v.grabBy[seat] !== zs) {
      v.grabBy[seat] = zs;
      v.grab[seat] = 0;
    }
    v.grab[seat] = v.grab[seat]! + 1;
    if (v.grab[seat]! < cfg.pullTicks) continue;
    if (!w.physics.rng.chance(cfg.pullChancePerTick)) continue;
    if (pullOutDriver(w, grid, v.id, seat, bestWin)) {
      v.grab[seat] = 0;
      v.grabBy[seat] = 0;
    }
  }
}

function clearGrabs(v: Vehicle): void {
  v.grab.fill(0);
  v.grabBy.fill(0);
}

/** The car drives off: every grabbing zombie staggers away from it. */
function shakeOff(w: SimWorld, v: Vehicle): void {
  const done = new Set<number>();
  for (let seat = 0; seat < v.grab.length; seat++) {
    const zs = v.grabBy[seat] ?? 0;
    if (!zs || done.has(zs)) continue;
    done.add(zs);
    const zid = zombieEid(w, zs);
    if (zid === undefined) continue;
    let dx = (w.c.Position.x[zid] ?? 0) - v.x;
    let dy = (w.c.Position.y[zid] ?? 0) - v.y;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= l;
    dy /= l;
    physicsVehicleHit(w, zid, v.id, 'stagger', dx, dy, 0.5);
  }
  clearGrabs(v);
}

function zombieEid(w: SimWorld, sid: number): number | undefined {
  for (const eid of sortedQuery(w, 'zombies', [w.c.Zombie]))
    if (w.c.StableId.value[eid] === sid) return eid;
  return undefined;
}
