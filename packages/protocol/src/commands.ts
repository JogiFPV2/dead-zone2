import { z } from 'zod';

/** Largest value of an unsigned 32-bit integer (ticks, seq). */
const U32_MAX = 0xffff_ffff;
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

const header = {
  tick: z.number().int().min(0).max(U32_MAX),
  playerId: z.number().int().min(0).max(MAX_PLAYER_ID),
  seq: z.number().int().min(0).max(U32_MAX),
};

const axis = z.number().finite().min(-1).max(1);
const coord = z.number().finite().min(-MAX_WORLD_COORD).max(MAX_WORLD_COORD);

export const moveCommandSchema = z.strictObject({
  ...header,
  type: z.literal('move'),
  dx: axis,
  dy: axis,
});

export const aimCommandSchema = z.strictObject({
  ...header,
  type: z.literal('aim'),
  x: coord,
  y: coord,
});

/** Structural validation at the host boundary (worker, server). Gameplay checks live in sim. */
export const commandSchema = z.discriminatedUnion('type', [moveCommandSchema, aimCommandSchema]);

export type CommandParseResult = { ok: true; command: Command } | { ok: false; error: string };

/** Validates untrusted input; never throws. */
export function parseCommand(input: unknown): CommandParseResult {
  const r = commandSchema.safeParse(input);
  if (r.success) return { ok: true, command: r.data };
  return { ok: false, error: z.prettifyError(r.error) };
}

export const isCommand = (input: unknown): input is Command =>
  commandSchema.safeParse(input).success;
