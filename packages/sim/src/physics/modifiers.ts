import {
  DEFAULT_PHYSICS_CONFIG,
  ENDURANCE_ACCEL_MUL,
  ENDURANCE_NO_RUN_LEVEL,
  ENDURANCE_SPEED_MUL,
  ENDURANCE_THRESHOLDS,
  LOAD_ACCEL_MUL,
  LOAD_SPEED_MUL,
  LOAD_THRESHOLDS_PCT,
  type PhysicsConfig,
} from './constants.js';
import type { MovementModifiers, PhysicsBody, PhysicsState } from './types.js';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Body + carried weight (kg). */
export function totalMass(bodyMassKg: number, carriedKg: number): number {
  return Math.fround(Math.max(1, bodyMassKg) + Math.max(0, carriedKg));
}

/** Inertia: refMass / mass, clamped. 1 at the reference mass, < 1 when heavier. */
export function inertiaMul(mass: number, cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG): number {
  return Math.fround(
    clamp(cfg.refMassKg / Math.max(1, mass), cfg.inertiaMul.min, cfg.inertiaMul.max),
  );
}

/** Load level 0..4: carried / capacity above 100 / 125 / 150 / 175 % (PZ heavy load). */
export function loadLevel(carriedKg: number, capacityKg: number): number {
  if (carriedKg <= 0) return 0;
  const pct = capacityKg > 0 ? (carriedKg / capacityKg) * 100 : Infinity;
  let level = 0;
  for (const t of LOAD_THRESHOLDS_PCT) if (pct > t) level++;
  return level;
}

/** Endurance level 0..4: endurance (0..100) below 75 / 50 / 25 / 10 (PZ exertion). */
export function enduranceLevel(endurance: number): number {
  let level = 0;
  for (const t of ENDURANCE_THRESHOLDS) if (endurance < t) level++;
  return level;
}

/** Load and endurance multipliers for maxSpeed and accel, plus mass inertia on accel. */
export function movementModifiers(
  b: Pick<PhysicsBody, 'bodyMassKg' | 'carriedKg' | 'capacityKg' | 'endurance'>,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): MovementModifiers {
  const ll = loadLevel(b.carriedKg, b.capacityKg);
  const el = enduranceLevel(b.endurance);
  const inertia = inertiaMul(totalMass(b.bodyMassKg, b.carriedKg), cfg);
  return {
    loadLevel: ll,
    enduranceLevel: el,
    speedMul: Math.fround(LOAD_SPEED_MUL[ll]! * ENDURANCE_SPEED_MUL[el]!),
    accelMul: Math.fround(inertia * LOAD_ACCEL_MUL[ll]! * ENDURANCE_ACCEL_MUL[el]!),
    canRun: el < ENDURANCE_NO_RUN_LEVEL,
  };
}

/** The entity may steer itself (movement owns its velocity). */
export function canMove(state: PhysicsState): boolean {
  return (
    state === 'idle' ||
    state === 'walk' ||
    state === 'run' ||
    state === 'climb' ||
    state === 'attack' ||
    state === 'push'
  );
}

/** The body lost control (hit, stagger, knockdown, getup, dead): no steering, no attacks. */
export function controlLost(state: PhysicsState): boolean {
  return (
    state === 'hit' ||
    state === 'stagger' ||
    state === 'knockdown' ||
    state === 'getup' ||
    state === 'fall' ||
    state === 'dead'
  );
}

/**
 * The entity may start an attack, a shove or a vault (also restarting an attack that is still
 * playing). Not while vaulting or sitting in a vehicle.
 */
export function canAct(state: PhysicsState): boolean {
  return !controlLost(state) && state !== 'vault' && state !== 'driving';
}

/**
 * Multiplier for movement's target speed (plug into `MovementModifier.speedMul` of the movement
 * system): load × endurance, 0 while the body has no control (hit, stagger, knockdown, getup,
 * dead).
 */
export function physicsSpeedMul(
  body: PhysicsBody,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): number {
  return canMove(body.state) ? movementModifiers(body, cfg).speedMul : 0;
}

/** Multiplier for movement's accel / brake step (`MovementModifier.accelMul`); 0 without control. */
export function physicsAccelMul(
  body: PhysicsBody,
  cfg: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
): number {
  return canMove(body.state) ? movementModifiers(body, cfg).accelMul : 0;
}

/**
 * Moves velocity `vel` towards (tx, ty) by at most `accel` when speeding up or `brake` when slowing
 * down or turning against the motion (all tiles per tick). Mutates and returns `vel`.
 */
export function stepVelocity(
  vel: { x: number; y: number },
  tx: number,
  ty: number,
  accel: number,
  brake: number,
): { x: number; y: number } {
  const dx = tx - vel.x;
  const dy = ty - vel.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const speeding = tx * tx + ty * ty >= vel.x * vel.x + vel.y * vel.y;
  const step = speeding ? accel : brake;
  // Epsilon: f32 rounding must not leave a residue step (e.g. 3 × max/3 < max).
  if (len <= step + 1e-7 || len === 0) {
    vel.x = Math.fround(tx);
    vel.y = Math.fround(ty);
  } else {
    vel.x = Math.fround(vel.x + (dx * step) / len);
    vel.y = Math.fround(vel.y + (dy * step) / len);
  }
  return vel;
}
