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

export type Command = MoveCommand | AimCommand;
export type CommandType = Command['type'];

export type CommandParseResult = { ok: true; command: Command } | { ok: false; error: string };
