import type { VehiclePart } from './vehicles.js';
import type {
  BodyPart,
  ContainerId,
  EquipSlot,
  ItemId,
  MarkerColor,
  PlayerId,
  WoundKind,
} from './commands.js';
import type { ActionKind, DeathCause, Freshness, LurePhase } from './events.js';
import type { EdgeSide, OpeningState, SimEdgeKind } from './map.js';

/**
 * UI views (docs/sim-architecture.md 4.2): sent by the worker as `{ kind: 'view' }` only when
 * something changed, at most once per batch of ticks. Every field is optional: a missing field
 * means "unchanged since the last view".
 */

/** Stats in the player view (content stat ids). 0–100 except `-c` (°C) and `-kg`. */
export const VIEW_STATS = [
  'health',
  'hunger',
  'thirst',
  'fatigue',
  'endurance',
  'boredom',
  'stress',
  'unhappiness',
  'pain',
  'bleeding',
  'sickness',
  'wetness',
  'satiety',
  'body-temperature-c',
  'body-weight-kg',
] as const;
export type ViewStat = (typeof VIEW_STATS)[number];

export interface ClockView {
  /** Day of the game, from 1. */
  day: number;
  /** 0..1439. */
  minuteOfDay: number;
  /** Ticks per game minute (60-minute day: 50), for smooth day/night between views. */
  ticksPerGameMinute: number;
  /** Tick at which `minuteOfDay` started. */
  minuteStartTick: number;
  /** Speed-up (×2/×4) not allowed now: a zombie chases the player or is within the threat radius. */
  fastForwardBlocked: boolean;
  /** Speed-up the sim counts real time with (`setTimeScale`; 1 after a threat). Always sent. */
  timeScale?: 1 | 2 | 4;
}

/**
 * Current sleep (`player.sleep`, null when awake). Real time: every tick adds
 * 1 / (20 × `clock.timeScale`) s, so with `dayLengthMinutes` 60 (1 game day = 1 real hour)
 * 120 s = 2400 ticks = 48 game minutes at ×1, 9600 ticks = 192 game minutes at ×4.
 */
export interface SleepView {
  sleeping: true;
  /** First tick of this sleep. */
  sleepStartTick: number;
  /** Place: `bed` / `sofa` (furniture within 1.5 tiles) or `floor`. */
  surface: 'floor' | 'sofa' | 'bed';
  /** Fatigue this sleep can recover at most (`sleep.surfaces.<surface>.maxRecoveryPerSleep`). */
  restCap: number;
  /** Fatigue recovered so far (0.1). */
  restGained: number;
  /** Real seconds of uninterrupted sleep (whole seconds). */
  realSec: number;
  /** `sleep.saveAfterRealSec`. */
  saveAfterRealSec: number;
  /** Alarm (`sleep {until}`, protocol 29): the tick the sim wakes the player. */
  wakeAtTick?: number;
  /** `sleepSaved` was emitted for this sleep (the save is due / done). */
  saveReady: boolean;
}

/** A lit window (`SimViewPatch.litWindows`, protocol 34). */
export interface LitWindowView {
  edge: number;
  x: number;
  y: number;
  z: number;
}

/** Range of `SimViewPatch.litWindows` around the player (tiles, Chebyshev). */
export const LIT_WINDOWS_RANGE_TILES = 48;

export interface MoodleView {
  /** Content id, e.g. `base:hunger` (label, polarity and icon come from content). */
  id: string;
  /** 1..maxLevel, 0 = hidden (removed). */
  level: number;
}

export interface WoundView {
  part: BodyPart;
  wound: WoundKind;
  /** Current bleeding of this wound (0–100 scale, after clotting and bandage). */
  bleeding: number;
  /** Healing progress 0..1. */
  healed: number;
  bandaged: boolean;
  bandageDirty: boolean;
  /** Dirt infection (cured by `treatWound` `disinfect`; the zombie virus is never shown). */
  infected: boolean;
  /** Stitched (protocol 27): bleeding × `wounds.stitch.bleedingMul`, heals faster. */
  stitched?: boolean;
  /** Disinfected recently (protocol 27): no new dirt infection for now. */
  disinfected?: boolean;
}

export interface PlayerView {
  alive?: boolean;
  sleeping?: boolean;
  /** Sleep state when it changes (null = awake). */
  sleep?: SleepView | null;
  /** Dirt 0–100 (protocol 33, `survival.hygiene`), rounded, when it changes; absent while 0. */
  dirt?: number;
  /** Changed stats only, rounded to 0.1. */
  stats?: Partial<Record<ViewStat, number>>;
  /** Changed moodles only. */
  moodles?: MoodleView[];
  /** Full list when any wound changed. */
  wounds?: WoundView[];
  /** Current penalties from wounds and pain / fever / bleeding (when any changes). */
  penalties?: PenaltiesView;
  /**
   * Seat in a vehicle when it changes (null = on foot again): `vehicleId` = StableId (vehicle
   * snapshot block), `seat` = index in the vehicle type's `seats` (0 = driver).
   */
  vehicle?: { vehicleId: number; seat: number } | null;
}

/**
 * Losses as fractions 0..`woundPenalties.maxPenalty` (0.15 = −15%): movement speed, melee
 * damage, timed action speed, sight range; `blur` 0..1 = screen blur for the renderer.
 */
export interface PenaltiesView {
  moveSpeed: number;
  attackPower: number;
  actionSpeed: number;
  visionRange: number;
  blur: number;
}

/** One item instance (names, icons and kinds come from content by `def`). */
export interface ItemView {
  id: ItemId;
  /** Content id, e.g. `base:canned-beans`. */
  def: string;
  count: number;
  /** Total weight in kg (stack × `weightKg` + contents, before bag weight reduction). */
  weightKg: number;
  /** Durability points left (items with `durability`; the max is in content). */
  condition?: number;
  /** Portions (food), uses (drink, medical) or loaded rounds (guns, magazines) left. */
  uses?: number;
  /** Items with `spoilage` only. */
  freshness?: Freshness;
  /**
   * Frozen (protocol 25): in a working freezer for `utilities.freezer.freezeAfterMin`, or thawing
   * after it was taken out / the power went off.
   */
  frozen?: boolean;
  /** Thawing: game minutes left until thawed (then it spoils at the normal rate). */
  thawMin?: number;
  /** Burnt food (protocol 31): less nutrition, more unhappiness (`crafting.burn`). */
  burnt?: boolean;
  /** Building key (protocol 26): map-global building id it opens (`SimChunk.roomBuildings`). */
  buildingId?: number;
  /** Own container (bags, placed storage), opened like any other container. */
  container?: ContainerId;
  /** Slots this item is equipped in (two-handed: both hands). */
  equipped?: EquipSlot[];
  /** Placed on the ground as storage (render it as furniture). */
  placed?: boolean;
  /** Car key: StableId of the only vehicle it fits (`worldSettings.vehicles.keyItem`). */
  vehicle?: number;
  /** Gas can (`worldSettings.vehicles.fuel.canItem`): litres inside (0.1) and the capacity. */
  fuelL?: number;
  fuelMaxL?: number;
  /**
   * Part of a `combine` recipe the player knows (carried items only): recipe ids and whether
   * one of them can be done right now (all parts, tools, skills at hand).
   */
  combine?: { recipes: string[]; ready: boolean };
}

/**
 * `corpse` = body of a killed zombie (loot from `zombieType.lootTable`), searched like world
 * storage (`search {container}`), then `takeItem` / `takeAll`.
 */
export type ContainerKind =
  | 'inventory'
  | 'bag'
  | 'world'
  | 'ground'
  | 'corpse'
  /**
   * Trunk of a vehicle (`ContainerView.vehicle`): reached standing behind the car (unlocked),
   * searched like world storage; capacity = the vehicle type's `trunkCapacity`.
   */
  | 'vehicle-trunk'
  /** Glovebox: only from a front seat of that vehicle; capacity `gloveboxCapacity`. */
  | 'vehicle-glovebox';

/** Full content of one container (sent whole when anything in it changes). */
export interface ContainerView {
  id: ContainerId;
  kind: ContainerKind;
  /** Container type id (`containers/`), e.g. `base:fridge`; world and placed storage. */
  type?: string;
  /** Tile of world storage and ground piles. */
  x?: number;
  y?: number;
  z?: number;
  /** Vehicle containers (`vehicle-trunk`, `vehicle-glovebox`): the vehicle's StableId. */
  vehicle?: number;
  /** Null = no limit (main inventory: see `InventoryView.hardLimitKg`; ground). */
  capacityKg: number | null;
  /** Sum of the items' `weightKg`. */
  weightKg: number;
  items: ItemView[];
}

export interface InventoryView {
  /** Main inventory container id (`moveItem.to`). */
  container: ContainerId;
  /** Carried weight after bag weight reduction. */
  loadKg: number;
  /** Carry capacity (`worldSettings.carry.baseCapacityKg` + modifiers). */
  capacityKg: number;
  /** Nothing more can be picked up above this (`capacityKg × hardLimitMultiplier`). */
  hardLimitKg: number;
  /** Stat `carry-load`: `loadKg / capacityKg × 100` (moodle `base:heavy-load` at 100+). */
  carryLoad: number;
  equipped: Partial<Record<EquipSlot, ItemId>>;
  /** Changed containers only: main inventory and containers of carried bags. */
  containers?: ContainerView[];
  /** Carried containers that are gone (bag dropped or moved away). */
  removed?: ContainerId[];
}

/** A storage or ground pile within reach (for the loot panel / highlights). */
export interface NearbyContainerView {
  id: ContainerId;
  kind: ContainerKind;
  type?: string;
  x: number;
  y: number;
  z: number;
  /**
   * This player searched it already (opening is instant). The real per-player state for every
   * kind that must be searched first (`world`, `corpse`, `vehicle-trunk`, `vehicle-glovebox`:
   * false until this player's `search` completes; `openContainer` on it starts the search);
   * always true for ground piles.
   */
  searched: boolean;
  /** Fill 0..1 (see `StorageMarkerView.fillPct`); always set by the sim. */
  fillPct?: number;
  /** Kind `corpse`: StableId of the dead zombie (the body in the snapshot). */
  corpse?: number;
  /**
   * Vehicle containers: the vehicle's StableId; (x, y) = tile of the access point (behind the
   * car for the trunk, the seat for the glovebox).
   */
  vehicle?: number;
}

/** Radius (tiles) of `SimViewPatch.vehicles`. */
export const VEHICLE_VIEW_TILES = 24;

/**
 * Gameplay state of a vehicle near the local player (the physical state is in the vehicle
 * snapshot block): lock, key, fuel and its containers.
 */
export interface VehicleStateView {
  vehicleId: number;
  /** Vehicle type content id. */
  type: string;
  locked: boolean;
  /** A key sits in the ignition (the driver can start the car, `takeVehicleKey` takes it). */
  keyInIgnition: boolean;
  /** The local player carries this car's key. */
  hasKey: boolean;
  /** Hotwired: runs without a key. */
  hotwired: boolean;
  engineOn: boolean;
  /** Fuel in litres (rounded to 0.1) and the tank size. */
  fuel: number;
  fuelMax: number;
  /** Container ids (absent = the type has none). */
  trunk?: ContainerId;
  glovebox?: ContainerId;
  /**
   * PROTOCOL_VERSION 19 (always set by the sim): who sits where, one entry per seat of the type
   * (content `seats`, index = `seat`), PlayerId or null = empty; `driverId` = `seats[0]`.
   */
  seats?: (PlayerId | null)[];
  driverId?: PlayerId | null;
  /**
   * PROTOCOL_VERSION 19 (always set): hp 0..100 (rounded) of the parts not in the snapshot block:
   * `battery` (0 = no start), `fuelTank` (below 100 it leaks).
   */
  parts?: { battery: number; fuelTank: number };
}

/** Radius (tiles) of `SimViewPatch.pumps`. */
export const PUMP_VIEW_TILES = 16;

/**
 * A fuel pump map object (`worldSettings.vehicles.fuel.pumpItem`) near the player (PROTOCOL_VERSION
 * 19): tile, the station's stock in litres (rounded to 0.1; before the first use it is the
 * deterministic roll the first use will start from, never unknown), and how it pumps now:
 * `power` (mains power, `pumpPoweredLps`) or `crank` (hand crank, `pumpManualLps`), `lps` = rate.
 */
export interface PumpView {
  x: number;
  y: number;
  z: number;
  stockL: number;
  source: 'power' | 'crank';
  lps: number;
}

/** Radius (tiles) of `SimViewPatch.storages`. */
export const STORAGE_MARKER_TILES = 24;

/**
 * World storage (shelves, cabinets, fridges ...) for rendering how full it looks. `fillPct` 0..1 =
 * contents weight / `capacityKg` (rounded to 0.05); before the first search it is the weight of
 * the loot the search will generate (deterministic), so shelves look stocked from afar.
 */
export interface StorageMarkerView {
  id: ContainerId;
  type?: string;
  x: number;
  y: number;
  z: number;
  fillPct: number;
  /** This player searched it already. */
  searched: boolean;
}

/** Radius (tiles) of `SimViewPatch.groundPiles`. */
export const GROUND_PILE_MARKER_TILES = 24;

export interface GroundPileView {
  id: ContainerId;
  x: number;
  y: number;
  z: number;
  /** Item defs on top of the pile (first GROUND_PILE_SHOWN, UI order) for the ground models. */
  items?: string[];
}

/** Item models drawn per ground pile (the rest is only in the loot panel). */
export const GROUND_PILE_SHOWN = 4;

export interface ActionView {
  kind: ActionKind;
  /** Progress bar: the UI interpolates between these ticks. */
  startTick: number;
  endTick: number;
  item?: ItemId;
  container?: ContainerId;
  part?: BodyPart;
  /** `craft`: recipe id. */
  recipe?: string;
  /** Actions waiting behind this one. */
  queued: number;
  /** 0..1 = (tick − startTick) / (endTick − startTick), rounded to 0.05; always set by the sim. */
  progress?: number;
  /** `search` of a spot (`search {x, y}`): the tile searched. */
  spot?: { x: number; y: number; z: number };
  /** Openings actions (`barricade`, `smashWindow` …): the target edge. */
  edge?: { tx: number; ty: number; z: number; side: EdgeSide };
  /** Vehicle actions (`enterVehicle`, `hotwire` …): the vehicle and, for `enterVehicle`, the seat. */
  vehicle?: { vehicleId: number; seat?: number; part?: VehiclePart };
  /**
   * Fuel actions (`refuel`, `fillFuel`, `siphonFuel`; PROTOCOL_VERSION 19): where the fuel comes
   * from and the rate in l/s. `power` / `crank` = a pump (`fillFuel`, `refuel` from a pump), `can`
   * = poured from a gas can, `hose` = siphoned. `pump` = the pump tile for pump actions.
   */
  fuel?: {
    source: 'power' | 'crank' | 'can' | 'hose';
    lps: number;
    pump?: { x: number; y: number };
  };
}

/**
 * How well zombies can see the player (protocol 24, docs 9.45): `visibility` 0..1 (× zombie
 * sight range) → `stealth` with these thresholds (≤ hidden max = `hidden`, ≤ dim max = `dim`,
 * else `lit`). Standing still in the dark is `hidden`.
 */
export const STEALTH_LEVELS = ['lit', 'dim', 'hidden'] as const;
export type StealthLevel = (typeof STEALTH_LEVELS)[number];
export const STEALTH_HIDDEN_MAX = 0.1;
export const STEALTH_DIM_MAX = 0.55;
/** Mains utilities (`utilityChanged`, `SimViewPatch.utilities`). */
export const UTILITY_KINDS = ['power', 'water'] as const;
export type UtilityKind = (typeof UTILITY_KINDS)[number];

/**
 * Where a building's power comes from: mains (`grid`, until the shutoff day) or a running
 * generator in range (`generator`; planned, not simulated yet).
 */
export const POWER_SOURCES = ['grid', 'generator'] as const;
export type PowerSource = (typeof POWER_SOURCES)[number];

/** Mains power and water now (protocol 25); the shutoff day is not revealed (like PZ). */
export interface UtilitiesView {
  /** Mains power is on. */
  power: boolean;
  /** Mains water is on (taps, bath, toilet). */
  water: boolean;
  /**
   * Source of power for the player's surroundings: `grid` while mains is on, later `generator`
   * near a running generator; null = no power.
   */
  powerSource: PowerSource | null;
}

/**
 * Reason codes of a disabled furniture action (`FurnitureActionView.reason`), the same codes the
 * sim rejects `useFurniture` with. Polish texts: `FURNITURE_REASONS_PL` (`@deadzone/content`).
 */
export const FURNITURE_REASONS = [
  'no-power',
  'no-water',
  'no-gas',
  'threat',
  'too-heavy',
  'locked',
  'no-key',
  'missing-tool',
  'missing-item',
  'missing-parts',
  'invalid-state',
  'blocked',
  'out-of-range',
  'busy',
  'tired',
  'not-tired',
] as const;
export type FurnitureReason = (typeof FURNITURE_REASONS)[number];

/** One entry of a furniture / edge context menu (protocol 26). */
export interface FurnitureActionView {
  /**
   * Stable action id (`open`, `close`, `smash`, `clear-glass`, `climb-through`, `barricade`,
   * `unbarricade`, `lock`, `unlock`, `unlock-key`, `lock-key`, `lockpick:<itemId>`, `force-pry`,
   * `force-kick`, `knock`, `open-storage`, `watch`, `insert-tape:<itemId>`, …). Actions that use
   * a carried item are `<action>:<itemId>` (one entry per usable item); the prefix groups a
   * submenu.
   */
  id: string;
  labelPl: string;
  enabled: boolean;
  reason?: FurnitureReason;
  /** Polish reason (may be more specific than the code, e.g. "Brak młotka"). */
  reasonPl?: string;
  /**
   * Duration in game minutes (timed actions; absent = instant). The game clock runs fast
   * (`dayLengthMinutes` 60: 1 game minute = 2.5 real s), so a 1 s smash is 0.4 game minute.
   */
  durationMin?: number;
  /**
   * The same duration in real seconds at ×1 speed (0.1 s; before the wound slowdown). Show this
   * for short actions ("1,5 s"), not `durationMin` × 60, which is game seconds (24× more).
   */
  durationSec?: number;
  /** Success chance (lockpick, forcing a door). */
  chancePct?: number;
  /** Chance the tool breaks (lockpick). */
  breakChancePct?: number;
  /** Chance of an injury (smash with a bare hand, glass without gloves, climbing over glass). */
  injuryChancePct?: number;
  /** Noise radius in tiles (smash, force, knock, barricade). */
  noiseTiles?: number;
  /** The item this entry uses (`lockpick:<itemId>`): instance id and content id. */
  item?: { id: ItemId; def: string };
  /**
   * `cook:<recipeId>` (protocol 34): the recipe content id; `labelPl` is then the dish name (the
   * first result item's Polish name), the submenu label is "Gotuj".
   */
  recipe?: string;
}

export interface FurnitureView {
  /**
   * Stable id: edges (doors, windows, gates) = the edge key `openingKey(side, tx, ty, z)`
   * (< 2^42); map objects = 2^42 + ((z + 128) · 2^32 + (y + 2^15) · 2^16 + (x + 2^15)) · 16 + n
   * (n = the object's index among the objects on that tile).
   */
  furnitureId: number;
  /** `door`, `window`, `gate`, or the object's kind (`fridge`, `cabinet`, `tv`, …). */
  typeId: string;
  /** Content id of a map object (absent for edges). */
  contentId?: string;
  /** Position in world metres (tile = 1 m): the tile centre, or the edge centre; `z` = floor. */
  x: number;
  y: number;
  z: number;
  actions: FurnitureActionView[];
}

export interface SimViewPatch {
  clock?: ClockView;
  /** Local player (id 0). */
  player?: PlayerView;
  inventory?: InventoryView;
  /** Opened container (loot panel), full each time it changes; null = closed. */
  container?: ContainerView | null;
  /** Full list of containers in reach when it changes. */
  nearby?: NearbyContainerView[];
  /**
   * Non-empty ground piles within `GROUND_PILE_MARKER_TILES` of the player (world markers),
   * full list when it changes; opening still needs reach (`nearby`).
   */
  groundPiles?: GroundPileView[];
  /**
   * World storage within `STORAGE_MARKER_TILES` of the player, full list when any changes (fill
   * after taking / putting, searched).
   */
  storages?: StorageMarkerView[];
  /** Visible equipment of characters (local player for now, NPCs later), full list on change. */
  characters?: CharacterView[];
  /** Current timed action; null = none. */
  action?: ActionView | null;
  /**
   * Threat level 0–100 for the HUD: zombies chasing the local player and zombies within the
   * threat radius (`worldSettings.survival.sleep.wakeOnZombieTiles`). 0 = safe.
   */
  /**
   * Player visibility to zombies 0..1 (protocol 24): light at the player (sun, shadow, indoors,
   * lamps) × motion × sneaking, rounded to 0.05; sent on change. HUD eye icon: `stealth`.
   */
  visibility?: number;
  stealth?: StealthLevel;
  /** Light level 0..1 at the player (rounded to 0.05; debug / HUD), sent with `visibility`. */
  lightLevel?: number;
  threat?: number;
  /** Combat state of the local player (changes on kills, cooldown and weapon switch). */
  combat?: CombatView;
  /** Set once when the local player dies (death screen). */
  death?: DeathView;
  /**
   * Door / window edges whose state differs from the map default (`closed`, full hp): full list
   * whenever any of them changes (also in the first view after a load).
   */
  openings?: OpeningView[];
  /**
   * Light switches turned on (protocol 32, docs 9.53), full list when it changes. Lamps
   * (`placeable.light` with `requiresPower`) in a room with a switch (same `room`, building, floor)
   * are lit only while it is on and there is power; lamps in rooms without a switch as before.
   */
  lightsOn?: { x: number; y: number; z: number }[];
  /**
   * Windows leaking room light now (protocol 34), computed by the sim: every window of a room lit
   * by a switched-on lamp with power, curtains open and not fully boarded, within
   * `LIT_WINDOWS_RANGE_TILES` of the player. `x, y` = middle of the window edge (tiles), `edge` =
   * `openingKey`. Full list when it changes (also day and night: zombies are lured only at night).
   */
  litWindows?: LitWindowView[];
  /** Placed lures (world markers), full list when any changes (positions rounded to 0.1). */
  lures?: LureView[];
  /** The local player's character (after `newCharacter`; also the first view after a load). */
  characterProfile?: CharacterProfileView;
  /** Skills of the local player, full list when any changes. */
  skills?: SkillView[];
  /** Recipes with their state for the local player and stations nearby, full when it changes. */
  crafting?: CraftingView;
  /** The character's world map: fog of war, trail and markers (docs 9.29). */
  worldMap?: WorldMapView;
  /** Mains power / water: first view and on change (protocol 25). */
  utilities?: UtilitiesView;
  /**
   * Context menu (protocol 26): furniture and edges (doors, windows, …) in reach of the player,
   * the one nearest to the aim point (or the player) first. Full list on change; `[]` = none.
   * Run an action with `useFurniture {furnitureId, actionId}`.
   */
  furnitureActions?: FurnitureView[];
  /**
   * StableIds of the zombies the player senses now (protocol 22): seen (same floor, sight range,
   * line of sight) or heard (within `PlayerMapConfig.hearTiles`, ±1 floor). Ascending, full list
   * when it changes.
   */
  sensedZombies?: number[];
  /**
   * Vehicles within `VEHICLE_VIEW_TILES` (and the one the player sits in): lock, key, fuel,
   * containers; full list (by id) when anything in it changes.
   */
  vehicles?: VehicleStateView[];
  /** Fuel pumps within `PUMP_VIEW_TILES` on the player's floor (stock, source), full on change. */
  pumps?: PumpView[];
  /**
   * HUD target card (PROTOCOL_VERSION 20): what the player locked (`setTarget`), else what is
   * under the aim point, else what they hit in the last `TARGET_LAST_HIT_SEC`. Sent on change;
   * `null` = no target any more (a fresh tracker sends nothing until there is one).
   */
  target?: TargetView | null;
}

/** Kinds of a target card. No NPCs exist in the sim yet (`npc` is reserved). */
export const TARGET_KINDS = ['zombie', 'animal', 'npc', 'vehicle', 'player'] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

/**
 * Behaviour shown on the card: zombies `idle` (also `investigate` / `search`), `wander`,
 * `chasing`, `attacking` (in reach and swinging); animals `idle` (grazing), `wander`, `fleeing`;
 * `dead` for a body (zombie / animal / player hp 0). Vehicles and players have none.
 */
export const TARGET_STATES = [
  'idle',
  'wander',
  'chasing',
  'attacking',
  'fleeing',
  'downed',
  'dead',
] as const;
export type TargetState = (typeof TARGET_STATES)[number];

/** Why this target is shown: lock (`setTarget`), under the aim point, or the last one hit. */
export type TargetSource = 'lock' | 'aim' | 'hit';

/** Range of the target card (lock and hover) in tiles (= m). */
export const TARGET_MAX_TILES = 40;
/** How long the last entity hit stays on the card without a lock or hover (s). */
export const TARGET_LAST_HIT_SEC = 4;
/** Hover pick: the aim point within the entity radius + this many tiles. */
export const TARGET_PICK_TILES = 0.6;

export interface TargetView {
  /** StableId (zombie, animal, player) or vehicle id; with `kind` it is unique. */
  id: number;
  kind: TargetKind;
  /** Content type id (`base:walker`, `base:deer`, `base:sedan`); players: `''`. */
  typeId: string;
  /** Polish display name (content `ENTITY_NAMES_PL`, players: first + last name). */
  name: string;
  /** Health 0..100 (integer); vehicles: average hp of the body zones. */
  hpPct: number;
  /** From the player's centre to the target's centre, 0.1 m. */
  distanceM: number;
  state?: TargetState;
  /**
   * Chance in % that the next attack with the held weapon hits it (integer). Firearm: the shot
   * formula `accuracy × (1 − falloff × distance / range) × aim` (0 beyond range, spread not
   * counted); melee / bare hands: 100 in reach, 0 out of reach. Not set for vehicles.
   */
  hitChancePct?: number;
  /**
   * Weapon in `hand_primary` (bare hands: none): content id (Polish name in the client from the
   * pack's `i18n/pl.json`, like other items) and condition 0..100 (integer).
   */
  weapon?: { id: string; conditionPct: number };
  source: TargetSource;
}

/** A marker on the player's map (`addMarker`). */
export interface MapMarkerView {
  id: number;
  /** Tiles (metres), as given (f32). */
  x: number;
  y: number;
  /** Content id from `worldSettings.mapMarkers.icons`, e.g. `base:marker-food`. */
  icon: string;
  color: MarkerColor;
  /** At most `worldSettings.mapMarkers.maxTextLength` characters. */
  text: string;
  /** Shown on the minimap too (default true; the sim always sets it). */
  showOnMinimap?: boolean;
  /** Floor (protocol 22): `addMarker` without `z` = 0; markers of older saves are on 0. */
  z: number;
}

/** What the character knows about a room (`RoomIntelView.state`); only grows. */
export const ROOM_INTEL_STATES = ['seen', 'searched'] as const;
export type RoomIntelState = (typeof ROOM_INTEL_STATES)[number];

/**
 * A room on the character's floor plan (protocol 22, docs/sim-architecture.md 9.42,
 * docs/floors-ui.md). Same identity as the map data: chunk `(cx, cy)`, level `z` and the
 * chunk-local `RoomId` of its `room` layer; a room crossing chunks is one entry per chunk.
 * - `seen`: some floor tile of the room was in the player's sight (sight range, line of sight).
 * - `searched`: every world storage of the room (this chunk's part) was searched (opened) by the
 *   player; a room without storages becomes `searched` when the player stands in it.
 */
export interface RoomIntelView {
  cx: number;
  cy: number;
  z: number;
  room: number;
  state: RoomIntelState;
}

/** Last observation of a zombie (`WorldMapView.zombieSightings`). */
export interface ZombieSightingView {
  x: number;
  y: number;
  /** Floor (`Math.floor` of the zombie's z). */
  z: number;
  /** Sim tick of the observation. */
  tick: number;
}

/**
 * Patch of the player's world map (docs/sim-architecture.md 9.29). Missing field = unchanged.
 * - `bounds` + `discovered`: in the first view, after a load and after a reset (new
 *   character); later increments come as `chunksDiscovered` events.
 * - `trail`: full trail (first view, load, reset, and after the oldest points were dropped at
 *   `trailMaxPoints`), `trailAdd`: points appended since the last view.
 * - `markers`: full list when it changes.
 */
export interface WorldMapView {
  /** Chunk bounds of the bitmap, inclusive (the world source's bounds). */
  bounds?: { cx0: number; cy0: number; cx1: number; cy1: number };
  /**
   * Discovered chunks: base64 of a bitmap, one bit per chunk, row-major from (cx0, cy0), width
   * cx1 − cx0 + 1, bit i = byte i >> 3, mask 1 << (i & 7). 250 × 250 chunks = 7813 bytes.
   */
  discovered?: string;
  /** Whole trail as points [x0, y0, x1, y1, …] in whole metres (tiles), oldest first. */
  trail?: number[];
  /** Points appended since the last view, same layout. */
  trailAdd?: number[];
  markers?: MapMarkerView[];
  /** Floor plan rooms (all floors): full list in the first view, after a load and a reset. */
  rooms?: RoomIntelView[];
  /** Rooms new or changed (`seen` → `searched`) since the last view, like `trailAdd`. */
  roomsAdd?: RoomIntelView[];
  /**
   * Last observation per zombie the player sensed (`sensedZombies`), at most
   * `MAX_ZOMBIE_SIGHTINGS`, newest first; full list when it changes (about once a second while
   * zombies are sensed). Not saved.
   */
  zombieSightings?: ZombieSightingView[];
}

export interface SkillView {
  id: string;
  level: number;
  xp: number;
  /** XP needed for the next level (null at max). */
  next: number | null;
}

export type RecipeState =
  | 'available'
  /** `requiresLearning` and not learned yet. */
  | 'notLearned'
  | 'skillLocked'
  /** Station missing nearby or below `station.minLevel`. */
  | 'stationLevelLocked'
  | 'missingParts';

export interface RecipePartView {
  item?: string;
  tag?: string;
  have: number;
  need: number;
}

export interface RecipeStatusView {
  id: string;
  kind: 'craft' | 'combine';
  category: string;
  state: RecipeState;
  /** Ingredients (consumed) and tools (need 1, not consumed). */
  parts: RecipePartView[];
  tools: RecipePartView[];
  skills: { skill: string; need: number; have: number }[];
  /**
   * `appliance`: stove part the recipe needs (protocol 31); `noPower`: a station of the right
   * level is near but the needed electric part has no power (state `stationLevelLocked`).
   */
  station?: {
    id: string;
    minLevel: number;
    level: number;
    appliance?: 'burners' | 'oven';
    noPower?: boolean;
  };
  /** Chance (0..1) the food comes out burnt with the current cooking skill (protocol 31). */
  burnChance?: number;
  /** Game minutes with the current skills and station. */
  durationMin: number;
}

export interface StationNearbyView {
  id: string;
  level: number;
  x: number;
  y: number;
  /** Upgrade recipe to the next level (null at max or for map objects). */
  upgrade: string | null;
  /**
   * Stove (protocol 31, `placeable.cooking`): its parts and whether each heats now (gas always,
   * electric only with power). Absent on stations without `cooking`.
   */
  cooking?: {
    burners?: { heat: 'gas' | 'electric'; on: boolean };
    oven?: { heat: 'gas' | 'electric'; on: boolean };
  };
}

export interface CraftingView {
  recipes: RecipeStatusView[];
  stations: StationNearbyView[];
}

/** Weapon / hand pose class for attack and hold animations (from item data). */
export const WEAPON_KINDS = [
  'unarmed',
  'blunt',
  'blade',
  'spear',
  'firearm-short',
  'firearm-long',
  'item',
] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];

/**
 * What a character visibly carries (render: model in hand / on the back, animation set). Melee
 * `blade_short` / `blade_long` → `blade`, `improvised` → `blunt`; ranged `pistol` / `revolver` →
 * `firearm-short`, `shotgun` / `rifle` → `firearm-long`; any other item in hand → `item`.
 */
export interface CharacterView {
  stableId: number;
  /** Content id in `hand_primary`, null = empty hand. */
  equippedPrimary: string | null;
  /** Content id in `back` (backpack, long gun), null = none. */
  equippedBack: string | null;
  weaponKind: WeaponKind;
  /** The primary item takes both hands. */
  twoHanded: boolean;
  /**
   * Sneaking now (protocol 23): the `setSneak` toggle with a walking gait, or a `move` with gait
   * `sneak`. HUD: sneak icon next to the bar.
   */
  sneaking?: boolean;
  /**
   * Footstep noise radius (m = tiles, open ground, before walls) of the current gait with the
   * character's skills and traits (protocol 23); the `playerNoise` circle while moving. 0 when
   * standing still or in a vehicle.
   */
  stepNoiseTiles?: number;
}

export interface LureView {
  item: ItemId;
  def: string;
  phase: Exclude<LurePhase, 'spent' | 'removed'>;
  x: number;
  y: number;
  z: number;
  /** End of the timer / the noise (armed, sounding, running). */
  untilTick?: number;
  /** Activations left (remote lures with a battery). */
  charges?: number;
}

export interface OpeningView {
  tx: number;
  ty: number;
  z: number;
  side: EdgeSide;
  kind: OpeningEdgeKind;
  state: OpeningState;
  /** Hit points left: the edge itself + its planks (0..maxHp). */
  hp: number;
  /** Edge max hp (0 when broken) + planks × `barricade.plankHp`. */
  maxHp: number;
  /** Planks nailed over the edge (0..`barricade.maxPlanks`, 4); > 0 blocks movement. */
  barricade: number;
  /** Window: glass in the frame (a pane, or shards of a broken one until `removeGlass`). */
  glass: boolean;
  /** Window with drawn curtains (protocol 32): hides the light inside from zombies. */
  curtains?: boolean;
}

/** Edge kinds with a state (`openings`). */
export type OpeningEdgeKind = Extract<SimEdgeKind, 'door' | 'window' | 'fence' | 'gate'>;

/**
 * Melee stats of what is in `hand_primary` (PROTOCOL_VERSION 21): any item is a weapon (catalogue
 * melee weapons, improvised ones, weak defaults from weight; `@deadzone/content` `meleeStatsFor`).
 */
export interface MeleeWeaponView {
  source: 'weapon' | 'improvised' | 'default' | 'unarmed';
  damage: { min: number; max: number };
  rangeTiles: number;
  attacksPerSec: number;
  staminaCost: number;
  critChance: number;
  twoHanded: boolean;
  /** Skill that gets XP per hit (none for bare hands). */
  skill?: string;
  /** Chance per swing with a hit to lose a durability point, 0..100. */
  breakChancePct: number;
  /** Condition 0..100 (integer); none for bare hands. */
  conditionPct?: number;
}

export interface CombatView {
  zombiesKilled: number;
  /** Content id of the item (any item: melee, firearm, improvised) in `hand_primary`, null = bare hands. */
  weapon: string | null;
  /**
   * Weapon condition 0..max (null = bare hands). Improvised weapons without own durability:
   * `meleeStatsFor(item).durability` minus the wear (0 = breaks).
   */
  condition: number | null;
  maxCondition: number | null;
  /** Melee stats of the held item (also bare hands); absent while a firearm is held. */
  melee?: MeleeWeaponView;
  /** Tick from which the next attack is possible. */
  readyTick: number;
  /** Firearm in hand: rounds loaded, capacity (magazine feed: of the inserted magazine, 0 = none). */
  ammo?: number;
  capacity?: number;
  /** Firearm jammed (reload clears it). */
  jammed?: boolean;
  /**
   * Reload / magazine loading in progress until this tick (single-round loading: end of the
   * round being loaded now).
   */
  reloadUntil?: number;
  /** Firearm in hand: effective spread this tick (rad, ± around the aim), the same the shot uses. */
  spread?: number;
  /** Reload in progress: kind (`single` = one round per step, `ammo` grows per round). */
  reloadKind?: ReloadKind;
  /** Reload in progress: tick the current step started (with `reloadUntil` → progress locally). */
  reloadStartTick?: number;
  /**
   * Reload in progress: 0..1 = (tick − reloadStartTick) / (reloadUntil − reloadStartTick).
   * `single`: progress of the round being loaded (resets per round).
   */
  reloadProgress?: number;
}

/**
 * Kinds of timed reload: `magazine` = whole reload at once (magazine swap or internal feed
 * filled after `reloadSec`), `single` = internal feed one round per `ranged.loadSecPerRound`,
 * `unjam` = clearing a jam (`reloadSec`), `loadMagazine` = filling a carried magazine.
 */
export const RELOAD_KINDS = ['magazine', 'single', 'unjam', 'loadMagazine'] as const;
export type ReloadKind = (typeof RELOAD_KINDS)[number];

export interface DeathView {
  cause: DeathCause;
  day: number;
  daysSurvived: number;
  zombiesKilled: number;
}

/** Created character: resolved appearance (every tint channel filled), traits incl. free ones. */
export interface CharacterProfileView {
  firstName: string;
  lastName: string;
  appearance: {
    skin: string;
    parts: Record<string, { part: string; colors: { primary?: string; secondary?: string } }>;
  };
  profession: string;
  traits: string[];
  /** Levels bought in the creator (on top of starting level and bonuses). */
  skills: Record<string, number>;
  /** Unspent creation points (≥ 0). */
  pointsLeft: number;
}
