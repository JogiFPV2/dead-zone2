import type { PlayerId } from './commands.js';

export type CommandRejectReason =
  /** Failed the zod schema (structural validation). */
  | 'invalid'
  /** `seq` not greater than the last accepted one for this player. */
  | 'stale-seq'
  /** `tick` further in the future than the command window. */
  | 'too-far-in-future'
  /** No such player in the world when the command was applied (gameplay validation). */
  | 'unknown-player';

/** Events emitted by the sim for the host (sounds, UI, debug). Never a source of truth. */
export type SimEvent = {
  type: 'commandRejected';
  tick: number;
  playerId: PlayerId;
  seq: number;
  reason: CommandRejectReason;
};
