/**
 * LOCAL mirror of the sim protocol shape (the real one will live in @deadzone/protocol).
 * Keep in sync until the sim API lands, then replace these imports.
 *
 * Sim coordinates: (x, y) = floor plane in tiles (= world units), z = floor level.
 * See coords.ts for the mapping to three.js.
 */

export interface CommandHeader {
  tick: number;
  playerId: number;
  seq: number;
}

/** World-axis move vector, length <= 1. Sent only when input changes (sim keeps the last). */
export interface MoveCommand {
  type: 'move';
  dx: number;
  dy: number;
}

/** Aim point on the floor, in world units (sim x/y). */
export interface AimCommand {
  type: 'aim';
  x: number;
  y: number;
}

export type CommandBody = MoveCommand | AimCommand;
export type Command = CommandHeader & CommandBody;

/** Snapshot = Float32Array of entities, ENTITY_STRIDE floats each; first entity = player. */
export const ENTITY_STRIDE = 5;
export const ENTITY_ID = 0;
export const ENTITY_X = 1;
export const ENTITY_Y = 2;
export const ENTITY_Z = 3;
export const ENTITY_FACING = 4;

/** Player capsule radius in world units. */
export const PLAYER_RADIUS = 0.3;

export type MainToWorker =
  | { kind: 'init'; seed: number; map: unknown }
  | { kind: 'cmd'; cmd: Command }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'speed'; x: number };

export type WorkerToMain =
  { kind: 'snapshot'; tick: number; buf: ArrayBuffer } | { kind: 'ready'; tick: number };
