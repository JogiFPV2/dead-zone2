import type { VehicleImpactTarget } from '@deadzone/protocol';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import type { VehicleTypeDef } from '../content/adapter.js';
import { isLiveAnimal } from '../animals/state.js';
import { damageOpening } from '../openings/actions.js';
import { OpeningKind, openingKey } from '../openings/state.js';
import { moveCircle } from '../world/collision.js';
import { playerEidOf } from './seats.js';
import { collideFurniture } from './furniture-hit.js';
import { gateAlways, type TileGrid } from '../world/grid.js';
import type { VehicleConfig } from './config.js';
import {
  circleVsObb,
  obbExtent,
  obbOf,
  obbVsEdge,
  obbVsObb,
  obbVsSegment,
  zoneAt,
  type Mtv,
} from './geometry.js';
import type { Vehicle } from './types.js';

/** One contact of this tick (events, damage in PR B). `n` points from the obstacle into the car. */
export interface Impact {
  vehicle: Vehicle;
  targetKind: VehicleImpactTarget;
  /** StableId of the body / vehicle hit (0 = wall, fence). */
  target: number;
  /** Entity of the body hit (−1 otherwise). */
  eid: number;
  /** Kinetic energy lost (J) and the closing speed along the normal (m/s, ≥ 0). */
  energy: number;
  closing: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Zone of the car hit (front 0, rear 1, left 2, right 3). */
  zone: number;
}

const f = Math.fround;

/** Removes the closing part of the car velocity along n (bounce `e`); returns the closing speed. */
function bounce(v: Vehicle, n: Mtv, e: number): number {
  const vn = v.vx * n.nx + v.vy * n.ny;
  if (vn >= 0) return 0;
  v.vx = f(v.vx - (1 + e) * vn * n.nx);
  v.vy = f(v.vy - (1 + e) * vn * n.ny);
  return -vn;
}

/**
 * Walls, closed doors / windows and standing fences around the car (tile edges under its
 * bounds). A standing fence hit faster than `fenceBreakSpeed` (a thin partition wall:
 * `partitionBreakSpeed`) is knocked over (`openingChanged`
 * by `vehicle`) and only slows the car; everything else stops it (pushed out, normal velocity
 * bounced with `restitution`).
 */
function collideStatic(
  w: SimWorld,
  grid: TileGrid,
  v: Vehicle,
  t: VehicleTypeDef,
  cfg: VehicleConfig,
  out: Impact[],
): boolean {
  const o = obbOf(v, t);
  const { ex, ey } = obbExtent(o);
  const z = Math.floor(v.z);
  let hit = false;
  for (let side = 0; side < 2; side++) {
    const n = side === 0;
    const tx0 = n ? Math.floor(v.x - ex) : Math.ceil(v.x - ex);
    const tx1 = Math.floor(v.x + ex);
    const ty0 = n ? Math.ceil(v.y - ey) : Math.floor(v.y - ey);
    const ty1 = Math.floor(v.y + ey);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!(n ? grid.hasWallN(tx, ty, z) : grid.hasWallW(tx, ty, z))) continue;
        const m = obbVsEdge(obbOf(v, t), tx, ty, n);
        if (!m) continue;
        const kind = grid.kindOf(n ? grid.edgeN(tx, ty, z) : grid.edgeW(tx, ty, z));
        const fence = kind === OpeningKind.fence;
        const partition = kind === OpeningKind.partition;
        const breakSpeed = partition ? cfg.partitionBreakSpeed : cfg.fenceBreakSpeed;
        const slowFrac = partition ? cfg.partitionSlow : cfg.fenceSlow;
        const cx = n ? Math.max(tx, Math.min(tx + 1, v.x)) : tx;
        const cy = n ? ty : Math.max(ty, Math.min(ty + 1, v.y));
        const vn = -(v.vx * m.nx + v.vy * m.ny);
        if ((fence || partition) && vn > breakSpeed) {
          const driver = v.occupants[0] ? playerEidOf(w, v.occupants[0]) : undefined;
          damageOpening(w, openingKey(side, tx, ty, z), kind, 1e9, 'vehicle', driver);
          v.vx = f(v.vx + vn * slowFrac * m.nx);
          v.vy = f(v.vy + vn * slowFrac * m.ny);
          const lost = vn * slowFrac;
          const energy = 0.5 * t.mass * (vn * vn - (vn - lost) * (vn - lost));
          out.push(impact(v, o, fence ? 'fence' : 'wall', 0, -1, energy, vn, cx, cy, m));
          continue;
        }
        v.x = f(v.x + m.nx * m.depth);
        v.y = f(v.y + m.ny * m.depth);
        const closing = bounce(v, m, cfg.restitution);
        if (closing > 0) {
          const e = cfg.restitution;
          if (closing > 1) v.angVel = f(v.angVel * 0.6);
          const energy = 0.5 * t.mass * closing * closing * (1 - e * e);
          out.push(impact(v, o, fence ? 'fence' : 'wall', 0, -1, energy, closing, cx, cy, m));
        }
        hit = true;
      }
    }
  }
  // Pylon / mast feet (`SimChunk.blockers`) and exact walls (`SimChunk.wallSegments`).
  const solid = (m: Mtv | undefined, cx: number, cy: number): void => {
    if (!m) return;
    v.x = f(v.x + m.nx * m.depth);
    v.y = f(v.y + m.ny * m.depth);
    const closing = bounce(v, m, cfg.restitution);
    if (closing > 0) {
      const e = cfg.restitution;
      if (closing > 1) v.angVel = f(v.angVel * 0.6);
      const energy = 0.5 * t.mass * closing * closing * (1 - e * e);
      out.push(impact(v, o, 'wall', 0, -1, energy, closing, cx, cy, m));
    }
    hit = true;
  };
  grid.forBlockers(v.x - ex, v.y - ey, v.x + ex, v.y + ey, z, (_k, x0, x1, y0, y1) => {
    const b = {
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      hx: 1,
      hy: 0,
      hl: (x1 - x0) / 2,
      hw: (y1 - y0) / 2,
    };
    solid(obbVsObb(b, obbOf(v, t)), b.x, b.y);
  });
  grid.forSegments(
    v.x - ex,
    v.y - ey,
    v.x + ex,
    v.y + ey,
    z,
    (_k, ax, ay, bx, by) =>
      solid(obbVsSegment(obbOf(v, t), ax, ay, bx, by), (ax + bx) / 2, (ay + by) / 2),
    gateAlways,
  );
  return hit;
}

function impact(
  v: Vehicle,
  o: ReturnType<typeof obbOf>,
  targetKind: VehicleImpactTarget,
  target: number,
  eid: number,
  energy: number,
  closing: number,
  x: number,
  y: number,
  n: Mtv,
): Impact {
  return {
    vehicle: v,
    targetKind,
    target,
    eid,
    energy: f(energy),
    closing: f(closing),
    x: f(x),
    y: f(y),
    nx: f(n.nx),
    ny: f(n.ny),
    zone: zoneAt(o, x, y),
  };
}

/** A lying body (knocked down, getting up, dead, a corpse) the car rolls over this tick. */
export interface UnderBody {
  vehicle: Vehicle;
  eid: number;
  sid: number;
  zombie: boolean;
  /** Alive but on the ground (knockdown / getup): can be crushed. */
  down: boolean;
  x: number;
  y: number;
}

/**
 * Players, zombies and animals (circles) against the car: a standing body is pushed out (with
 * its own wall collision), the car loses momentum by the mass ratio. Lying bodies are not pushed
 * (the car rolls over them, `under`). Occupants are skipped.
 */
function collideBodies(
  w: SimWorld,
  grid: TileGrid,
  v: Vehicle,
  t: VehicleTypeDef,
  cfg: VehicleConfig,
  out: Impact[],
  seen: Set<number>,
  under: UnderBody[],
  touching: number[],
): void {
  const { Position, Collider, Velocity, StableId, Zombie } = w.c;
  const o = obbOf(v, t);
  const reach = o.hl + 1;
  const tmp = { x: 0, y: 0 };
  for (const eid of sortedQuery(w, 'render', [Position, w.c.Facing])) {
    const px = Position.x[eid] ?? 0;
    const py = Position.y[eid] ?? 0;
    if (Math.abs(px - v.x) > reach || Math.abs(py - v.y) > reach) continue;
    if (Math.floor(Position.z[eid] ?? 0) !== Math.floor(v.z)) continue;
    const sid = StableId.value[eid] ?? 0;
    const b = w.physics.bodies.get(sid);
    if (b && b.state === 'driving') continue;
    const zombie = Zombie.is[eid] === 1;
    const animal = w.c.Animal.is[eid] === 1;
    const dead =
      (b !== undefined && b.state === 'dead') ||
      (zombie && (Zombie.hp[eid] ?? 0) <= 0) ||
      (animal && !isLiveAnimal(w, eid)) ||
      // A zombie corpse (Zombie component removed) keeps its body in state `dead`.
      (!zombie && !animal && b?.kind === 'zombie');
    const down = !dead && b !== undefined && (b.state === 'knockdown' || b.state === 'getup');
    const r = Collider.radius[eid] ?? 0.3;
    if (dead || down) {
      if (seen.has(sid) || !circleVsObb(o, px, py, Math.min(r, 0.25))) continue;
      seen.add(sid);
      under.push({
        vehicle: v,
        eid,
        sid,
        zombie: zombie || b?.kind === 'zombie',
        down,
        x: px,
        y: py,
      });
      continue;
    }
    const m = circleVsObb(obbOf(v, t), px, py, r);
    if (!m) continue;
    const mb = b?.mass ?? cfg.bodyMassKg;
    const M = t.mass;
    // Relative velocity at the contact (car velocity incl. rotation minus the body's).
    const rx = m.cx - v.x;
    const ry = m.cy - v.y;
    const cvx = v.vx - v.angVel * ry;
    const cvy = v.vy + v.angVel * rx;
    const bvx = (Velocity.x[eid] ?? 0) * TICKS_PER_SECOND;
    const bvy = (Velocity.y[eid] ?? 0) * TICKS_PER_SECOND;
    const vrel = (cvx - bvx) * m.nx + (cvy - bvy) * m.ny;
    // Push the body out (it takes most of it), the car takes what the body could not move.
    const share = (m.depth * M) / (M + mb);
    moveCircle(grid, Math.floor(v.z), px, py, m.nx * share, m.ny * share, r, tmp);
    Position.x[eid] = tmp.x;
    Position.y[eid] = tmp.y;
    const moved = (tmp.x - px) * m.nx + (tmp.y - py) * m.ny;
    const rest = m.depth - moved;
    v.x = f(v.x - m.nx * rest);
    v.y = f(v.y - m.ny * rest);
    if (touching.includes(sid)) continue;
    touching.push(sid);
    if (v.contacts.includes(sid)) {
      // Still in contact since last tick: shoved along, the car pays a plough drag.
      const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
      if (sp > 0.05 && vrel > 0) {
        const k = Math.max(0, sp - cfg.plowDecel / TICKS_PER_SECOND) / sp;
        v.vx = f(v.vx * k);
        v.vy = f(v.vy * k);
      }
      continue;
    }
    if (vrel <= 0) continue;
    const e = cfg.restitution;
    const j = ((1 + e) * vrel) / (1 / M + 1 / mb);
    v.vx = f(v.vx - (j / M) * m.nx);
    v.vy = f(v.vy - (j / M) * m.ny);
    if (seen.has(sid)) continue;
    seen.add(sid);
    const kind: VehicleImpactTarget = zombie ? 'zombie' : animal ? 'animal' : 'player';
    const energy = 0.5 * ((M * mb) / (M + mb)) * vrel * vrel * (1 - e * e);
    // Normal into the car = from the body to the car.
    const into = { depth: m.depth, nx: -m.nx, ny: -m.ny };
    out.push(impact(v, o, kind, sid, eid, energy, vrel, m.cx, m.cy, into));
  }
}

/** Car against other cars (SAT boxes): pushed apart by mass, momentum exchanged along n. */
function collideVehicles(
  w: SimWorld,
  v: Vehicle,
  t: VehicleTypeDef,
  types: readonly VehicleTypeDef[],
  cfg: VehicleConfig,
  out: Impact[],
): void {
  for (const u of w.physics.vehicles.values()) {
    if (u === v || Math.floor(u.z) !== Math.floor(v.z)) continue;
    const tu = types[u.type]!;
    if (Math.abs(u.x - v.x) > (t.length + tu.length) / 2 + 0.5) continue;
    if (Math.abs(u.y - v.y) > (t.length + tu.length) / 2 + 0.5) continue;
    const m = obbVsObb(obbOf(v, t), obbOf(u, tu));
    if (!m) continue;
    const M = t.mass;
    const Mu = u.frozenAt >= 0 ? Infinity : tu.mass;
    const wv = Mu === Infinity ? 1 : Mu / (M + Mu);
    v.x = f(v.x - m.nx * m.depth * wv);
    v.y = f(v.y - m.ny * m.depth * wv);
    if (Mu !== Infinity) {
      u.x = f(u.x + m.nx * m.depth * (1 - wv));
      u.y = f(u.y + m.ny * m.depth * (1 - wv));
    }
    const vrel = (v.vx - u.vx) * m.nx + (v.vy - u.vy) * m.ny;
    if (vrel <= 0) continue;
    const e = cfg.restitution;
    const inv = 1 / M + (Mu === Infinity ? 0 : 1 / Mu);
    const j = ((1 + e) * vrel) / inv;
    v.vx = f(v.vx - (j / M) * m.nx);
    v.vy = f(v.vy - (j / M) * m.ny);
    if (Mu !== Infinity) {
      u.vx = f(u.vx + (j / Mu) * m.nx);
      u.vy = f(u.vy + (j / Mu) * m.ny);
    }
    const mu = Mu === Infinity ? M : (M * Mu) / (M + Mu);
    const energy = 0.5 * mu * vrel * vrel * (1 - e * e);
    const cx = (v.x + u.x) / 2;
    const cy = (v.y + u.y) / 2;
    out.push(
      impact(v, obbOf(v, t), 'vehicle', u.id, -1, energy, vrel, cx, cy, {
        depth: m.depth,
        nx: -m.nx,
        ny: -m.ny,
      }),
    );
    out.push(impact(u, obbOf(u, tu), 'vehicle', v.id, -1, energy, vrel, cx, cy, m));
  }
}

/**
 * All collisions of `v` this tick (a few passes for corners); contacts go to `out`, lying bodies
 * under the car to `under`.
 */
export function collideVehicle(
  w: SimWorld,
  grid: TileGrid,
  v: Vehicle,
  types: readonly VehicleTypeDef[],
  cfg: VehicleConfig,
  out: Impact[],
  under: UnderBody[],
): void {
  const t = types[v.type]!;
  const seen = new Set<number>();
  const touching: number[] = [];
  collideBodies(w, grid, v, t, cfg, out, seen, under, touching);
  v.contacts = touching.sort((a, b) => a - b);
  collideVehicles(w, v, t, types, cfg, out);
  for (let pass = 0; pass < cfg.passes; pass++) {
    const walls = collideStatic(w, grid, v, t, cfg, out);
    if (!collideFurniture(w, v, t, cfg, out) && !walls) break;
  }
}
