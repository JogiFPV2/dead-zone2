import type { EdgeSide, OpeningState } from './map.js';

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

/**
 * Takes an item (or `count` of a stack) out of `container` (reachable storage, ground pile or bag
 * there) into the main inventory. Rejected with `no-space` when it does not fit the carry limit.
 */
export interface TakeItemCommand extends CommandHeader {
  type: 'takeItem';
  container: ContainerId;
  item: ItemId;
  count?: number | undefined;
}

/**
 * Takes everything from `container` into the main inventory, in container order; items that do
 * not fit (carry hard limit) stay. Rejected with `no-space` only when nothing could be taken.
 */
export interface TakeAllCommand extends CommandHeader {
  type: 'takeAll';
  container: ContainerId;
}

/** Puts a carried item (or `count` of a stack) into `container` (reachable, capacity checked). */
export interface PutItemCommand extends CommandHeader {
  type: 'putItem';
  container: ContainerId;
  item: ItemId;
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
 * Melee attack with the weapon in `hand_primary` (bare hands without one) towards the aim point
 * (last `aim`), or the facing without aim. Rejected with `busy` while the weapon cools down.
 * With a firearm in `hand_primary`: a shot towards the aim point (`no-ammo` when empty, `busy`
 * while reloading, `invalid-state` when jammed).
 */
export interface AttackCommand extends CommandHeader {
  type: 'attack';
}

/** Shove: pushes zombies in front back and staggers them (no damage), costs stamina. */
export interface ShoveCommand extends CommandHeader {
  type: 'shove';
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

/**
 * Opens / closes the door or window on edge (tx, ty, side) of the player's floor, within reach
 * (1.5 tiles from the edge centre). `lock: true` locks a closed door or unlocks a locked one.
 * Rejected with `locked` on a locked door, `invalid-state` on barricaded / broken ones.
 */
export interface ToggleDoorCommand extends CommandHeader {
  type: 'toggleDoor';
  tx: number;
  ty: number;
  side: EdgeSide;
  lock?: boolean | undefined;
}

/** Smashes the window on edge (tx, ty, side) in reach: becomes `broken`, loud `break` noise. */
export interface BreakWindowCommand extends CommandHeader {
  type: 'breakWindow';
  tx: number;
  ty: number;
  side: EdgeSide;
}

/** Dev only (`init.dev`): sets the state of a door / window edge (hp resets to the state's max). */
export interface DebugOpeningCommand extends CommandHeader {
  type: 'debugOpening';
  tx: number;
  ty: number;
  z?: number | undefined;
  side: EdgeSide;
  state: OpeningState;
}

/**
 * Puts a lure (`kind: 'lure'`) from the inventory on the ground at the player. Electronic lures
 * take a battery (`lure.power.batteryTag`) from the inventory when empty and wait for
 * `triggerLure`; timer lures (running) arm at once: after `delaySec` (clamped to
 * `lure.trigger.delaySec`, default its min) they run `runner.distanceTiles` towards (dirX, dirY)
 * (default: the facing) making noise for `lure.durationSec`, then are used up.
 */
export interface PlaceLureCommand extends CommandHeader {
  type: 'placeLure';
  item: ItemId;
  delaySec?: number | undefined;
  dirX?: number | undefined;
  dirY?: number | undefined;
}

/**
 * Triggers a placed remote lure: needs a carried item with the lure's `trigger.remoteTag` and
 * the lure within `trigger.rangeTiles`; uses one activation of its battery. Without `item`: the
 * nearest placed remote lure in range.
 */
export interface TriggerLureCommand extends CommandHeader {
  type: 'triggerLure';
  item?: ItemId | undefined;
}

/**
 * Throws a carried item towards (x, y) (world coordinates), at most its `throwable.rangeTiles`
 * (lures without `throwable`: 8 tiles); walls stop it. Impact noise from `throwable.impactNoise`
 * (lures: a small thud); `breaksOnImpact` items break (`brokenInto`). A thrown lure lands placed
 * (timer lures armed with `delaySec` / direction like `placeLure`).
 */
export interface ThrowCommand extends CommandHeader {
  type: 'throw';
  item: ItemId;
  x: number;
  y: number;
  delaySec?: number | undefined;
  dirX?: number | undefined;
  dirY?: number | undefined;
}

/**
 * Reloads the firearm in `hand_primary` (timed, `ranged.reloadSec`, real seconds): internal feed
 * loads carried rounds of `ranged.ammo` up to capacity; magazine feed swaps in the fullest
 * carried magazine (the old one goes to the inventory). Also clears a jam. Switching weapons
 * cancels it. `no-ammo` when there is nothing to load.
 */
export interface ReloadCommand extends CommandHeader {
  type: 'reload';
}

/** Fills a carried magazine with carried rounds of its `magazine.ammo` (timed, per round). */
export interface LoadMagazineCommand extends CommandHeader {
  type: 'loadMagazine';
  item: ItemId;
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
  | TakeItemCommand
  | TakeAllCommand
  | PutItemCommand
  | EquipCommand
  | UnequipCommand
  | OpenContainerCommand
  | CloseContainerCommand
  | UseItemCommand
  | CancelActionCommand
  | AttackCommand
  | ShoveCommand
  | PlaceStorageCommand
  | PickUpStorageCommand
  | DebugWoundCommand
  | DebugStatCommand
  | DebugGiveItemCommand
  | DebugSpawnZombieCommand
  | DebugNoiseCommand
  | ToggleDoorCommand
  | BreakWindowCommand
  | DebugOpeningCommand
  | PlaceLureCommand
  | TriggerLureCommand
  | ThrowCommand
  | ReloadCommand
  | LoadMagazineCommand;
export type CommandType = Command['type'];

export type CommandParseResult = { ok: true; command: Command } | { ok: false; error: string };
