import { SAVE_MARKER_COLORS, type SaveMarkerColor } from './api.js';
import type { EdgeSide, OpeningState } from './map.js';
import type { VehiclePart } from './vehicles.js';

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
export const GAITS = ['sneak', 'walk', 'run', 'sprint'] as const;
export type Gait = (typeof GAITS)[number];

export interface MoveCommand extends CommandHeader {
  type: 'move';
  dx: number;
  dy: number;
  /** Default `walk`; `run` falls back to walk at 0 endurance. */
  gait?: Gait | undefined;
}

/**
 * Sneak toggle (client: key `C`, protocol 23). While on, a `move` with `walk` (or no gait) sneaks:
 * × `movement.sneakSpeedMul` speed, quiet footsteps (scaled by `base:sneaking` / `base:lightfoot`)
 * and lower visibility to zombies. A `move` with `run` / `sprint` turns it off (running cancels
 * sneaking, as in PZ). State in `CharacterView.sneaking`.
 */
export interface SetSneakCommand extends CommandHeader {
  type: 'setSneak';
  on: boolean;
}

/** World-space point (tiles) the player is aiming at; the sim derives facing from it. */
export interface AimCommand extends CommandHeader {
  type: 'aim';
  x: number;
  y: number;
}

/**
 * Locks the HUD target card (`SimViewPatch.target`) on entity `id` (StableId of a zombie, animal
 * or player, or a vehicle id), or clears the lock with `null`. UI only: it never changes what an
 * attack hits. Without a lock the card shows the entity under the aim point, else the last one
 * the player hit within `TARGET_LAST_HIT_SEC`. The lock drops by itself when the target is gone,
 * on another floor, farther than `TARGET_MAX_TILES` or out of sight. Rejects: `invalid-target`
 * (unknown id, the player itself, a dead body), `out-of-range` (farther than `TARGET_MAX_TILES`,
 * another floor, no line of sight).
 */
export interface SetTargetCommand extends CommandHeader {
  type: 'setTarget';
  id: number | null;
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

/**
 * Falls asleep on the spot (needs `fatigue ≥ sleep.minFatigueToSleep` and no zombie within
 * `sleep.wakeOnZombieTiles`). Place: the best `placeable.sleepSurface` within 1.5 tiles (bed,
 * sofa), else the floor; it sets the rest limit per sleep (`player.sleep.restCap`).
 */
export interface SleepCommand extends CommandHeader {
  type: 'sleep';
}

/** Wakes up now (`wokeUp {reason: 'command'}`, partial rest kept). */
export interface WakeCommand extends CommandHeader {
  type: 'wake';
}

/**
 * Singleplayer: the host's real-time speed-up (×1/×2/×4, same as the worker `speed` message).
 * The sim only uses it to measure real time (sleep save after `sleep.saveAfterRealSec` real
 * seconds); the tick length never changes. `SimWorkerClient.setSpeed` sends it together with
 * `speed`. A threat (`clock.fastForwardBlocked`) resets it to 1 like the worker does.
 */
export interface SetTimeScaleCommand extends CommandHeader {
  type: 'setTimeScale';
  speed: 1 | 2 | 4;
}

/**
 * Watches the powered TV within `survival.leisure.tvRadiusTiles` (timed action `watch`):
 * without `vhs` a TV session (`leisure.tv.sessionMin` game minutes); with `vhs` = a carried VHS
 * tape (`vhs.watchSec` real seconds at ×1, XP once per character). `useItem` on a tape is the
 * same as `watchTv {vhs}`. Rejects: `no-station` (no TV), `no-power`, `no-item`.
 */
export interface WatchTvCommand extends CommandHeader {
  type: 'watchTv';
  vhs?: ItemId | undefined;
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
 * Opens a container for the loot panel. A world storage, corpse, trunk or glovebox not yet
 * searched by this player (`nearby[].searched` false) starts the timed action `search`
 * (`containerType.searchMin`); the loot is generated on first search.
 */
export interface OpenContainerCommand extends CommandHeader {
  type: 'openContainer';
  container: ContainerId;
}

/**
 * Timed search (`search` action, `worldSettings.loot.search.searchSec` = 3.5 s at ×1, storage with
 * its own `containerType.searchMin` keeps that). Target: `container` = world storage, a zombie
 * corpse (`nearby[]` kind `corpse`) or a car's trunk / glovebox in reach; or a tile `x, y` (player's floor, in reach) = search
 * the spot (bush, ditch, street): hidden items within `search.spotRadiusTiles` of the tile turn
 * into normal ground piles. Movement, an attack / shove or a threat interrupt it
 * (`actionInterrupted`). Storage / corpse contents are not in any view before the search; on
 * completion the container opens (`containerOpened`, `nearby[].searched` true). Rejects:
 * `invalid-target` (neither or both targets, a container that is not storage / corpse / trunk /
 * glovebox),
 * `no-item`, `out-of-range`, `busy`.
 */
export interface SearchCommand extends CommandHeader {
  type: 'search';
  container?: ContainerId | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface CloseContainerCommand extends CommandHeader {
  type: 'closeContainer';
}

/**
 * Uses an item: eat one portion (food), drink one use (drink), bandage `part` (medical with
 * `stop_bleeding`), unpack an ammo box, read (literature), watch a VHS tape on a powered TV
 * nearby (`watch`). Timed actions, queued behind the current one.
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
 * while reloading, `invalid-state` when jammed). Interrupts single-round loading
 * (`reload` event `cancelled`) and fires with the rounds loaded so far. The shot direction is
 * offset by up to the effective spread (`combat.spread`).
 */
export interface AttackCommand extends CommandHeader {
  type: 'attack';
}

/** Shove: pushes zombies in front back and staggers them (no damage), costs stamina. */
export interface ShoveCommand extends CommandHeader {
  type: 'shove';
}

/**
 * Vault (context key): over the nearest standing low fence, or through the nearest open /
 * broken window, within reach of the player's tile edges. Takes ~1 s (physics state `vault`),
 * may trip (knock-down on the far side; more likely running, loaded or tired, less with Nimble /
 * Fitness); a broken window may cut (laceration). Rejects: `invalid-target` (nothing to vault
 * or no room on the far side), `invalid-state` (no control, asleep).
 */
export interface VaultCommand extends CommandHeader {
  type: 'vault';
}

/**
 * Gets into seat `seat` (index in the vehicle type's `seats`) of vehicle `vehicleId`
 * (StableId): a timed action `enterVehicle` (`worldSettings.vehicles.enterSec`, 1.5 s; 0 =
 * instant). The player must stand by that seat's door (within 1.5 tiles), the seat must be free
 * and the car nearly stopped (checked at the start and again at the end). A locked car opens
 * with its key carried (`vehicleLocked {by: 'key'}`) or through a broken window on that door's
 * side (`by: 'window'`). Seat 0 is the driver: the engine starts (`engineStart`) when there is
 * fuel, a working engine and a key (in the ignition or carried) or the car is hotwired. The
 * player gets physics state `driving` (also as a passenger) and moves with the car. Rejects:
 * `invalid-target` (no such vehicle or seat, seat taken), `out-of-range` (too far from the
 * door), `locked` (locked, no key), `invalid-state` (no control, already in a vehicle, the car
 * is moving), `busy`.
 */
export interface EnterVehicleCommand extends CommandHeader {
  type: 'enterVehicle';
  vehicleId: number;
  seat: number;
}

/**
 * Gets out of the current vehicle on the seat's door side: timed action `exitVehicle`
 * (`worldSettings.vehicles.exitSec`, 1 s; 0 = instant). Rejects: `invalid-state` (not in a
 * vehicle, the car is moving), `no-space` (no free exit path; checked again at the end).
 */
export interface ExitVehicleCommand extends CommandHeader {
  type: 'exitVehicle';
}

/**
 * Locks (`locked: true`) / unlocks a vehicle (`vehicleLocked`): from any seat of it always,
 * from outside only with its key carried and within reach of one of its doors. A locked car
 * cannot be entered without the key and its trunk does not open. Rejects: `invalid-target` (no
 * such vehicle), `out-of-range`, `no-key`, `invalid-state` (already locked / unlocked).
 */
export interface LockVehicleCommand extends CommandHeader {
  type: 'lockVehicle';
  vehicleId: number;
  locked: boolean;
}

/**
 * Driver seat, no key at hand: hotwire the car (timed action `hotwire`, noise of kind
 * `hotwire`; chance from Electrical and Mechanics, `worldSettings.vehicles.hotwire`). Success
 * (`hotwired {success: true}`) starts the engine and the car runs without a key from then on.
 * Rejects: `invalid-state` (not the driver, already hotwired, a key in the ignition or carried,
 * engine running), `skill-too-low` (`hotwire.minElectrical` / `minMechanics`), `busy`.
 */
export interface HotwireCommand extends CommandHeader {
  type: 'hotwire';
}

/**
 * Driver: takes the key out of the ignition into the inventory (`vehicleKeyTaken`; a running
 * engine stops, `engineStop {reason: 'key'}`). The key item (`worldSettings.vehicles.keyItem`)
 * fits this vehicle only (`ItemView.vehicle`). Rejects: `invalid-state` (not the driver, no key
 * in the ignition).
 */
export interface TakeVehicleKeyCommand extends CommandHeader {
  type: 'takeVehicleKey';
}

/**
 * Driver: starts (`on: true`, `engineStart`) or stops (`engineStop {reason: 'driver'}`) the
 * engine. Starting needs the key (ignition or carried) or a hotwired car, fuel and a working
 * engine. Rejects: `invalid-state` (not the driver, already so, engine broken), `no-key`,
 * `no-fuel`, `no-power` (dead battery, part `battery` at 0; protocol 19).
 */
export interface VehicleEngineCommand extends CommandHeader {
  type: 'vehicleEngine';
  on: boolean;
}

/**
 * Driver: sounds the horn — loud noise (`worldSettings.vehicles.horn.noise`, zombies hear it),
 * `vehicleHorn` and `playerNoise {kind: 'horn'}`; at most once per `horn.cooldownSec` (extra
 * presses are ignored, not rejected). Rejects: `invalid-state` (not the driver).
 */
export interface HornCommand extends CommandHeader {
  type: 'horn';
}

/**
 * Fills the tank of `vehicleId` (timed `refuel`; on foot, ≤ `fuel.reachTiles` from the car body)
 * from exactly one source:
 * - `item`: a carried gas can (`fuel.canItem`), `fuel.refuelLps`;
 * - `pump` (PROTOCOL_VERSION 19): straight from the fuel pump on tile (x, y) of the player's
 *   floor, no can: the player within `fuel.reachTiles` of the pump tile, the car body within
 *   `fuel.pumpHoseTiles` of it; `pumpPoweredLps` with power, `pumpManualLps` by hand crank; the
 *   station's stock goes down (`SimViewPatch.pumps[].stockL`).
 * An interrupted action pours what it managed. Rejects: `invalid-target` (no car, neither or
 * both sources), `no-item`, `out-of-range` (player or car too far; `detail` `hose` = the car is
 * out of the hose's reach), `no-station`, `no-fuel` (empty can / dry station), `no-space`.
 */
export interface RefuelVehicleCommand extends CommandHeader {
  type: 'refuelVehicle';
  vehicleId: number;
  item?: ItemId | undefined;
  pump?: { x: number; y: number } | undefined;
}

/**
 * Fills the carried gas can `item` at the fuel pump on tile (x, y) (map object
 * `fuel.pumpItem`, within `fuel.reachTiles`): timed `fillFuel`, `pumpPoweredLps` with mains
 * power, `pumpManualLps` without (hand crank). Rejects: `no-item`, `no-station` (no pump there),
 * `out-of-range`, `no-space` (can full), `no-fuel` (the station is dry).
 */
export interface FillFuelCanCommand extends CommandHeader {
  type: 'fillFuelCan';
  item: ItemId;
  x: number;
  y: number;
}

/**
 * Siphons fuel from `vehicleId` into the carried gas can `item` with a hose (a carried item
 * tagged `fuel.hoseTag`): timed `siphonFuel`, `fuel.siphonLps`. Rejects: `no-item`,
 * `missing-tool` (no hose), `out-of-range`, `no-fuel` (empty tank), `no-space` (can full).
 */
export interface SiphonFuelCommand extends CommandHeader {
  type: 'siphonFuel';
  vehicleId: number;
  item: ItemId;
}

/**
 * Repairs / replaces a part of `vehicleId` (timed `repairVehicle`, on foot next to the car):
 * tools (tags) and parts (consumed) per group from `worldSettings.vehicles.repair` (`engine`,
 * `tire*`, `window*`, `body*`, `battery`, `fuelTank`), Mechanics level and XP. Rejects:
 * `invalid-target` (no car / part already at 100), `out-of-range`, `skill-too-low`,
 * `missing-tool`, `missing-parts` (`commandRejected.missing` lists what is lacking).
 */
export interface RepairVehicleCommand extends CommandHeader {
  type: 'repairVehicle';
  vehicleId: number;
  part: VehiclePart;
}

/**
 * Driver controls (held until the next `drive`; reset on exit): throttle and brake 0..1 (brake
 * when stopped = reverse), steer −1..1 (−1 = full left), handbrake (locks the rear wheels: the
 * rear slides). `headlights` toggles the lights when given. Rejects: `invalid-state` (not the
 * driver).
 */
export interface DriveCommand extends CommandHeader {
  type: 'drive';
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  headlights?: boolean | undefined;
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

/**
 * Dev only (`init.dev`, PROTOCOL_VERSION 19): sets `part` of `vehicleId` to `hp` (0..100, like
 * damage or a repair: 0 breaks it, `vehiclePartBroken` is not sent). Rejects: `dev-only`,
 * `invalid-target` (no such car).
 */
export interface DebugDamageVehicleCommand extends CommandHeader {
  type: 'debugDamageVehicle';
  vehicleId: number;
  part: VehiclePart;
  hp: number;
}

/**
 * Dev only (`init.dev`): spawns `count` animals (default 1) around (x, y) on free tiles;
 * `animalType` is a content id (default: weighted by `spawnWeight`).
 */
export interface DebugSpawnAnimalCommand extends CommandHeader {
  type: 'debugSpawnAnimal';
  x: number;
  y: number;
  z?: number | undefined;
  count?: number | undefined;
  animalType?: string | undefined;
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
 * Opens / closes the door, window or gate on edge (tx, ty, side) of the player's floor, within
 * reach (1.5 tiles from the edge centre). `lock: true` locks a closed door / gate or unlocks a
 * locked one. Rejected with `locked` on a locked one, `invalid-state` on barricaded / broken ones.
 */
export interface ToggleDoorCommand extends CommandHeader {
  type: 'toggleDoor';
  tx: number;
  ty: number;
  side: EdgeSide;
  lock?: boolean | undefined;
}

/** Same as `smashWindow` (kept for older clients). */
export interface BreakWindowCommand extends CommandHeader {
  type: 'breakWindow';
  tx: number;
  ty: number;
  side: EdgeSide;
}

/**
 * Area of interest of a player (docs/sim-architecture.md 9.24, docs/streaming.md): the client
 * streamer or the server asks the sim to simulate chunks within `radiusChunks` (Chebyshev) of
 * chunk (cx, cy) in detail, in addition to the area around the player's own position (which is
 * always active, so single player needs no command). `radiusChunks` 0 clears it. Saved and in the
 * hash; without LOD (small maps, everything active) it has no effect. Accepted while dead
 * (spectating).
 */
export interface SetInterestCommand extends CommandHeader {
  type: 'setInterest';
  cx: number;
  cy: number;
  radiusChunks: number;
}

/**
 * Timed actions on the edge (tx, ty, side) of the player's floor, within `openings.reachTiles`
 * (sim `openings/timed.ts`, values in `worldSettings.openings`). Each starts an action (`action`
 * view with `progress`, `actionStarted` / `actionCompleted` / `actionInterrupted`); moving
 * interrupts them (not `climbThrough`), zombies nearby do not.
 * - `smashWindow`: closed / open window without planks → `broken` (loud `break` noise,
 *   `windowSmashed`); bare-handed (nothing in `hand_primary`) may cut the hand.
 * - `climbThrough`: open / broken window without planks → the physics `vault` across it
 *   (`vault.windowTicks`, 1.5 s); shards left in a broken frame may scratch / cut.
 * - `removeGlass`: broken window with shards → frame cleared (`glass: false`).
 * - `barricade`: hammer + plank + nails (`barricade.*`) → one more plank (max 4) on a closed /
 *   locked door or gate, or any window; time shrinks with Carpentry, gives Carpentry XP.
 * - `removeBarricade`: hammer or crowbar → top plank off, the plank back, nails by chance.
 * - `forceDoor`: locked door / gate → crowbar (`pry`) or `kick` (no crowbar): noise, a chance
 *   (+ Strength) to break it (`broken`), else damage; `doorForced`.
 * Rejects: `out-of-range`, `invalid-target` (wrong edge kind), `invalid-state` (wrong state,
 * planks in the way), `missing-tool`, `missing-parts` (planks / nails), `busy`.
 */
export interface OpeningActionCommand extends CommandHeader {
  type: OpeningActionType;
  tx: number;
  ty: number;
  side: EdgeSide;
}

export const OPENING_ACTION_COMMANDS = [
  'smashWindow',
  'climbThrough',
  'removeGlass',
  'barricade',
  'removeBarricade',
  'forceDoor',
] as const;
export type OpeningActionType = (typeof OPENING_ACTION_COMMANDS)[number];

/** Marker colours on the player's map (`worldSettings.mapMarkers.colors` picks from these). */
export const MARKER_COLORS = SAVE_MARKER_COLORS;
export type MarkerColor = SaveMarkerColor;

/**
 * Map markers (docs/sim-architecture.md 9.29), per character. System commands like
 * `setTimeScale`: no `seq` ordering (any seq, not advancing the player's), applied at once in
 * `enqueue` — also while the sim is paused — and answered with `markersChanged` (or
 * `commandRejected`). `x`, `y` in tiles (metres); `icon` from `worldSettings.mapMarkers.icons`,
 * `color` from `.colors`; `text` is cut to `.maxTextLength` (40) characters. Rejections:
 * `invalid-target` (icon / colour not allowed, position outside the world), `marker-limit`
 * (`maxMarkers`, 200), `unknown-marker` (edit / remove of a missing id). `showOnMinimap`
 * (default true) is kept with the marker and saved; it does not affect the simulation.
 */
export interface AddMarkerCommand extends CommandHeader {
  type: 'addMarker';
  x: number;
  y: number;
  /** Floor; default the player's current floor. */
  z?: number | undefined;
  icon: string;
  color: MarkerColor;
  text?: string | undefined;
  showOnMinimap?: boolean | undefined;
}

/** Changes the given fields of marker `id` (see `AddMarkerCommand`). */
export interface EditMarkerCommand extends CommandHeader {
  type: 'editMarker';
  id: number;
  x?: number | undefined;
  y?: number | undefined;
  z?: number | undefined;
  icon?: string | undefined;
  color?: MarkerColor | undefined;
  text?: string | undefined;
  showOnMinimap?: boolean | undefined;
}

/** Removes marker `id`. */
export interface RemoveMarkerCommand extends CommandHeader {
  type: 'removeMarker';
  id: number;
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
 * cancels it. `no-ammo` when there is nothing to load. Internal feed with
 * `ranged.loadSecPerRound` (pump shotgun, hunting rifle) loads one round per step
 * (`reloadKind: 'single'`, `reload` event `round` per round) until full or out of rounds;
 * `attack` interrupts it; a jam there is only cleared. Any reload of a jammed gun has
 * `reloadKind: 'unjam'`.
 */
export interface ReloadCommand extends CommandHeader {
  type: 'reload';
}

/** Fills a carried magazine with carried rounds of its `magazine.ammo` (timed, per round). */
export interface LoadMagazineCommand extends CommandHeader {
  type: 'loadMagazine';
  item: ItemId;
}

/**
 * Crafts recipe `recipe` (content id) `count` times (each a timed `craft` action, queued).
 * Parts come from the inventory and from containers within `worldSettings.crafting.
 * nearbyRadiusTiles` (searched storage, ground piles); tools must be at hand the same way.
 * Rejects: `not-learned`, `skill-too-low`, `no-station` (missing or too low a level),
 * `missing-parts`, `missing-tool`.
 */
export interface CraftCommand extends CommandHeader {
  type: 'craft';
  recipe: string;
  count?: number | undefined;
}

/**
 * Combines 1–4 selected items (`kind: 'combine'` recipe): the first combine recipe (by id) whose
 * parts the selection covers, or `recipe` when given. Selected items are consumed first.
 */
export interface CombineCommand extends CommandHeader {
  type: 'combine';
  items: ItemId[];
  recipe?: string | undefined;
}

/**
 * Upgrades the station item lying on tile (x, y) (a ground pile within the crafting radius) to
 * the next level with that level's recipe; the new station is put on the same tile.
 */
export interface UpgradeStationCommand extends CommandHeader {
  type: 'upgradeStation';
  x: number;
  y: number;
}

/** Dev only: sets a skill level (XP towards the next level reset to 0). */
export interface DebugSkillCommand extends CommandHeader {
  type: 'debugSkill';
  skill: string;
  level: number;
}

/** Dev only: learns a recipe (content id). */
export interface DebugLearnRecipeCommand extends CommandHeader {
  type: 'debugLearnRecipe';
  recipe: string;
}

/** One appearance slot: part id and a palette color id per tint channel of the part. */
export interface AppearanceChoiceSpec {
  part: string;
  colors?: { primary?: string | undefined; secondary?: string | undefined } | undefined;
}

/**
 * Character look: skin color (`characterCreation.skinPalette`) and a part per slot (slot =
 * the part's `slot`, e.g. face, hair, top, bottom, shoes; or `head` once face+hair merge).
 */
export interface AppearanceSpec {
  skin: string;
  parts: Record<string, AppearanceChoiceSpec>;
}

/**
 * Character creator result. Budget (checked by the sim): `startPoints` + `profession.points` −
 * Σ `trait.cost` − Σ skill costs (level N bought costs `skillPointCost[0..N-1]`) ≥ 0.
 */
export interface CharacterSpec {
  firstName: string;
  lastName: string;
  appearance: AppearanceSpec;
  profession: string;
  /** Selectable traits (negative cost = flaw, gives points). Profession `freeTraits` are added. */
  traits?: string[] | undefined;
  /** Levels bought per skill on top of starting level and bonuses (≤ `maxSkillLevelAtStart`). */
  skills?: Record<string, number> | undefined;
}

/**
 * Creates the player's character (once, before or right after the start; `init.character`
 * sends it). Invalid choices: `invalid-character` with `detail` (first problem).
 */
export interface NewCharacterCommand extends CommandHeader {
  type: 'newCharacter';
  character: CharacterSpec;
}

export type Command =
  | MoveCommand
  | AimCommand
  | SleepCommand
  | WakeCommand
  | SetTimeScaleCommand
  | WatchTvCommand
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
  | SearchCommand
  | CloseContainerCommand
  | UseItemCommand
  | CancelActionCommand
  | AttackCommand
  | ShoveCommand
  | VaultCommand
  | EnterVehicleCommand
  | ExitVehicleCommand
  | LockVehicleCommand
  | HotwireCommand
  | TakeVehicleKeyCommand
  | VehicleEngineCommand
  | HornCommand
  | SetTargetCommand
  | SetSneakCommand
  | RefuelVehicleCommand
  | FillFuelCanCommand
  | SiphonFuelCommand
  | RepairVehicleCommand
  | DriveCommand
  | PlaceStorageCommand
  | PickUpStorageCommand
  | DebugWoundCommand
  | DebugStatCommand
  | DebugGiveItemCommand
  | DebugSpawnZombieCommand
  | DebugSpawnAnimalCommand
  | DebugDamageVehicleCommand
  | DebugNoiseCommand
  | ToggleDoorCommand
  | BreakWindowCommand
  | OpeningActionCommand
  | DebugOpeningCommand
  | PlaceLureCommand
  | TriggerLureCommand
  | ThrowCommand
  | ReloadCommand
  | LoadMagazineCommand
  | CraftCommand
  | CombineCommand
  | UpgradeStationCommand
  | DebugSkillCommand
  | DebugLearnRecipeCommand
  | NewCharacterCommand
  | SetInterestCommand
  | AddMarkerCommand
  | EditMarkerCommand
  | RemoveMarkerCommand;
export type CommandType = Command['type'];

export type CommandParseResult = { ok: true; command: Command } | { ok: false; error: string };
