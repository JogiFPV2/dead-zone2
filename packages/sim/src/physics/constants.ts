import { TICKS_PER_SECOND, WALK_SPEED_TILES_PER_SECOND } from '../core/constants.js';
import { DEFAULT_VEHICLE_CONFIG, type VehicleConfig } from '../vehicles/config.js';

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
 * Furniture moved by players (`furniture.ts`, docs 9.61). Weight: the content `weightKg` of a
 * placeable, else footprint tiles × `kgPerTile` (`kgPerTileTall` for tall pieces), plus the
 * contents of its storage (`countContents`). Strength in kg: `basePushKg` × (1 +
 * `perStrengthLevel` × strength skill) × (1 − `fatigueWeight` × fatigue / 100) × wound penalty
 * (`Pen.action`) × `loadMul[load level]` × `enduranceMul[endurance level]`; × `pullMul` for a
 * pull, × `rotateMul` for a rotation. Heavier than that = `too-heavy`. An average character
 * (base pack strength 5, rested): push 105 kg, pull 73.5 kg, rotate 94.5 kg (docs 9.61), so a
 * metal shelf (90 kg empty, 130 kg full) never pulls; 49 kg is the pull at strength 0.
 */
export interface FurnitureConfig {
  enabled: boolean;
  /** Reach from the player centre to the nearest occupied tile centre. */
  reachTiles: number;
  /**
   * Push / pull need the player beside an edge: off the piece on one axis and over its span on
   * the other, within this many tiles (corners and overlaps = `wrong-side`).
   */
  sideSlackTiles: number;
  kgPerTile: number;
  kgPerTileTall: number;
  countContents: boolean;
  basePushKg: number;
  perStrengthLevel: number;
  pullMul: number;
  rotateMul: number;
  fatigueWeight: number;
  /** By load level 0..4 / endurance level 0..4 (`modifiers.ts`). */
  loadMul: readonly number[];
  enduranceMul: readonly number[];
  /** One tile / one rotation at no load; × (1 + `slowPerLoad` × weight / strength). */
  moveTicks: number;
  rotateTicks: number;
  slowPerLoad: number;
  /** Cost on completion: endurance − (base + perKg × kg), fatigue + perKg × kg (0..100 stats). */
  enduranceBase: number;
  endurancePerKg: number;
  fatiguePerKg: number;
  /** Scrape noise on completion: radius base + perKg × kg tiles (`ai/noise.ts`, `action`). */
  noiseRadiusTiles: number;
  noisePerKg: number;
  noiseVolume: number;
  /**
   * Moved furniture on the tile right behind a closed door / window / gate (the side away from
   * the crowd) resists the crowd: kg / `refMassKg` × `doorResistPerUnit` zombie units (`crowd.ts`
   * `edgePressure`). Net crowd pressure ≥ `pushBackUnits` pushes it one tile into the room.
   */
  doorResistPerUnit: number;
  pushBackUnits: number;
}

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
    /** Added to the knockdown chance for a hit from behind (zombie lunges: `behindZombieBonus`). */
    behindKnockdownBonus: number;
    behindZombieBonus: number;
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
  /** Crowd pressure on closed doors / windows / fences and zombie pushing (`crowd.ts`). */
  crowd: CrowdConfig;
  /** Stairs: speed, congestion, domino, crowd pushing up a flight (`stairs.ts`). */
  stairs: StairsConfig;
  /** Falling from a level edge (`stairs.ts`). */
  fall: FallConfig;
  /**
   * Active chunk window radius R ((2R + 1)² chunks per player, `active.ts`); default
   * `ceil(ai.farTiles / 32)`.
   */
  activeChunkRadius?: number;
  /** Vehicles (`vehicles/*`): driving model, collisions, enter / exit (m/s based). */
  vehicle: VehicleConfig;
  /** Pushing / pulling / rotating furniture, furniture against a door (`furniture.ts`). */
  furniture: FurnitureConfig;
  /** Vaulting over low fences / through windows (`vault.ts`). */
  vault: VaultConfig;
  /** Knock-back of firearm hits per weapon category (`combat/firearms.ts` → `physicsHit`). */
  firearms: Record<FirearmCategory, FirearmKnockback>;
}

/**
 * Vaulting (PZ: a standing low fence is hopped in about a second, sprinting over it often ends on
 * the ground; climbing through a window takes longer and broken glass cuts).
 */
export interface VaultConfig {
  /** Max distance from the body centre to the edge to start. */
  reachTiles: number;
  /** Landing point: this far beyond the edge (at least radius + 0.05). */
  landTiles: number;
  fenceTicks: number;
  windowTicks: number;
  /** Base trip chance per vault. */
  tripFence: number;
  tripWindow: number;
  /** Added when the player was running when starting the vault. */
  tripRun: number;
  /** Added per load level / endurance level 0..4 (same levels as movement). */
  tripLoad: readonly number[];
  tripEndurance: readonly number[];
  /** Trip chance × max(tripSkillFloor, 1 − nimble × perNimble − fitness × perFitness). */
  tripPerNimble: number;
  tripPerFitness: number;
  tripSkillFloor: number;
  tripMax: number;
  /** Lying time after a trip (then getup). */
  tripKnockdownTicks: number;
  /**
   * Chance that a broken window cuts (laceration on a forearm / hand / thigh). Only a frame with
   * glass left in it cuts: `removeGlass` sets the opening's `cleared` flag (physics/vault.ts).
   */
  glassChance: number;
}

export type FirearmCategory = 'pistol' | 'revolver' | 'shotgun' | 'rifle';

/**
 * Knock-back "weapon force" of a firearm hit (0..1, like `melee.knockback`, without the
 * shooter's strength): full up to `closeTiles`, then linearly down to × `minMul` at
 * `closeTiles + falloffTiles`. Pellets of a shotgun split the force (all pellets = full force).
 * `maxReaction` caps the reaction (pistols only stagger).
 */
export interface FirearmKnockback {
  force: number;
  closeTiles: number;
  falloffTiles: number;
  minMul: number;
  maxReaction: 'stagger' | 'knockdown';
}

/**
 * Stairs (PZ: climbing is slower, zombies climb slowly). Speed along the flight × `upMul` /
 * `downMul` (players also × the load / endurance step of their level), zombies × `zombieUpMul`
 * / `zombieDownMul`. A flight is one body wide and bodies keep `spacing` tiles apart along it
 * (one at a time, throughput limited). A hit that knocks a body down the flight (stagger or
 * knock-down, push pointing down) can floor the bodies below: the first with `dominoChance`, each
 * next × `dominoDecay`, the chain stops at the first that stays up (1 `rng.physics` draw each).
 * Zombies pushing up a flight on a player standing on it: every `crowd.pulseTicks` their units
 * (mass / refMass, rows behind the first × `crowd.backRankWeight`) minus `holdForce` × player
 * mass / refMass minus `crowd.freeUnits` → a push of force `pushForcePerUnit` × excess (≤ 1).
 */
export interface StairsConfig {
  upMul: number;
  downMul: number;
  zombieUpMul: number;
  zombieDownMul: number;
  /** Extra climbing (up) multiplier per load level / endurance level 0..4. */
  loadUpMul: readonly number[];
  enduranceUpMul: readonly number[];
  spacing: number;
  dominoChance: number;
  dominoDecay: number;
  holdForce: number;
  pushForcePerUnit: number;
}

/**
 * Falls (PZ: one storey mostly hurts a little, two hurt badly, from high up it kills). Drop in
 * metres = levels × `floorHeightM`; fall time = √(2h / g). Damage by levels (index = levels − 1,
 * the last row for higher drops below `deathLevels`): with `chance` a hit of [min, max] (player
 * health 0..100 / zombie hp); from `deathLevels` on the fall is lethal. Every landing draws 3
 * numbers from `rng.physics` (chance, amount, leg) and ends in a knock-down.
 */
export interface FallConfig {
  floorHeightM: number;
  gravity: number;
  damage: readonly { chance: number; min: number; max: number }[];
  deathLevels: number;
  /** Levels searched below for a landing floor. */
  maxLevels: number;
  /** Knock-down after landing (ticks). */
  knockdownTicks: { player: number; zombie: number };
}

/**
 * Crowd pressure (PZ: a horde breaks through what a lone zombie only bangs on). Pressure of an
 * edge = Σ over zombies pressing on it of mass / refMass × rank weight (1 at the edge, down to
 * `backRankWeight` at `reachTiles`), in "zombie units". Resistance = a player holding it from
 * the other side (`holdForce` × mass / refMass) + `barricadeResist` for planks. Every
 * `pulseTicks` the excess over `freeUnits` (a single zombie: none, its blows stay as they were)
 * damages the edge like `bashesPerUnit` extra zombies each; a window breaks at once from
 * `windowBreakUnits`. Design factor: 8 zombies (≈ 6 excess units) break a door ≈ 2× faster than
 * the same 8 only bashing (≈ 10× a lone zombie); tested in `crowd.test.ts`.
 */
export interface CrowdConfig {
  enabled: boolean;
  /** Zombies whose centre is this close to the edge centre (pressing side) count. */
  reachTiles: number;
  /** Rank weight at `reachTiles` (linear from 1 at `frontTiles`). */
  frontTiles: number;
  backRankWeight: number;
  /** Units absorbed for free: one zombie (90 kg = 1.125 units) adds nothing. */
  freeUnits: number;
  /** Ticks between pressure pulses (damage, level events). */
  pulseTicks: number;
  /**
   * Damage per excess unit, in lone-zombie blows: unit damage per second = bashesPerUnit × the
   * average bash damage per second of the pressing zombie type (× `openings.zombieBashMul`).
   */
  bashesPerUnit: number;
  /** Pulse damage × (1 ± jitter), one `rng.physics` draw per damaging pulse. */
  damageJitter: number;
  /** Fence damage × this (low fences give way to a crowd quickly). */
  fenceDamageMul: number;
  /** Lone zombie blows on a fence × this (it mostly just bangs on it). */
  fenceBashMul: number;
  /** A closed window breaks at once at this net pressure (units). */
  windowBreakUnits: number;
  /**
   * A closed gate without planks falls over at once at this net pressure (units); a locked
   * (barred) gate needs `gateBarMul` × that. Below it the crowd only damages it (like a door).
   */
  gateFallUnits: number;
  gateBarMul: number;
  /** A player within this distance of the edge centre on the other side holds it. */
  holdReachTiles: number;
  holdForce: number;
  barricadeResist: number;
  /** Excess units at which the client level (`openingPressure`) is 2 / 3. */
  levelUnits: readonly [number, number];
  /**
   * Zombie–zombie pushing (gentle: zombies still crowd at a door): overlap correction share per
   * tick, dead zone (tiles), max push per tick.
   */
  separation: { stiffness: number; slop: number; maxStep: number };
}

/** Hit points of a standing low fence (`openings`: `closed` → `broken` = knocked over). */
export const FENCE_HP = 40;

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  vehicle: DEFAULT_VEHICLE_CONFIG,
  furniture: {
    enabled: true,
    reachTiles: 1.5,
    sideSlackTiles: 0.25,
    kgPerTile: 35,
    kgPerTileTall: 45,
    countContents: true,
    basePushKg: 70,
    perStrengthLevel: 0.1,
    pullMul: 0.7,
    rotateMul: 0.9,
    fatigueWeight: 0.4,
    loadMul: [1, 0.9, 0.75, 0.6, 0.45],
    enduranceMul: [1, 0.95, 0.85, 0.7, 0.5],
    moveTicks: sec(1),
    rotateTicks: sec(1.5),
    slowPerLoad: 1.5,
    enduranceBase: 1,
    endurancePerKg: 0.05,
    fatiguePerKg: 0.004,
    noiseRadiusTiles: 4,
    noisePerKg: 0.05,
    noiseVolume: 0.6,
    doorResistPerUnit: 1.5,
    pushBackUnits: 2.5,
  },
  /** Zombies are heavier (dead weight): less inertia multiplier, harder to push over. */
  bodyMassKg: { player: 80, zombie: 90 },
  refMassKg: 80,
  inertiaMul: { min: 0.35, max: 1.2 },
  accelTicks: 4,
  brakeTicks: 3,
  speed: {
    walk: perTick(WALK_SPEED_TILES_PER_SECOND),
    run: perTick(WALK_SPEED_TILES_PER_SECOND * 2.5),
    zombieWalk: perTick(0.4),
    zombieRun: perTick(1.1),
  },
  runStateAtWalkMul: 1.2,
  idleSpeed: perTick(0.05),
  attackTicks: sec(0.4),
  pushTicks: sec(0.4),
  impulse: {
    shoveForce: 0.5,
    zombieForce: 0.15,
    strengthBase: 0.6,
    strengthPerLevel: 0.08,
    minReaction: 0.05,
  },
  chance: {
    knockdownMinImpulse: 0.25,
    knockdownPerImpulse: 0.8,
    behindKnockdownBonus: 0.35,
    behindZombieBonus: 0.1,
    behindShoveBonus: 0.25,
    staggerBase: 0.1,
    staggerPerImpulse: 1.2,
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
  knockback: { maxSpeed: perTick(5), friction: 0.75, stopSpeed: perTick(0.04) },
  crowd: {
    enabled: true,
    reachTiles: 1.8,
    frontTiles: 0.6,
    backRankWeight: 0.5,
    freeUnits: 1.25,
    pulseTicks: sec(0.5),
    bashesPerUnit: 0.5,
    damageJitter: 0.2,
    fenceDamageMul: 2,
    fenceBashMul: 0.25,
    windowBreakUnits: 3,
    gateFallUnits: 5,
    gateBarMul: 1.8,
    holdReachTiles: 1,
    holdForce: 2.5,
    barricadeResist: 3,
    levelUnits: [2, 4],
    separation: { stiffness: 0.3, slop: 0.02, maxStep: perTick(1) },
  },
  stairs: {
    upMul: 0.6,
    downMul: 0.85,
    zombieUpMul: 0.35,
    zombieDownMul: 0.6,
    loadUpMul: [1, 0.9, 0.75, 0.6, 0.45],
    enduranceUpMul: [1, 0.95, 0.85, 0.7, 0.55],
    spacing: 0.75,
    dominoChance: 0.6,
    dominoDecay: 0.7,
    holdForce: 1.5,
    pushForcePerUnit: 0.12,
  },
  fall: {
    floorHeightM: 3,
    gravity: 9.81,
    damage: [
      { chance: 0.3, min: 5, max: 15 },
      { chance: 1, min: 30, max: 55 },
      { chance: 1, min: 60, max: 95 },
    ],
    deathLevels: 4,
    maxLevels: 8,
    knockdownTicks: { player: sec(2), zombie: sec(3.5) },
  },
  vault: {
    reachTiles: 0.8,
    landTiles: 0.55,
    fenceTicks: sec(1),
    windowTicks: sec(1.5),
    tripFence: 0.04,
    tripWindow: 0.08,
    tripRun: 0.3,
    tripLoad: [0, 0.08, 0.18, 0.3, 0.45],
    tripEndurance: [0, 0.03, 0.08, 0.15, 0.25],
    tripPerNimble: 0.06,
    tripPerFitness: 0.03,
    tripSkillFloor: 0.25,
    tripMax: 0.9,
    tripKnockdownTicks: sec(1.5),
    glassChance: 0.5,
  },
  firearms: {
    pistol: { force: 0.3, closeTiles: 2, falloffTiles: 10, minMul: 0.3, maxReaction: 'stagger' },
    revolver: { force: 0.4, closeTiles: 2, falloffTiles: 10, minMul: 0.3, maxReaction: 'stagger' },
    rifle: { force: 0.5, closeTiles: 4, falloffTiles: 20, minMul: 0.5, maxReaction: 'knockdown' },
    shotgun: { force: 1, closeTiles: 2.5, falloffTiles: 6, minMul: 0.15, maxReaction: 'knockdown' },
  },
};

/**
 * Character locomotion (players, `physics/locomotion.ts`): gait profiles, turning and the
 * sprint cost. Units: m/s, m/s², m/s³ (1 tile = 1 m), rad/s. Target speeds are walk ×
 * gait multiplier: walk 1.5 m/s (`worldSettings.movement.walkSpeedMps`, #99), run × 2.5
 * (`movement.runSpeedMul`) = 3.75 m/s, sneak × 0.5 (`movement.sneakSpeedMul`) = 0.75 m/s,
 * sprint = run × `SPRINT_SPEED_MUL` = 4.875 m/s.
 */
export const LOCO_SPEED_MPS = { sneak: 0.75, walk: 1.5, run: 3.75, sprint: 4.875 } as const;
/** Sprint speed × run speed. */
export const SPRINT_SPEED_MUL = 1.3;

/**
 * Per gait: `accel` / `brake` = max longitudinal acceleration / deceleration (m/s²), `jerk` =
 * how fast the acceleration may build up (m/s³; it falls back to 0 twice as fast). The speed
 * follows a jerk-limited S-curve that lands on the target without overshoot (critically damped).
 */
export interface GaitProfile {
  accel: number;
  brake: number;
  jerk: number;
}
export const GAIT_PROFILES: Record<'sneak' | 'walk' | 'run' | 'sprint', GaitProfile> = {
  sneak: { accel: 4, brake: 6, jerk: 60 },
  walk: { accel: 6, brake: 8, jerk: 60 },
  run: { accel: 7, brake: 9, jerk: 45 },
  sprint: { accel: 5, brake: 8, jerk: 30 },
};

/**
 * Turning of the movement direction (not the facing, which turns on its own towards the aim):
 * max rate = `TURN_RATE_MAX` / (1 + (speed / `TURN_SPEED_REF`)²) rad/s × inertia. Walk ≈ 630°/s,
 * run ≈ 265°/s, sprint ≈ 180°/s.
 */
export const TURN_RATE_MAX = 15;
export const TURN_SPEED_REF = 2.5;
/** Below this speed the direction snaps to the input (turning on the spot). */
export const PIVOT_SPEED_MPS = 0.35;
/**
 * Input more than this far from the movement direction (cos < −0.5 = 120°) is a reversal: the
 * body brakes to `PIVOT_SPEED_MPS` first, then turns (180° goes through braking).
 */
export const REVERSE_COS = -0.5;
/** Target speed in a turn × (min + (1 − min) × cos of the angle still to turn). */
export const CORNER_SPEED_MIN = 0.6;

/** Sprint needs endurance ≥ this (else run); costs `SPRINT_ENDURANCE_MUL` × the running drain. */
export const SPRINT_MIN_ENDURANCE = 25;
export const SPRINT_ENDURANCE_MUL = 2;
/** Sprint footsteps: the run noise radius × this. */
export const SPRINT_NOISE_MUL = 1.3;
