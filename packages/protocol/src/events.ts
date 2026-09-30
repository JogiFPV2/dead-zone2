import type { BodyPart, PlayerId, WoundKind } from './commands.js';

export type CommandRejectReason =
  /** Failed the zod schema (structural validation). */
  | 'invalid'
  /** `seq` not greater than the last accepted one for this player. */
  | 'stale-seq'
  /** `tick` further in the future than the command window. */
  | 'too-far-in-future'
  /** No such player in the world when the command was applied (gameplay validation). */
  | 'unknown-player'
  /** The player is dead. */
  | 'dead'
  /** Debug command while the sim is not in dev mode. */
  | 'dev-only'
  /** Not possible in the current state (e.g. sleep while not tired, survival disabled). */
  | 'invalid-state'
  /** Nothing to act on (e.g. bandage on a part without wounds). */
  | 'invalid-target'
  /** `itemId` is not a known item usable for this command. */
  | 'unknown-item';

export type DeathCause =
  'bleeding' | 'starvation' | 'dehydration' | 'infection' | 'temperature' | 'wounds' | 'debug';

export type WakeReason = 'command' | 'rested' | 'max-duration' | 'died';

/** Events emitted by the sim for the host (sounds, UI, debug). Never a source of truth. */
export type SimEvent =
  | {
      type: 'commandRejected';
      tick: number;
      playerId: PlayerId;
      seq: number;
      reason: CommandRejectReason;
    }
  /** Player death (permadeath): the death screen reads `day` / `minuteOfDay` from here. */
  | {
      type: 'died';
      tick: number;
      playerId: PlayerId;
      cause: DeathCause;
      day: number;
      minuteOfDay: number;
    }
  | { type: 'wounded'; tick: number; playerId: PlayerId; part: BodyPart; wound: WoundKind }
  | { type: 'fellAsleep'; tick: number; playerId: PlayerId }
  | { type: 'wokeUp'; tick: number; playerId: PlayerId; reason: WakeReason }
  /** Moodle level change (0 = hidden). Sound / toast hook; the HUD uses the `view` message. */
  | {
      type: 'moodleChanged';
      tick: number;
      playerId: PlayerId;
      moodle: string;
      from: number;
      to: number;
    }
  /** Suggested game speed (sleep: `sleep.timeScaleHint`, waking: 1). The host decides. */
  | { type: 'timeScaleHint'; tick: number; speed: 1 | 2 | 4 }
  | { type: 'dayPassed'; tick: number; day: number };
