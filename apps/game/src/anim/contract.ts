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
  /** On a flight of stairs (sim `climb`, protocol v8+): z fractional, interpolated by the client. */
  'climb',
  /** Falling down one or more levels (sim `fall`); the sim then sends `knockdown` (or `dead`). */
  'fall',
  /**
   * Vaulting (sim `vault`, protocol v10): over a low fence (~1 s) or through an open / broken
   * window (~1.5 s); the length is `stateDuration`. Ends in `idle`, or `knockdown` after a trip.
   */
  'vault',
  /**
   * Sitting in a vehicle (sim `driving`, protocol v11): the body is pinned to its seat and moves
   * with the car (vehicle snapshot block); a still seated pose until the car view draws it.
   */
  'driving',
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
  /** Tick of the last `tripped` (vault ending in a knock-down); -1 / undefined = none. */
  tripTick?: number;
  /**
   * Outside the sim's active chunk window (#98): the body is frozen in its state (no motion, no
   * state timers), so the view holds its pose instead of animating it.
   */
  frozen?: boolean;
}

/** Sim physics active window radius R in chunks ((2R + 1)² around the player, `ceil(64 / 32)`). */
export const ACTIVE_CHUNK_RADIUS = 2;
/** Vaults at least this long (ticks) go through a window (1.5 s), shorter ones over a fence (1 s). */
export const WINDOW_VAULT_TICKS = 25;

export type PhysEventType =
  | 'attackStart'
  | 'hitLanded'
  | 'staggered'
  | 'fellDown'
  | 'gotUp'
  | 'died'
  /** Sim physics `startedFalling` (over a stair opening / edge). */
  | 'startedFalling'
  /** Sim physics `landed` (end of the fall). */
  | 'landed'
  /** SimEvent `fellFromHeight` (same tick as `landed`): levels, damage, killed in `fall`. */
  | 'fellFromHeight'
  /** Sim physics `vaulted` (vault finished on the far side). */
  | 'vaulted'
  /** Sim physics `tripped` (vault failed: knock-down on the far side, `fellDown` follows). */
  | 'tripped';

export interface PhysEvent {
  type: PhysEventType;
  entityId: number;
  tick: number;
  /** `fellFromHeight` only. */
  fall?: { levels: number; damage: number; killed: boolean };
}

/** Ticks of the falling part of a knockdown before `stateDuration` (lying) starts. */
export const KNOCKDOWN_FALL_TICKS = 7;
/** Length of the get-up state when not given (ticks; the sim sends its own). */
export const GETUP_TICKS = 10;
/** Length of a light hit reaction (ticks). */
export const HIT_TICKS = 8;
