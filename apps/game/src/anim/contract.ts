/**
 * Physics / animation state per entity as the views read it (`PhysAdapter.get`). Since sim #62
 * the values come from the snapshot physics body and `physics` events (`anim/phys-layout.ts`,
 * `@deadzone/protocol`); for records without it (stride 8, mock crowd) the adapter derives them.
 * The views never read the snapshot physics fields directly, only this shape.
 *
 * Note: `stateDuration` of `knockdown` here is the time lying AFTER the fall
 * (KNOCKDOWN_FALL_TICKS); the adapter converts the sim's total length.
 */

/** Entity body state (one at a time; timed states end after `stateDuration` ticks). */
export const BODY_STATES = [
  'idle',
  'walk',
  'run',
  'attack',
  'hit',
  'stagger',
  'push',
  'knockdown',
  'getup',
  'dead',
] as const;
export type BodyState = (typeof BODY_STATES)[number];

export interface Knockback {
  /** Unit direction the body is pushed towards (sim tiles: +x east, +y south). */
  dirX: number;
  dirY: number;
  /** 0..1. */
  strength: number;
}

/** Per-entity physics / animation state (contract field names). */
export interface PhysState {
  /** Where the body looks (rad, same convention as the snapshot facing); separate from `vel`. */
  facing: number;
  /** Velocity in tiles per tick. */
  vel: { x: number; y: number };
  /** Top speed in tiles per tick (for locomotion blending). */
  maxSpeed: number;
  state: BodyState;
  stateStartTick: number;
  /** Length of a timed state in ticks (knockdown: time lying on the ground); 0 = untimed. */
  stateDuration: number;
  knockback: Knockback;
  /** Last tick the entity was hit (-1 = never). */
  lastHitTick: number;
  /** Direction the last hit came from (rad, from the entity towards the attacker). */
  hitFromDir: number;
  /** Zombies: per-body gait seed (uint32); 0 for players. */
  gaitSeed: number;
}

export type PhysEventType =
  'attackStart' | 'hitLanded' | 'staggered' | 'fellDown' | 'gotUp' | 'died';

export interface PhysEvent {
  type: PhysEventType;
  entityId: number;
  tick: number;
}

/** Ticks of the falling part of a knockdown before `stateDuration` (lying) starts. */
export const KNOCKDOWN_FALL_TICKS = 7;
/** Length of the get-up state when not given (ticks; the sim sends its own). */
export const GETUP_TICKS = 10;
/** Length of a light hit reaction (ticks). */
export const HIT_TICKS = 8;
