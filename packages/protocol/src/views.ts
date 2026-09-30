import type { BodyPart, ContainerId, EquipSlot, ItemId, WoundKind } from './commands.js';
import type { ActionKind, DeathCause, Freshness } from './events.js';

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
  /** Changed stats only, rounded to 0.1. */
  stats?: Partial<Record<ViewStat, number>>;
  /** Changed moodles only. */
  moodles?: MoodleView[];
  /** Full list when any wound changed. */
  wounds?: WoundView[];
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
}

export type ContainerKind = 'inventory' | 'bag' | 'world' | 'ground';

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
  /** Actions waiting behind this one. */
  queued: number;
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
}

export interface CombatView {
  zombiesKilled: number;
  /** Content id of the melee weapon in `hand_primary`, null = bare hands. */
  weapon: string | null;
  /** Weapon condition 0..max (null = bare hands). */
  condition: number | null;
  maxCondition: number | null;
  /** Tick from which the next attack is possible. */
  readyTick: number;
}

export interface DeathView {
  cause: DeathCause;
  day: number;
  daysSurvived: number;
  zombiesKilled: number;
}
