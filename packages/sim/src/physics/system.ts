import type { SimEvent } from '@deadzone/protocol';
import { bamToRad } from '../core/dmath.js';
import { sortedQuery, type SimWorld } from '../core/world.js';
import { carriedLoad, carryCapacity, playerItems } from '../items/inventory.js';
import type { MovementModifier } from '../systems/movement.js';
import { moveCircle } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import {
  canAct,
  canMove,
  movementModifiers,
  physicsAccelMul,
  physicsSpeedMul,
} from './modifiers.js';
import { crowdPressureSystem, separateZombies } from './crowd.js';
import {
  fallSystem,
  knockbackMove,
  physicsLevelMove,
  stairDomino,
  stairPushSystem,
  startFalls,
} from './stairs.js';
import { applyHit, kill, normalizeAngle, resolveHit, startAttack } from './reactions.js';
import { datan2 } from '../core/dmath.js';
import { addBody, physicsStep } from './step.js';
import type { PhysicsBody, PhysicsEvent, PhysicsHit } from './types.js';
import { floorZ } from '../world/levels.js';
import { isActive, isFrozen, updateActiveWindows, updateFrozen } from './active.js';
import { vaultSystem } from './vault.js';

/**
 * Sim adapter of the physics module: bodies live in `w.physics`, keyed by StableId, one per
 * player and zombie (created at spawn, or lazily for older saves). Pipeline step `physics` runs
 * right after `movement.facing`; combat reports hits through `physicsHit` (resolved at once,
 * stream `rng.physics`), and movement reads `physicsMovementModifier`.
 */

export function bodyOf(w: SimWorld, eid: number): PhysicsBody | undefined {
  return w.physics.bodies.get(w.c.StableId.value[eid] ?? 0);
}

const isZombieEid = (w: SimWorld, eid: number): boolean => w.c.Zombie.is[eid] === 1;
const isPlayerEid = (w: SimWorld, eid: number): boolean =>
  w.players.get(w.c.Player.id[eid] ?? -1) === eid;

/** Creates the body of a player or zombie (zombies draw `gaitSeed` from `rng.physics`). */
export function addPhysicsBody(w: SimWorld, eid: number): PhysicsBody {
  const { Position, Facing, StableId } = w.c;
  return addBody(w.physics, {
    id: StableId.value[eid] ?? 0,
    kind: isZombieEid(w, eid) ? 'zombie' : 'player',
    x: Position.x[eid] ?? 0,
    y: Position.y[eid] ?? 0,
    facing: bamToRad(Facing.angle[eid] ?? 0),
  });
}

function ensureBody(w: SimWorld, eid: number): PhysicsBody | undefined {
  const b = bodyOf(w, eid);
  if (b) return b;
  return isZombieEid(w, eid) || isPlayerEid(w, eid) ? addPhysicsBody(w, eid) : undefined;
}

/** Zombie gait seed (0 before its body exists). */
export function gaitSeedOf(w: SimWorld, eid: number): number {
  return bodyOf(w, eid)?.gaitSeed ?? 0;
}

/** The entity may steer itself (not hit, staggered, down, getting up or dead). */
export function physicsCanMove(w: SimWorld, eid: number): boolean {
  const b = bodyOf(w, eid);
  // Frozen (outside the active chunks): stands still, the AI does not plan its moves.
  return !b || (!isFrozen(b) && canMove(b.state));
}

/** The entity may start an attack or a shove. */
export function physicsCanAct(w: SimWorld, eid: number): boolean {
  const b = bodyOf(w, eid);
  return !b || canAct(b.state);
}

/** Running is allowed (PZ: not while exhausted, endurance level 4). */
export function physicsCanRun(w: SimWorld, eid: number): boolean {
  const b = bodyOf(w, eid);
  return !b || movementModifiers(b, w.physics.cfg).canRun;
}

/** Movement hook: load / endurance on speed, inertia on acceleration, 0 without control. */
export const physicsMovementModifier: MovementModifier = {
  speedMul(w, eid) {
    const b = bodyOf(w, eid);
    // Frozen (outside every active chunk window): does not move.
    return b ? (isFrozen(b) ? 0 : physicsSpeedMul(b, w.physics.cfg)) : 1;
  },
  accelMul(w, eid) {
    const b = bodyOf(w, eid);
    return b ? physicsAccelMul(b, w.physics.cfg) : 1;
  },
  move: physicsLevelMove,
  push(w, eid, out) {
    const b = bodyOf(w, eid);
    if (!b || (!b.pushX && !b.pushY)) return false;
    out.x = b.pushX;
    out.y = b.pushY;
    return true;
  },
};

function emit(w: SimWorld, events: readonly PhysicsEvent[]): void {
  for (const e of events) {
    const ev: Extract<SimEvent, { type: 'physics' }> = {
      type: 'physics',
      tick: e.tick,
      kind: e.type,
      entity: e.entityId,
    };
    if (e.sourceId !== undefined) ev.source = e.sourceId;
    w.events.push(ev);
  }
}

/** Starts the attack / shove animation state of `eid` (`attackStart`); false without control. */
export function physicsBeginAttack(w: SimWorld, eid: number, shove = false): boolean {
  const b = ensureBody(w, eid);
  if (!b) return true;
  const events: PhysicsEvent[] = [];
  const ok = startAttack(b, w.tick, events, shove, w.physics.cfg);
  emit(w, events);
  return ok;
}

/**
 * A hit or shove of `attacker` on `target` (entity ids), resolved now with `rng.physics` (2
 * draws): knock-back, stagger / knockdown, `hitLanded` and friends. `lethal` = combat killed it.
 */
export function physicsHit(
  w: SimWorld,
  attacker: number,
  target: number,
  kind: PhysicsHit['kind'],
  force?: number,
  lethal = false,
  maxReaction?: PhysicsHit['maxReaction'],
): void {
  const a = ensureBody(w, attacker);
  const t = ensureBody(w, target);
  const pw = w.physics;
  const hit: PhysicsHit = {
    attackerId: w.c.StableId.value[attacker] ?? 0,
    targetId: w.c.StableId.value[target] ?? 0,
    kind,
    lethal,
    ...(force === undefined ? {} : { force }),
    ...(maxReaction ? { maxReaction } : {}),
  };
  if (!a || !t) {
    pw.rng.nextU32();
    pw.rng.nextU32();
    return;
  }
  // Fresh positions and facing (movement ran this tick, combat may have turned the zombie).
  for (const [b, eid] of [
    [a, attacker],
    [t, target],
  ] as const) {
    b.x = w.c.Position.x[eid] ?? 0;
    b.y = w.c.Position.y[eid] ?? 0;
    b.facing = bamToRad(w.c.Facing.angle[eid] ?? 0);
  }
  const events: PhysicsEvent[] = [];
  applyHit(t, resolveHit(a, t, hit, pw.rng, pw.cfg), hit, w.tick, events, pw.cfg);
  if (t.stair) stairDomino(w, t, events);
  emit(w, events);
}

/**
 * A vehicle (`vehicleId` = StableId) rammed or ran over entity `target`: the reaction is decided
 * by the car (`vehicles/ram.ts`, speed thresholds), not rolled. (dirX, dirY) = unit push
 * direction (from the car to the body), `impulse` 0..1 scales the knock-back. Draws exactly one
 * value from `rng.physics` (knock-down length), whatever the outcome. `lethal`: state `dead`.
 * Returns the body (undefined for entities without one, e.g. animals).
 */
export function physicsVehicleHit(
  w: SimWorld,
  target: number,
  vehicleId: number,
  reaction: 'stagger' | 'knockdown',
  dirX: number,
  dirY: number,
  impulse: number,
  lethal = false,
): PhysicsBody | undefined {
  const pw = w.physics;
  const t = ensureBody(w, target);
  const kd =
    t?.kind === 'zombie' ? pw.cfg.durations.knockdownZombie : pw.cfg.durations.knockdownPlayer;
  const kdTicks = pw.rng.int(kd.min, kd.max);
  if (!t) return undefined;
  t.x = w.c.Position.x[target] ?? 0;
  t.y = w.c.Position.y[target] ?? 0;
  t.facing = bamToRad(w.c.Facing.angle[target] ?? 0);
  const imp = Math.fround(Math.max(0, Math.min(1, impulse)));
  const d = pw.cfg.durations;
  const events: PhysicsEvent[] = [];
  applyHit(
    t,
    {
      reaction,
      impulse: imp,
      behind: false,
      dirX: Math.fround(dirX),
      dirY: Math.fround(dirY),
      hitFromDir: Math.fround(normalizeAngle(datan2(-dirY, -dirX))),
      duration:
        reaction === 'knockdown' ? kdTicks : d.staggerBase + Math.round(imp * d.staggerPerImpulse),
    },
    { attackerId: vehicleId, targetId: t.id, kind: 'vehicle', lethal },
    w.tick,
    events,
    pw.cfg,
  );
  if (t.stair) stairDomino(w, t, events);
  emit(w, events);
  return t;
}

const eidBySid = new Map<number, number>();

/**
 * Pipeline `physics` (after `movement.facing`): syncs bodies from the ECS (position, facing,
 * velocity, load, endurance, deaths), runs `physicsStep` (timers, knock-back slide with
 * `moveCircle`, idle / walk / run) and writes slid positions back; falls (start, free fall,
 * landing) and pushes up stairs on maps with levels (`stairs.ts`); then zombies in a crowd push
 * each other apart and crowd pressure works on closed doors / windows / fences (`crowd.ts`).
 */
export function physicsSystem(w: SimWorld, grid: TileGrid): void {
  const pw = w.physics;
  const { Position, Facing, Velocity, StableId, Zombie, Collider } = w.c;
  const s = w.survival;
  const st = w.items;
  const events: PhysicsEvent[] = [];
  eidBySid.clear();
  updateActiveWindows(w);
  for (const eid of sortedQuery(w, 'render', [Position, Facing])) {
    const b = ensureBody(w, eid);
    if (!b) continue;
    if (!updateFrozen(b, isActive(Position.x[eid] ?? 0, Position.y[eid] ?? 0), w.tick)) {
      // Frozen: only deaths are synced (no timers, slide, crowd, stairs or falls).
      if (b.kind === 'zombie' && (Zombie.hp[eid] ?? 0) <= 0) kill(b, w.tick, events);
      continue;
    }
    eidBySid.set(StableId.value[eid] ?? 0, eid);
    b.x = Position.x[eid] ?? 0;
    b.y = Position.y[eid] ?? 0;
    b.facing = bamToRad(Facing.angle[eid] ?? 0);
    if (canMove(b.state)) {
      b.vel.x = Velocity.x[eid] ?? 0;
      b.vel.y = Velocity.y[eid] ?? 0;
    }
    if (b.kind === 'zombie') {
      if ((Zombie.hp[eid] ?? 0) <= 0) kill(b, w.tick, events);
    } else if (s) {
      b.endurance = s.vitals.endurance[eid] ?? 100;
      if (s.dead[eid]) kill(b, w.tick, events);
      const p = st ? playerItems(w, eid) : undefined;
      if (st && p) {
        b.carriedKg = Math.fround(carriedLoad(st, p));
        b.capacityKg = Math.fround(carryCapacity(w, eid));
      }
    }
  }
  // Falls land before the state timers run (landing → knock-down this tick).
  if (pw.multiLevel) fallSystem(w, eidBySid, events);
  vaultSystem(w, eidBySid, events);
  events.push(
    ...physicsStep(pw, {
      tick: w.tick,
      collide(b, dx, dy, out) {
        const eid = eidBySid.get(b.id);
        if (eid === undefined) {
          out.x = b.x + dx;
          out.y = b.y + dy;
          return;
        }
        if (pw.multiLevel || b.stair) knockbackMove(w, grid, eid, b, dx, dy, out);
        else moveCircle(grid, floorZ(w, eid), b.x, b.y, dx, dy, Collider.radius[eid] ?? 0, out);
      },
    }),
  );
  for (const [sid, eid] of eidBySid) {
    const b = pw.bodies.get(sid)!;
    if (canMove(b.state)) continue;
    Position.x[eid] = b.x;
    Position.y[eid] = b.y;
  }
  if (pw.multiLevel) startFalls(w, grid, eidBySid, events);
  emit(w, events);
  separateZombies(w);
  crowdPressureSystem(w, grid);
  stairPushSystem(w, eidBySid, (z, p, force) => physicsHit(w, z, p, 'zombie', force));
}
