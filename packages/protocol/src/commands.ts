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
/** Movement gait: speed, footstep noise and needs (`worldSettings.survival.activity`). */
export const GAITS = ['sneak', 'walk', 'run'] as const;
export type Gait = (typeof GAITS)[number];

export interface MoveCommand extends CommandHeader {
  type: 'move';
  dx: number;
  dy: number;
  /** Default `walk`; `run` falls back to walk at 0 endurance. */
  gait?: Gait | undefined;
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
 * Bandages `part` with a medical item with `stop_bleeding` from the player's inventory (timed
 * action, `medical.durationMin`; consumes one use when it completes). `itemId` = content id to
 * pick (e.g. `base:bandage`); omitted = the first bandage found (inventory order).
 * Same as `useItem` on that item with `part`.
 */
export interface BandageCommand extends CommandHeader {
  type: 'bandage';
  part: BodyPart;
  itemId?: string | undefined;
}

/** Item instance id (u32, stable, from views). */
export type ItemId = number;
/** Container id (u32): inventory, bag, world storage or ground pile (from views). */
export type ContainerId = number;

/**
 * Equip slots (same names as `EquipSlot` in packages/content). `hand_primary` = right hand,
 * `hand_secondary` = left hand; two-handed items take both.
 */
export const EQUIP_SLOTS = [
  'hand_primary',
  'hand_secondary',
  'back',
  'belt',
  'head',
  'face',
  'torso_inner',
  'torso_outer',
  'hands',
  'legs',
  'feet',
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];

/** Moves an item (or `count` of a stack) into the player's main inventory. */
export interface PickUpCommand extends CommandHeader {
  type: 'pickUp';
  item: ItemId;
  count?: number | undefined;
}

/** Drops an item (or `count` of a stack) on the ground under the player. */
export interface DropCommand extends CommandHeader {
  type: 'drop';
  item: ItemId;
  count?: number | undefined;
}

/** Moves an item between any two reachable containers (inventory, bag, storage, ground). */
export interface MoveItemCommand extends CommandHeader {
  type: 'moveItem';
  item: ItemId;
  to: ContainerId;
  count?: number | undefined;
}

/** Equips a reachable item (moved into the main inventory first) into `slot`. */
export interface EquipCommand extends CommandHeader {
  type: 'equip';
  item: ItemId;
  slot: EquipSlot;
}

export interface UnequipCommand extends CommandHeader {
  type: 'unequip';
  slot: EquipSlot;
}

/**
 * Opens a container for the loot panel. A world storage not yet searched by this player starts
 * the timed action `search` (`containerType.searchMin`); the loot is generated on first search.
 */
export interface OpenContainerCommand extends CommandHeader {
  type: 'openContainer';
  container: ContainerId;
}

export interface CloseContainerCommand extends CommandHeader {
  type: 'closeContainer';
}

/**
 * Uses an item: eat one portion (food), drink one use (drink), bandage `part` (medical with
 * `stop_bleeding`), unpack an ammo box. Timed actions, queued behind the current one.
 */
export interface UseItemCommand extends CommandHeader {
  type: 'useItem';
  item: ItemId;
  part?: BodyPart | undefined;
}

/** Cancels the current timed action and clears the action queue. */
export interface CancelActionCommand extends CommandHeader {
  type: 'cancelAction';
}

/**
 * Places a storage item (`placeable` with `containerType`, e.g. `base:wooden-crate`) on tile
 * (x, y) of the player's floor, in reach. Its contents stay inside; `pickUp` takes it back.
 */
export interface PlaceStorageCommand extends CommandHeader {
  type: 'placeStorage';
  item: ItemId;
  x: number;
  y: number;
}

/**
 * Picks up a map storage whose type has `pickupItem` (e.g. a wooden crate from the map) as that
 * item, with its contents.
 */
export interface PickUpStorageCommand extends CommandHeader {
  type: 'pickUpStorage';
  container: ContainerId;
}

/** Dev only (`init.dev`): puts `count` items of content id `itemId` into the main inventory. */
export interface DebugGiveItemCommand extends CommandHeader {
  type: 'debugGiveItem';
  itemId: string;
  count?: number | undefined;
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

/**
 * Dev only (`init.dev`): spawns `count` zombies (default 1) around (x, y) on free tiles; `zombieType`
 * is a content id (default: weighted by `spawnWeight`).
 */
export interface DebugSpawnZombieCommand extends CommandHeader {
  type: 'debugSpawnZombie';
  x: number;
  y: number;
  z?: number | undefined;
  count?: number | undefined;
  zombieType?: string | undefined;
}

/** Dev only (`init.dev`): emits a noise at (x, y) (e.g. to test hearing and lures). */
export interface DebugNoiseCommand extends CommandHeader {
  type: 'debugNoise';
  x: number;
  y: number;
  z?: number | undefined;
  radiusTiles: number;
  volume?: number | undefined;
}

export type Command =
  | MoveCommand
  | AimCommand
  | SleepCommand
  | WakeCommand
  | BandageCommand
  | PickUpCommand
  | DropCommand
  | MoveItemCommand
  | EquipCommand
  | UnequipCommand
  | OpenContainerCommand
  | CloseContainerCommand
  | UseItemCommand
  | CancelActionCommand
  | PlaceStorageCommand
  | PickUpStorageCommand
  | DebugWoundCommand
  | DebugStatCommand
  | DebugGiveItemCommand
  | DebugSpawnZombieCommand
  | DebugNoiseCommand;
export type CommandType = Command['type'];

export type CommandParseResult = { ok: true; command: Command } | { ok: false; error: string };
