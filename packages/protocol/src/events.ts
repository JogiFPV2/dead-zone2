import type { BodyPart, ContainerId, ItemId, PlayerId, WoundKind } from './commands.js';

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
  | 'unknown-item'
  /** No such item / container, or not usable this way (e.g. eating a hammer). */
  | 'no-item'
  /** Target container or item is not within reach (1.5 tiles) of the player. */
  | 'out-of-range'
  /** Does not fit: container capacity, bag tags, or the carry hard limit. */
  | 'no-space'
  /** Needs a tool the player does not carry (e.g. a can opener, `food.openWith`). */
  | 'missing-tool'
  /** The action queue is full. */
  | 'busy';

export type DeathCause =
  | 'bleeding'
  | 'starvation'
  | 'dehydration'
  | 'infection'
  | 'temperature'
  | 'wounds'
  | 'debug'
  /** Killed by zombie attacks (health reached 0 in combat). */
  | 'zombie';

/** What caused a `hit`: a player's melee swing, a shove, or a zombie attack. */
export type HitSource = 'melee' | 'shove' | 'zombie';

/** Timed actions (docs/sim-architecture.md, `actions`). */
export type ActionKind = 'search' | 'eat' | 'drink' | 'bandage' | 'unpack';

export type ActionInterruptReason =
  /** Movement intent while the action runs. */
  | 'moved'
  | 'cancelled'
  /** Zombies nearby (hook, never until Stage 4). */
  | 'threat'
  | 'asleep'
  | 'died'
  /** The item or container is gone or out of reach when the action should complete. */
  | 'target-lost';

export type WakeReason =
  'command' | 'rested' | 'max-duration' | 'died' | 'noise' | 'zombie' | 'pain' | 'fever';

/** What made a noise (`noise` event, debug circles). */
export const NOISE_SOURCES = [
  'footstep',
  'action',
  'break',
  'attack',
  'shot',
  'impact',
  'lure',
  'debug',
] as const;
export type NoiseSource = (typeof NOISE_SOURCES)[number];

/** Why a zombie became alert: heard a noise (investigates) or saw a player (chases). */
export type ZombieAlertReason = 'noise' | 'sight';

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
      /** Full game days since the start of the game (death screen: "survived N days"). Always set by the sim. */
      daysSurvived?: number;
      /** Always set by the sim. */
      zombiesKilled?: number;
    }
  /**
   * A hit landed. `attacker` / `target` are StableIds (player or zombie); `damage` in HP (zombie
   * HP or player health 0–100), 0 for shoves; `killed` = the target died of it.
   */
  | {
      type: 'hit';
      tick: number;
      source: HitSource;
      attacker: number;
      target: number;
      damage: number;
      x: number;
      y: number;
      killed: boolean;
    }
  /** A zombie died; `playerId` = the killer. */
  | { type: 'zombieKilled'; tick: number; zombie: number; playerId: PlayerId; x: number; y: number }
  /** A melee weapon broke (condition reached 0) and was removed or replaced by `brokenInto`. */
  | { type: 'weaponBroke'; tick: number; playerId: PlayerId; itemId: string }
  | { type: 'wounded'; tick: number; playerId: PlayerId; part: BodyPart; wound: WoundKind }
  /** Dev builds only (`init.dev`): every noise of the tick, for debug circles. */
  | {
      type: 'noise';
      tick: number;
      x: number;
      y: number;
      z: number;
      radiusTiles: number;
      volume: number;
      source: NoiseSource;
    }
  /**
   * A zombie (StableId) started investigating a noise or chasing a player (growl sound, HUD).
   * Not emitted again while it stays in that state.
   */
  | {
      type: 'zombieAlerted';
      tick: number;
      zombie: number;
      reason: ZombieAlertReason;
      x: number;
      y: number;
    }
  | { type: 'fellAsleep'; tick: number; playerId: PlayerId }
  /**
   * Uninterrupted sleep long enough (`sleep.saveAfterRealSec`, 2 real minutes at ×1): the host
   * saves the game now (the worker posts `saved` with reason `sleep`).
   */
  | { type: 'sleepSaved'; tick: number; playerId: PlayerId; fatigueRecovered: number }
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
  | { type: 'dayPassed'; tick: number; day: number }
  | {
      type: 'actionStarted';
      tick: number;
      playerId: PlayerId;
      action: ActionKind;
      endTick: number;
      item?: ItemId;
      container?: ContainerId;
    }
  | { type: 'actionCompleted'; tick: number; playerId: PlayerId; action: ActionKind }
  | {
      type: 'actionInterrupted';
      tick: number;
      playerId: PlayerId;
      action: ActionKind;
      reason: ActionInterruptReason;
    }
  /** Loot panel opened (`firstSearch` = this search generated the loot). */
  | {
      type: 'containerOpened';
      tick: number;
      playerId: PlayerId;
      container: ContainerId;
      firstSearch: boolean;
    }
  /** Ate / drank / used an item (content id), e.g. for sounds and toasts. */
  | {
      type: 'itemUsed';
      tick: number;
      playerId: PlayerId;
      action: ActionKind;
      itemId: string;
      freshness?: Freshness;
    };

/** Food and drink state from `spoilage.freshMin` / `rottenMin` (lazy, per game minute). */
export type Freshness = 'fresh' | 'stale' | 'rotten';
