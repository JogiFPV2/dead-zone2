/** Largest value of an unsigned 32-bit integer (ticks, seq). */
export const U32_MAX = 0xffff_ffff;
/** Player ids are small integers assigned by the host (singleplayer: 0). */
export const MAX_PLAYER_ID = 0xffff;
/** Aim targets further than this from the origin (in tiles) are rejected as garbage. */
export const MAX_WORLD_COORD = 1_000_000;

export type PlayerId = number;

/** Fields shared by every command. */
export interface CommandHeader {
  /** Tick in which the command should be applied. */
  tick: number;
  /** In multiplayer assigned by the server from the connection, never trusted from the payload. */
  playerId: PlayerId;
  /** Increasing per player; duplicates and out-of-order commands are rejected. */
  seq: number;
}

/**
 * Held movement direction in world tiles (+x east, +y south). Stays active until the next
 * `move`. The vector length is clamped to 1 by the sim, so analog input is allowed.
 */
export interface MoveCommand extends CommandHeader {
  type: 'move';
  dx: number;
  dy: number;
}

/** World-space point (tiles) the player is aiming at; the sim derives facing from it. */
export interface AimCommand extends CommandHeader {
  type: 'aim';
  x: number;
  y: number;
}

/**
 * Body parts (17, as in Project Zomboid). Order is fixed: it is part of the state hash and the
 * wound view. `_l` / `_r` = the character's left / right.
 */
export const BODY_PARTS = [
  'head',
  'neck',
  'torso_upper',
  'torso_lower',
  'groin',
  'upper_arm_l',
  'upper_arm_r',
  'forearm_l',
  'forearm_r',
  'hand_l',
  'hand_r',
  'thigh_l',
  'thigh_r',
  'shin_l',
  'shin_r',
  'foot_l',
  'foot_r',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

/** Wound kinds; tuning per kind is data (`worldSettings.survival.wounds.types`). */
export const WOUND_KINDS = ['scratch', 'laceration', 'bite', 'deep'] as const;
export type WoundKind = (typeof WOUND_KINDS)[number];

/** Falls asleep on the spot (needs `fatigue ≥ sleep.minFatigueToSleep`). Surface: floor for now. */
export interface SleepCommand extends CommandHeader {
  type: 'sleep';
}

export interface WakeCommand extends CommandHeader {
  type: 'wake';
}

/**
 * Dresses every wound on `part` with a clean bandage (instant for now; later a timed action that
 * consumes the item). `itemId` = content id of a medical item with `stop_bleeding` (e.g.
 * `base:bandage`); not taken from the inventory until Stage 3.
 */
export interface BandageCommand extends CommandHeader {
  type: 'bandage';
  part: BodyPart;
  itemId?: string | undefined;
}

/** Dev only (`init.dev`): inflicts a wound; `zombie` rolls the virus with the kind's chance. */
export interface DebugWoundCommand extends CommandHeader {
  type: 'debugWound';
  part: BodyPart;
  wound: WoundKind;
  zombie?: boolean | undefined;
}

/** Stats a dev command may set directly (values are clamped by the sim). */
export const DEBUG_STATS = [
  'health',
  'hunger',
  'thirst',
  'fatigue',
  'endurance',
  'boredom',
  'stress',
  'unhappiness',
  'wetness',
  'satiety',
  'body-temperature-c',
] as const;
export type DebugStat = (typeof DEBUG_STATS)[number];

/** Dev only (`init.dev`): sets a survival stat, e.g. `fatigue = 80` to test sleep. */
export interface DebugStatCommand extends CommandHeader {
  type: 'debugStat';
  stat: DebugStat;
  value: number;
}

export type Command =
  | MoveCommand
  | AimCommand
  | SleepCommand
  | WakeCommand
  | BandageCommand
  | DebugWoundCommand
  | DebugStatCommand;
export type CommandType = Command['type'];

export type CommandParseResult = { ok: true; command: Command } | { ok: false; error: string };
