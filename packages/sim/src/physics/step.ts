import { HashWriter } from '../core/hash.js';
import type { Rng } from '../core/rng.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { canMove, movementModifiers, stepVelocity, totalMass } from './modifiers.js';
import { advanceState, applyHit, resolveHit } from './reactions.js';
import {
  PHYSICS_STATES,
  type PhysicsBody,
  type PhysicsEntityKind,
  type PhysicsEvent,
  type PhysicsHit,
  type PhysicsIntent,
  type PhysicsSnapshotFields,
  type PhysicsWorld,
} from './types.js';

/**
 * `rng` should be a dedicated stream (e.g. `rngFor(seed, 'physics')`), so physics rolls never
 * shift other systems.
 */
export function createPhysicsWorld(
  rng: Rng,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): PhysicsWorld {
  return {
    cfg,
    rng,
    bodies: new Map(),
    order: [],
    orderSize: -1,
    presses: new Map(),
    pressure: new Map(),
    stairs: [],
    multiLevel: false,
  };
}

export interface BodyInit {
  id: number;
  kind: PhysicsEntityKind;
  x: number;
  y: number;
  facing?: number;
  bodyMassKg?: number;
  carriedKg?: number;
  capacityKg?: number;
  endurance?: number;
  strength?: number;
}

/**
 * Adds a body. Zombies draw their `gaitSeed` (one u32) from the world RNG here, so spawn order
 * defines it and it never changes afterwards.
 */
export function addBody(pw: PhysicsWorld, init: BodyInit): PhysicsBody {
  if (pw.bodies.has(init.id)) throw new Error(`physics body ${init.id} exists`);
  const bodyMassKg = init.bodyMassKg ?? pw.cfg.bodyMassKg[init.kind];
  const carriedKg = init.carriedKg ?? 0;
  const b: PhysicsBody = {
    id: init.id,
    kind: init.kind,
    x: Math.fround(init.x),
    y: Math.fround(init.y),
    facing: Math.fround(init.facing ?? 0),
    vel: { x: 0, y: 0 },
    maxSpeed: 0,
    accel: 0,
    mass: totalMass(bodyMassKg, carriedKg),
    state: 'idle',
    stateStartTick: 0,
    stateDuration: 0,
    knockback: { dirX: 0, dirY: 0, strength: 0 },
    lastHitTick: 0,
    hitFromDir: 0,
    gaitSeed: init.kind === 'zombie' ? pw.rng.nextU32() : 0,
    bodyMassKg,
    carriedKg,
    capacityKg: init.capacityKg ?? 12,
    endurance: init.endurance ?? 100,
    strength: init.strength ?? 5,
    pushX: 0,
    pushY: 0,
    stair: 0,
    fallFromZ: 0,
    fallToZ: 0,
    vaultFromX: 0,
    vaultFromY: 0,
    vaultToX: 0,
    vaultToY: 0,
    vaultTrip: 0,
    vaultGlass: 0,
  };
  pw.bodies.set(b.id, b);
  updateMovementStats(b, pw.cfg);
  return b;
}

export function removeBody(pw: PhysicsWorld, id: number): void {
  pw.bodies.delete(id);
  pw.orderSize = -1;
}

/** Bodies in `id` (StableId) order. */
export function sortedBodies(pw: PhysicsWorld): readonly PhysicsBody[] {
  if (pw.orderSize !== pw.bodies.size) {
    pw.order = [...pw.bodies.values()].sort((a, b) => a.id - b.id);
    pw.orderSize = pw.bodies.size;
  }
  return pw.order;
}

/** Recomputes `mass`, `maxSpeed` and `accel` from the inputs (load, endurance, state). */
export function updateMovementStats(
  b: PhysicsBody,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
  run = b.state === 'run',
): void {
  b.mass = totalMass(b.bodyMassKg, b.carriedKg);
  if (!canMove(b.state)) {
    b.maxSpeed = 0;
    b.accel = 0;
    return;
  }
  const m = movementModifiers(b, cfg);
  const s = cfg.speed;
  const zombie = b.kind === 'zombie';
  const running = run && m.canRun;
  const base = zombie ? (running ? s.zombieRun : s.zombieWalk) : running ? s.run : s.walk;
  b.maxSpeed = Math.fround(base * m.speedMul);
  b.accel = Math.fround((b.maxSpeed / cfg.accelTicks) * m.accelMul);
}

export interface PhysicsStepInput {
  tick: number;
  /** Hits and shoves landed this tick, resolved in this order (caller keeps it deterministic). */
  hits?: readonly PhysicsHit[];
  /**
   * Standalone mode: held movement per body id. Bodies with an intent get their velocity
   * integrated here (inertia, load, endurance) and are moved. Bodies without one keep the `vel`
   * the caller wrote (the movement system already moved them).
   */
  intents?: ReadonlyMap<number, PhysicsIntent>;
  /**
   * Moves a body by (dx, dy) with collisions and writes the result into `out` (e.g. via
   * `moveCircle` from `world/collision.ts`). Default: no collisions.
   */
  collide?: (b: PhysicsBody, dx: number, dy: number, out: { x: number; y: number }) => void;
}

const pos = { x: 0, y: 0 };

/**
 * One physics tick, meant to run after `movement` in the pipeline: timed states end, hits are
 * resolved (seeded RNG), then velocity and position are updated (control: intent with inertia;
 * no control: knock-back slide with friction) and the locomotion state (idle / walk / run) is
 * derived from the speed. Returns the events of this tick in order.
 */
export function physicsStep(pw: PhysicsWorld, input: PhysicsStepInput): PhysicsEvent[] {
  const { tick } = input;
  const cfg = pw.cfg;
  const events: PhysicsEvent[] = [];
  const bodies = sortedBodies(pw);
  for (const b of bodies) advanceState(b, tick, events, cfg);

  for (const hit of input.hits ?? []) {
    const attacker = pw.bodies.get(hit.attackerId);
    const target = pw.bodies.get(hit.targetId);
    if (!attacker || !target) {
      // Keep the RNG stream aligned with the hit list even for unknown ids.
      pw.rng.nextFloat();
      pw.rng.nextFloat();
      continue;
    }
    const out = resolveHit(attacker, target, hit, pw.rng, cfg);
    applyHit(target, out, hit, tick, events, cfg);
  }

  for (const b of bodies) {
    if (b.state === 'dead') {
      b.vel = { x: 0, y: 0 };
      b.maxSpeed = 0;
      b.accel = 0;
      continue;
    }
    const intent = input.intents?.get(b.id);
    if (canMove(b.state)) {
      updateMovementStats(b, cfg, intent ? intent.run === true : b.state === 'run');
      if (!intent) {
        classify(b, tick, cfg);
        continue;
      }
      const tx = intent.dx * b.maxSpeed;
      const ty = intent.dy * b.maxSpeed;
      const m = movementModifiers(b, cfg);
      const brake = Math.fround((b.maxSpeed / cfg.brakeTicks) * m.accelMul);
      stepVelocity(b.vel, tx, ty, b.accel, brake);
      move(b, input);
      classify(b, tick, cfg);
    } else {
      updateMovementStats(b, cfg);
      if (b.vel.x !== 0 || b.vel.y !== 0) {
        move(b, input);
        const f = cfg.knockback.friction;
        b.vel.x = Math.fround(b.vel.x * f);
        b.vel.y = Math.fround(b.vel.y * f);
        const sp = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
        if (sp < cfg.knockback.stopSpeed) b.vel = { x: 0, y: 0 };
      }
    }
  }
  return events;
}

function move(b: PhysicsBody, input: PhysicsStepInput): void {
  if (b.vel.x === 0 && b.vel.y === 0) return;
  if (input.collide) {
    input.collide(b, b.vel.x, b.vel.y, pos);
  } else {
    pos.x = b.x + b.vel.x;
    pos.y = b.y + b.vel.y;
  }
  b.x = Math.fround(pos.x);
  b.y = Math.fround(pos.y);
}

/**
 * idle / walk / run from the speed, `climb` on a flight of stairs (attack / push keep their
 * state until they end).
 */
function classify(b: PhysicsBody, tick: number, cfg: PhysicsConfig): void {
  if (b.state !== 'idle' && b.state !== 'walk' && b.state !== 'run' && b.state !== 'climb') return;
  const sp = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  const walk = b.kind === 'zombie' ? cfg.speed.zombieWalk : cfg.speed.walk;
  const next =
    b.stair > 0
      ? 'climb'
      : sp < cfg.idleSpeed
        ? 'idle'
        : sp > walk * cfg.runStateAtWalkMul
          ? 'run'
          : 'walk';
  if (next !== b.state) {
    b.state = next;
    b.stateStartTick = tick;
    b.stateDuration = 0;
  }
}

/** Client-facing fields of a body (copy). */
export function toSnapshotFields(b: PhysicsBody): PhysicsSnapshotFields {
  return {
    facing: b.facing,
    vel: { x: b.vel.x, y: b.vel.y },
    maxSpeed: b.maxSpeed,
    state: b.state,
    stateStartTick: b.stateStartTick,
    stateDuration: b.stateDuration,
    knockback: { ...b.knockback },
    lastHitTick: b.lastHitTick,
    hitFromDir: b.hitFromDir,
    gaitSeed: b.gaitSeed,
  };
}

/** Writes all bodies (id order) into `h` (sim state hash). */
export function writePhysicsHash(pw: PhysicsWorld, h: HashWriter): void {
  const bodies = sortedBodies(pw);
  h.u32(bodies.length);
  for (const b of bodies) {
    h.u32(b.id)
      .u32(b.kind === 'zombie' ? 1 : 0)
      .f32(b.x)
      .f32(b.y)
      .f32(b.facing);
    h.f32(b.vel.x).f32(b.vel.y).f32(b.maxSpeed).f32(b.accel).f32(b.mass);
    h.u32(PHYSICS_STATES.indexOf(b.state)).u32(b.stateStartTick).u32(b.stateDuration);
    h.f32(b.knockback.dirX).f32(b.knockback.dirY).f32(b.knockback.strength);
    h.u32(b.lastHitTick).f32(b.hitFromDir).u32(b.gaitSeed);
    h.f32(b.carriedKg).f32(b.capacityKg).f32(b.endurance).f32(b.strength);
    // Level state only when used (single-level worlds keep their hashes).
    if (b.stair || b.state === 'fall') h.u32(b.stair).f32(b.fallFromZ).f32(b.fallToZ);
    if (b.state === 'vault') {
      h.f32(b.vaultFromX).f32(b.vaultFromY).f32(b.vaultToX).f32(b.vaultToY);
      h.f32(b.vaultTrip).u32(b.vaultGlass);
    }
  }
}

/** xxhash32 of all bodies and the RNG state; equal hashes = identical physics. */
export function physicsHash(pw: PhysicsWorld): number {
  const h = new HashWriter();
  for (const v of pw.rng.state()) h.u32(v);
  writePhysicsHash(pw, h);
  return h.digest();
}
