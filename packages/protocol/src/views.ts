import type {
  BodyPart,
  ContainerId,
  EquipSlot,
  ItemId,
  MarkerColor,
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
  /** `sleepSaved` was emitted for this sleep (the save is due / done). */
  saveReady: boolean;
}

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
  /** Dirt infection (curable later with disinfectant; the zombie virus is never shown). */
  infected: boolean;
}

export interface PlayerView {
  alive?: boolean;
  sleeping?: boolean;
  /** Sleep state when it changes (null = awake). */
  sleep?: SleepView | null;
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
  /** Own container (bags, placed storage), opened like any other container. */
  container?: ContainerId;
  /** Slots this item is equipped in (two-handed: both hands). */
  equipped?: EquipSlot[];
  /** Placed on the ground as storage (render it as furniture). */
  placed?: boolean;
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
export type ContainerKind = 'inventory' | 'bag' | 'world' | 'ground' | 'corpse';

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
  /** This player searched it already (opening is instant). */
  searched: boolean;
  /** Fill 0..1 (see `StorageMarkerView.fillPct`); always set by the sim. */
  fillPct?: number;
  /** Kind `corpse`: StableId of the dead zombie (the body in the snapshot). */
  corpse?: number;
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
}

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
  station?: { id: string; minLevel: number; level: number };
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
}

/** Edge kinds with a state (`openings`). */
export type OpeningEdgeKind = Extract<SimEdgeKind, 'door' | 'window' | 'fence' | 'gate'>;

export interface CombatView {
  zombiesKilled: number;
  /** Content id of the weapon (melee or firearm) in `hand_primary`, null = bare hands. */
  weapon: string | null;
  /** Weapon condition 0..max (null = bare hands). */
  condition: number | null;
  maxCondition: number | null;
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
