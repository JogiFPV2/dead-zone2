import {
  ENTITY_PHYS_STATES,
  type EntityKnockback,
  type EntityPhysState,
  type PhysEventKind,
} from '@deadzone/protocol';
import type { Rng } from '../core/rng.js';
import type { Stair } from '../world/levels.js';
import type { PhysicsConfig } from './constants.js';
import type { Vehicle } from '../vehicles/types.js';

/** Body states (shared with the client through `@deadzone/protocol`). */
export const PHYSICS_STATES = ENTITY_PHYS_STATES;
export type PhysicsState = EntityPhysState;
export type Knockback = EntityKnockback;
export type PhysicsEntityKind = 'player' | 'zombie';

/**
 * Fields the client reads (Three.js animations), the same for players and zombies. Angles in
 * radians [0, 2π) from +x towards +y (like `facingRad`), velocities in tiles per tick, ticks are
 * absolute sim ticks.
 */
export interface PhysicsSnapshotFields {
  facing: number;
  vel: { x: number; y: number };
  maxSpeed: number;
  state: PhysicsState;
  stateStartTick: number;
  /** Length of the current state in ticks; 0 = open-ended (idle / walk / run / dead). */
  stateDuration: number;
  /** Last hit's push; reset when the entity is back in control. */
  knockback: Knockback;
  /** 0 = never hit. */
  lastHitTick: number;
  hitFromDir: number;
  /** Zombies: u32 from the seeded RNG, fixed for life; players: 0. */
  gaitSeed: number;
}

/** One physics body. `accel`, `mass` and the inputs below are internal (not in the snapshot). */
export interface PhysicsBody extends PhysicsSnapshotFields {
  /** StableId of the entity. */
  readonly id: number;
  readonly kind: PhysicsEntityKind;
  /** Position in tiles (moved by physics only while knocked back / without control). */
  x: number;
  y: number;
  /** Velocity change per tick at full control (tiles per tick²), after inertia and modifiers. */
  accel: number;
  /** Body + carried weight in kg. */
  mass: number;
  /** Inputs, set by the caller (inventory / survival) before `physicsStep`. */
  bodyMassKg: number;
  carriedKg: number;
  capacityKg: number;
  /** 0..100, like `vitals.endurance` (zombies: 100). */
  endurance: number;
  /** PZ Strength skill 0..10 (impulse of its hits). */
  strength: number;
  /**
   * Crowd push (tiles) from zombie–zombie separation (`crowd.ts`), added to the entity's next
   * movement step (one collision sweep for both); 0 when not pressed.
   */
  pushX: number;
  pushY: number;
  /** Flight of stairs the body is on (`Stair.id` + 1; 0 = none; `stairs.ts`). */
  stair: number;
  /** During `fall`: level it fell from and the landing level. */
  fallFromZ: number;
  fallToZ: number;
  /** Tick the body was frozen at (outside every active chunk window, `active.ts`); −1 = active. */
  frozenAt: number;
  /** During `vault`: start and landing point, trip chance, broken-glass window (0 / 1). */
  vaultFromX: number;
  vaultFromY: number;
  vaultToX: number;
  vaultToY: number;
  vaultTrip: number;
  vaultGlass: number;
  /**
   * Vehicle the body sits in (StableId, 0 = none) and its seat (index in the vehicle type's
   * `seats`, −1 = none); state `driving` while seated (`vehicles/commands.ts`).
   */
  vehicle: number;
  seat: number;
}

/** Physics state of one sim (or one test). Bodies are iterated in `id` order. */
export interface PhysicsWorld {
  readonly cfg: PhysicsConfig;
  /** In the sim: `w.rng.physics` (re-pointed after loading a save). */
  rng: Rng;
  readonly bodies: Map<number, PhysicsBody>;
  /** Cached `id`-sorted bodies (rebuilt when the map size changes). */
  order: PhysicsBody[];
  orderSize: number;
  /**
   * Crowd (`crowd.ts`): edge key → zombie eids pressing on it this tick (filled by
   * `ai.locomotion`, cleared by the `physics` step; transient, not saved).
   */
  readonly presses: Map<number, number[]>;
  /** Edge key → last pressure level 1..3 sent to the client (`openingPressure`; saved). */
  readonly pressure: Map<number, number>;
  /** Flights of stairs of the map (`TileGrid.stairs`, set by the sim; not saved). */
  stairs: readonly Stair[];
  /** The map has more than one level (falls possible; set by the sim). */
  multiLevel: boolean;
  /** Vehicles by StableId (`vehicles/*`; saved, hashed only when there are any). */
  readonly vehicles: Map<number, Vehicle>;
}

/** Hit or shove of `attackerId` on `targetId`, resolved by `physicsStep` in the given order. */
export interface PhysicsHit {
  attackerId: number;
  targetId: number;
  /**
   * `melee` (weapon / fists), `shove` (push, no damage), `zombie` (zombie lunge), `shot`
   * (firearm: the force does not scale with the shooter's strength), `vehicle` (rammed by a car,
   * `vehicles/ram.ts`; `attackerId` = the vehicle's StableId).
   */
  kind: 'melee' | 'shove' | 'zombie' | 'shot' | 'vehicle';
  /** Strongest reaction allowed (firearms: pistols only stagger). */
  maxReaction?: 'stagger' | 'knockdown';
  /** Weapon knockback 0..1 (`melee.knockback`, unarmed 0.3); defaults by kind when omitted. */
  force?: number;
  /** The hit kills the target (combat decides): state `dead` and `died`, no reaction roll. */
  lethal?: boolean;
}

/** Outcome of a hit before it is applied (pure, see `resolveHit`). */
export interface HitOutcome {
  reaction: 'hit' | 'stagger' | 'knockdown';
  /** 0..1 after strength / weapon vs target mass. */
  impulse: number;
  behind: boolean;
  /** Unit push direction (from attacker to target). */
  dirX: number;
  dirY: number;
  /** Direction the hit came from as seen from the target (rad, [0, 2π)). */
  hitFromDir: number;
  /** Length of the reaction state in ticks. */
  duration: number;
}

/** Event kinds (shared with the client as `PhysEventKind`). */
export type PhysicsEventType = PhysEventKind;

/**
 * Physics event. `hitLanded` is reported on the target with `sourceId` = attacker; `gotUp` when
 * the getup state ends (the entity is in control again).
 */
export interface PhysicsEvent {
  type: PhysicsEventType;
  entityId: number;
  tick: number;
  sourceId?: number;
}

/** Held movement of one body for this tick (standalone mode; see `physicsStep`). */
export interface PhysicsIntent {
  /** Direction, length ≤ 1. */
  dx: number;
  dy: number;
  run?: boolean;
}

/** Speed and acceleration multipliers from load and endurance (see `movementModifiers`). */
export interface MovementModifiers {
  loadLevel: number;
  enduranceLevel: number;
  speedMul: number;
  /** Multiplier for the acceleration and braking step (inertia × load × endurance). */
  accelMul: number;
  canRun: boolean;
}
