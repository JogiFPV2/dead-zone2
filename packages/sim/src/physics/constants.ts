import { TICKS_PER_SECOND, WALK_SPEED_TILES_PER_SECOND } from '../core/constants.js';

/**
 * All physics tuning in one place (`physics/*`). Values follow Project Zomboid where it has a
 * clear rule (load and endurance thresholds, knock-down from behind, zombies lying a few seconds
 * and getting up); the rest is first-pass balance. Durations are in ticks (20 Hz), speeds in
 * tiles per tick, masses in kg. Later this can move to `worldSettings.physics` like
 * `DEFAULT_COMBAT_CONFIG`.
 */

/** Ticks per second (re-exported so physics never assumes another rate). */
export const PHYS_TICKS_PER_SECOND = TICKS_PER_SECOND;

const perTick = (tilesPerSec: number): number => Math.fround(tilesPerSec / TICKS_PER_SECOND);
const sec = (s: number): number => Math.round(s * TICKS_PER_SECOND);

/**
 * Load levels like the PZ "Heavy Load" moodle (and `base:heavy-load`): carried weight / capacity
 * in % enters level 1 above 100 %, then 125 / 150 / 175 %. Index = level 0..4.
 */
export const LOAD_THRESHOLDS_PCT = [100, 125, 150, 175] as const;
/** maxSpeed × this per load level (same steps as the `base:heavy-load` moodle). */
export const LOAD_SPEED_MUL = [1, 0.9, 0.8, 0.65, 0.5] as const;
/** accel / brake × this per load level (on top of the mass inertia). */
export const LOAD_ACCEL_MUL = [1, 0.85, 0.7, 0.55, 0.4] as const;

/**
 * Endurance levels like the PZ exertion moodle: endurance 0..100 below 75 / 50 / 25 / 10 gives
 * level 1..4. Index = level 0..4.
 */
export const ENDURANCE_THRESHOLDS = [75, 50, 25, 10] as const;
export const ENDURANCE_SPEED_MUL = [1, 0.95, 0.85, 0.7, 0.55] as const;
export const ENDURANCE_ACCEL_MUL = [1, 0.9, 0.8, 0.65, 0.5] as const;
/** From this endurance level on running is not possible (PZ: exhausted characters only walk). */
export const ENDURANCE_NO_RUN_LEVEL = 4;

export interface PhysicsConfig {
  /** Body masses without carried items. */
  bodyMassKg: { player: number; zombie: number };
  /** Mass at which inertia is neutral (accel × 1); heavier = slower start and stop. */
  refMassKg: number;
  /** Inertia multiplier range (refMass / mass is clamped to it). */
  inertiaMul: { min: number; max: number };
  /** Ticks to reach full speed / to stop at neutral mass and no load (like movement.ts). */
  accelTicks: number;
  brakeTicks: number;
  /** Base speeds in tiles per tick. */
  speed: { walk: number; run: number; zombieWalk: number; zombieRun: number };
  /** Speed above which the locomotion state is `run` (fraction of the walk speed). */
  runStateAtWalkMul: number;
  /** Speed below which the entity counts as standing (`idle`). */
  idleSpeed: number;
  /** Attack / shove animation lengths (attacker state `attack` / `push`). */
  attackTicks: number;
  pushTicks: number;
  /** Impulse model: weapon knockback × strength factor × refMass / target mass, clamped 0..1. */
  impulse: {
    /** Knockback "weapon" of a shove and of a zombie lunge. */
    shoveForce: number;
    zombieForce: number;
    /** strength factor = base + perLevel × strength (strength 0..10, PZ skill level). */
    strengthBase: number;
    strengthPerLevel: number;
    /** Hits weaker than this only flinch (`hit`). */
    minReaction: number;
  };
  /** Chance rolls (seeded RNG, exactly 2 draws per hit). */
  chance: {
    /** knockdown = (impulse − knockdownMinImpulse) × knockdownPerImpulse (+ behind bonus). */
    knockdownMinImpulse: number;
    knockdownPerImpulse: number;
    /** Added to the knockdown chance for a hit from behind. */
    behindKnockdownBonus: number;
    /** Extra knockdown chance of a shove from behind (PZ: shoving from behind floors zombies). */
    behindShoveBonus: number;
    /** stagger = staggerBase + impulse × staggerPerImpulse (+ shoveStaggerBonus). */
    staggerBase: number;
    staggerPerImpulse: number;
    shoveStaggerBonus: number;
  };
  /** Half-angle (rad) of the rear cone counted as "from behind" (around facing + π). */
  behindHalfArc: number;
  /** State lengths in ticks. */
  durations: {
    hit: number;
    /** stagger = staggerBase + round(impulse × staggerPerImpulse). */
    staggerBase: number;
    staggerPerImpulse: number;
    /** Knock-down lying time, rolled uniformly in [min, max]. */
    knockdownZombie: { min: number; max: number };
    knockdownPlayer: { min: number; max: number };
    getupZombie: number;
    getupPlayer: number;
  };
  /** Knock-back slide: start speed = impulse × maxSpeed, then × friction per tick. */
  knockback: { maxSpeed: number; friction: number; stopSpeed: number };
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  bodyMassKg: { player: 80, zombie: 70 },
  refMassKg: 80,
  inertiaMul: { min: 0.35, max: 1.2 },
  accelTicks: 4,
  brakeTicks: 3,
  speed: {
    walk: perTick(WALK_SPEED_TILES_PER_SECOND),
    run: perTick(WALK_SPEED_TILES_PER_SECOND * 1.8),
    zombieWalk: perTick(0.4),
    zombieRun: perTick(1.1),
  },
  runStateAtWalkMul: 1.2,
  idleSpeed: perTick(0.05),
  attackTicks: sec(0.4),
  pushTicks: sec(0.4),
  impulse: {
    shoveForce: 0.5,
    zombieForce: 0.25,
    strengthBase: 0.6,
    strengthPerLevel: 0.08,
    minReaction: 0.05,
  },
  chance: {
    knockdownMinImpulse: 0.25,
    knockdownPerImpulse: 0.8,
    behindKnockdownBonus: 0.35,
    behindShoveBonus: 0.25,
    staggerBase: 0.3,
    staggerPerImpulse: 1,
    shoveStaggerBonus: 0.2,
  },
  behindHalfArc: Math.PI / 3,
  durations: {
    hit: sec(0.2),
    staggerBase: sec(0.5),
    staggerPerImpulse: sec(0.7),
    knockdownZombie: { min: sec(2.5), max: sec(4.5) },
    knockdownPlayer: { min: sec(1.2), max: sec(1.8) },
    getupZombie: sec(1.5),
    getupPlayer: sec(1),
  },
  knockback: { maxSpeed: perTick(2.4), friction: 0.75, stopSpeed: perTick(0.04) },
};
