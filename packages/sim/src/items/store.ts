import type { LureState } from '../lures/lures.js';
import { createProgress, type PlayerProgress } from '../progress/skills.js';
import type { CharacterState } from '../character/character.js';
import type { ContainerKind, EquipSlot } from '@deadzone/protocol';
import type { ContentIndex, ItemDef } from '../content/adapter.js';

/**
 * Item instances live outside ECS (docs/sim-architecture.md 2.2, `ItemStore`): a house holds
 * hundreds of items, but only things that act every tick are entities. Everything here is plain
 * data with integer ids handed out in a fixed order, so the store is part of the state hash.
 */
export interface ItemInstance {
  /** u32, never reused. */
  readonly id: number;
  /** Index into `ContentIndex.items` (sorted content ids). */
  def: number;
  /** Id of the container holding the item. */
  loc: number;
  count: number;
  /** Durability points left (0 for items without `durability`). */
  condition: number;
  /** Portions (food), uses (drink, medical), loaded rounds (guns, magazines). */
  uses: number;
  /** Spoilage age in game minutes at `ageStamp` (f32); see items/spoilage.ts. */
  ageMin: number;
  /** Absolute game minute when `ageMin` was written. */
  ageStamp: number;
  /** Own container (bags, storage placeables), 0 = none. */
  inner: number;
  /** Placed on the ground as storage (furniture), only for items with an inner storage. */
  placed: boolean;
  /** Car key: StableId of the vehicle it fits (`vehicles/keys.ts`); absent on other items. */
  vehicle?: number;
  /** Gas can: litres inside (`vehicles/fuel.ts`); absent = empty. */
  fuelL?: number;
  /**
   * Improvised weapon wear: durability points lost while fighting with an item that has no own
   * durability (`meleeStatsFor(item).durability` is the pool, `combat/system.ts`); absent = 0.
   */
  wear?: number;
  /**
   * Frozen food out of the cold (taken out of a freezer or the power went off): thaws until this
   * absolute game minute, ageing at `utilities.freezer.frozenSpoilageMultiplier` (items/spoilage.ts).
   * Unset = not thawing.
   */
  thawUntil?: number;
  /** Building key: map-global building id it opens (`SimChunk.roomBuildings`). */
  buildingId?: number;
  /** Burnt cooked food (`crafting.burn`, docs 9.52); absent = not burnt. */
  burnt?: true;
}

/**
 * Container kinds in the store: the protocol kinds plus `hidden` = a cache of hidden items on a
 * tile (never in a view, unreachable; a spot search turns its items into a ground pile).
 */
export type StoreContainerKind = ContainerKind | 'hidden';

export interface ItemContainer {
  readonly id: number;
  readonly kind: StoreContainerKind;
  /** inventory: player StableId; bag: owning item id; world / ground: 0. */
  readonly owner: number;
  /** Storage type index (`ContentIndex.containerTypes`), −1 = none. */
  readonly type: number;
  /** Tile of world storage and ground piles (0 otherwise). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Infinity = no own limit (inventory: carry hard limit; ground). */
  readonly capacityKg: number;
  /** Bags: only items with one of these tags (`bag.acceptsTags`). */
  readonly acceptsTags: readonly string[] | undefined;
  /** Item ids in UI order (insertion). */
  readonly items: number[];
  /** World storage: room type for the loot table (undefined = outside). */
  readonly roomType: string | undefined;
  /** World storage: derived-RNG key (position, type and ordinal on the tile). */
  readonly lootKey: number;
  /** World storage: loot generated (lazily on the first search). */
  lootDone: boolean;
  /** StableIds of players who searched it (opening is instant afterwards). */
  readonly searchedBy: number[];
  /** Corpse: loot table id of the zombie type (`zombieType.lootTable`), undefined = none. */
  readonly lootTable?: string | undefined;
}

/** Per-player item state: main inventory, equip slots, open container, timed actions. */
export interface PlayerItems {
  readonly inventory: number;
  readonly slots: Map<EquipSlot, number>;
  /** Long/two-handed weapon carried on the back alongside a back slot item (usually a bag). */
  backWeapon: number;
  /** Open container (loot panel), 0 = none. */
  open: number;
  /** Timed actions: `current` then the queue (see actions/queue.ts). */
  current: ActionState | undefined;
  readonly queue: ActionState[];
}

export interface ActionState {
  kind: number;
  /** Set when the action starts. */
  startTick: number;
  endTick: number;
  item: number;
  container: number;
  /** Body part index for bandages, −1 otherwise. */
  part: number;
  /** Craft: recipe index + 1 (0 = none). */
  recipe: number;
  /** Craft: items to consume first (`combine` selection, the station being upgraded). */
  use: number[];
  /** Search of a spot (`search {x, y}`; `container` 0): the tile searched. */
  spot?: { x: number; y: number; z: number } | undefined;
  /** Openings actions (`openings/timed.ts`): the edge (`openingKey`). */
  edge?: number | undefined;
  /** `forceDoor` from the menu: crowbar or kick (absent = crowbar when carried). `useKey`: lock. */
  method?: 'pry' | 'kick' | 'lock' | 'unlock' | undefined;
  /** Vehicle actions (`vehicles/actions.ts`): the vehicle's StableId and the seat / part. */
  vehicle?: number | undefined;
  seat?: number | undefined;
  /** `fillFuelCan`: the pump tile (x, y; the player's floor). */
  pump?: [number, number] | undefined;
  /** `drinkTank` / `fillWater`: the map object (tile x, y, z, index on the tile). */
  fixture?: [number, number, number, number] | undefined;
  /**
   * `moveFurniture` (`physics/furniture.ts`): origin key of the piece, mode (0 push, 1 pull,
   * 2 rotate) and the player's side of it at the start (the direction stays fixed).
   */
  furniture?: { origin: string; mode: number; dir: { dx: number; dy: number } } | undefined;
}

export interface ItemStore {
  readonly content: ContentIndex;
  readonly items: Map<number, ItemInstance>;
  readonly containers: Map<number, ItemContainer>;
  /** Player StableId → state. */
  readonly players: Map<number, PlayerItems>;
  /** `x,y,z` → ground pile container id. */
  readonly ground: Map<string, number>;
  /** `x,y,z` → world storage ids on that tile (from the map, fixed at init). */
  readonly worldByTile: Map<string, number[]>;
  /** Zombie StableId → its corpse container (kind `corpse`, created on the kill). */
  readonly corpses: Map<number, number>;
  /** `x,y,z` → hidden cache container on that tile (kind `hidden`, scattered loot). */
  readonly hidden: Map<string, number>;
  nextItemId: number;
  nextContainerId: number;
  /** Magazine-fed firearms: weapon item id → content index of the inserted magazine. */
  readonly magOf: Map<number, number>;
  /** Jammed firearms (item ids); `reload` clears. */
  readonly jammed: Set<number>;
  /** Placed lures by item id (lures/lures.ts). */
  readonly lures: Map<number, LureState>;
  /** Player StableId → skills and learned recipes (progress/skills.ts). */
  readonly progress: Map<number, PlayerProgress>;
  /** Player StableId → created character (character/character.ts). */
  readonly characters: Map<number, CharacterState>;
  /**
   * Player StableId → trait id → game minute its `gainedWhen` / `lostWhen` condition started
   * holding (character/dynamic-traits.ts); only running conditions.
   */
  readonly traitSince: Map<number, Record<string, number>>;
  /** Player StableId → content ids of VHS tapes watched to the end (sorted; leisure). */
  readonly vhsWatched: Map<number, string[]>;
  /** Fuel pumps: `tileKey` → litres left (`vehicles/fuel.ts`; rolled on first use). */
  readonly pumps: Map<string, number>;
  /**
   * Furniture water tanks (`placeable.waterTank`, `furniture/water.ts`): `x,y,z,n` → litres
   * left, only tanks that are not full; undefined when none (older saves = all full).
   */
  waterTanks?: Map<string, number> | undefined;
  /** Mains power (fridges, TVs, stoves, pumps); goes off on `powerOffDay` (items/utilities.ts). */
  powered: boolean;
  /** Mains water (taps); goes off on `waterOffDay`. */
  water: boolean;
  /** Absolute game day (`dayOf`) the power goes off; 0 = never. Rolled from the seed at init. */
  powerOffDay: number;
  waterOffDay: number;
  /** Bumped on any change (views and carry-load recompute). Not state. */
  version: number;
}

export const tileKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

export function createItemStore(content: ContentIndex): ItemStore {
  return {
    content,
    items: new Map(),
    containers: new Map(),
    players: new Map(),
    ground: new Map(),
    worldByTile: new Map(),
    corpses: new Map(),
    hidden: new Map(),
    lures: new Map(),
    progress: new Map(),
    characters: new Map(),
    traitSince: new Map(),
    vhsWatched: new Map(),
    magOf: new Map(),
    jammed: new Set(),
    nextItemId: 1,
    nextContainerId: 1,
    pumps: new Map(),
    powered: true,
    water: true,
    powerOffDay: 0,
    waterOffDay: 0,
    version: 0,
  };
}

export function addContainer(
  st: ItemStore,
  c: Omit<ItemContainer, 'id' | 'items' | 'lootDone' | 'searchedBy'> & { lootDone?: boolean },
): ItemContainer {
  const container: ItemContainer = {
    ...c,
    id: st.nextContainerId++,
    items: [],
    lootDone: c.lootDone ?? true,
    searchedBy: [],
  };
  st.containers.set(container.id, container);
  st.version++;
  return container;
}

const plain = {
  owner: 0,
  type: -1,
  x: 0,
  y: 0,
  z: 0,
  acceptsTags: undefined,
  roomType: undefined,
  lootKey: 0,
} as const;

export function createPlayerItems(st: ItemStore, stableId: number): PlayerItems {
  const inv = addContainer(st, {
    ...plain,
    kind: 'inventory',
    owner: stableId,
    capacityKg: Infinity,
  });
  const p: PlayerItems = {
    inventory: inv.id,
    slots: new Map(),
    backWeapon: 0,
    open: 0,
    current: undefined,
    queue: [],
  };
  st.players.set(stableId, p);
  st.progress.set(stableId, createProgress(st.content));
  return p;
}

export const defOf = (st: ItemStore, item: ItemInstance): ItemDef => st.content.items[item.def]!;

/** Items with their own container never stack (one container per instance). */
export function stackLimit(st: ItemStore, def: ItemDef): number {
  return def.kind === 'container' || placeableType(st, def) >= 0 ? 1 : def.maxStack;
}

/** Durability pool of a definition (0 = none). */
export function maxCondition(def: ItemDef): number {
  switch (def.kind) {
    case 'weapon_melee':
      return def.melee.durability.max;
    case 'weapon_ranged':
      return def.ranged.durability.max;
    case 'tool':
      return def.tool.durability?.max ?? 0;
    case 'clothing':
      return def.clothing.durability?.max ?? 0;
    default:
      return 0;
  }
}

/** Uses of a fresh item: portions, sips, medical uses; guns and magazines start empty. */
export function fullUses(def: ItemDef): number {
  switch (def.kind) {
    case 'food':
      return def.food.portions;
    case 'drink':
      return def.drink.uses;
    case 'medical':
      return def.medical.uses;
    default:
      return 0;
  }
}

/** Storage type of a placeable (`placeable.containerType`), −1 = none. */
export function placeableType(st: ItemStore, def: ItemDef): number {
  if (def.kind !== 'placeable' || !def.placeable.containerType) return -1;
  return st.content.containerTypeIndex.get(def.placeable.containerType) ?? -1;
}

/**
 * Creates `count` of definition `def` in container `loc` (one instance, no stack merging; the
 * caller splits by `maxStack`). Bags and storage placeables get their own container.
 */
export function createItem(
  st: ItemStore,
  def: number,
  loc: number,
  count: number,
  ageStamp: number,
): ItemInstance {
  const d = st.content.items[def]!;
  const item: ItemInstance = {
    id: st.nextItemId++,
    def,
    loc,
    count,
    condition: maxCondition(d),
    uses: fullUses(d),
    ageMin: 0,
    ageStamp,
    inner: 0,
    placed: false,
  };
  st.items.set(item.id, item);
  if (d.kind === 'container') {
    item.inner = addContainer(st, {
      ...plain,
      kind: 'bag',
      owner: item.id,
      capacityKg: d.bag.capacityKg,
      acceptsTags: d.bag.acceptsTags,
    }).id;
  } else {
    const type = placeableType(st, d);
    if (type >= 0) {
      item.inner = addContainer(st, {
        ...plain,
        kind: 'bag',
        owner: item.id,
        type,
        capacityKg: st.content.containerTypes[type]!.capacityKg,
      }).id;
    }
  }
  st.containers.get(loc)!.items.push(item.id);
  st.version++;
  return item;
}

/** Removes an item (and, recursively, its contents) from the store. */
export function destroyItem(st: ItemStore, item: ItemInstance): void {
  const c = st.containers.get(item.loc);
  if (c) removeFrom(c, item.id);
  if (c) dropEmptyPile(st, c);
  if (item.inner) {
    const inner = st.containers.get(item.inner);
    for (const id of [...(inner?.items ?? [])]) {
      const child = st.items.get(id);
      if (child) destroyItem(st, child);
    }
    st.containers.delete(item.inner);
  }
  st.items.delete(item.id);
  unequipEverywhere(st, item.id);
  st.version++;
}

export function removeFrom(c: ItemContainer, id: number): void {
  const i = c.items.indexOf(id);
  if (i >= 0) c.items.splice(i, 1);
}

export function unequipEverywhere(st: ItemStore, itemId: number): void {
  for (const p of st.players.values()) {
    for (const [slot, id] of [...p.slots]) if (id === itemId) p.slots.delete(slot);
    if (p.backWeapon === itemId) p.backWeapon = 0;
  }
}

/** Full weight of an item: stack × weight + contents (no bag reduction). */
export function itemWeight(st: ItemStore, item: ItemInstance): number {
  const w = defOf(st, item).weightKg * item.count;
  return item.inner ? w + containerWeight(st, item.inner) : w;
}

export function containerWeight(st: ItemStore, id: number): number {
  const c = st.containers.get(id);
  let sum = 0;
  for (const itemId of c?.items ?? []) {
    const item = st.items.get(itemId);
    if (item) sum += itemWeight(st, item);
  }
  return sum;
}

/** The item owning a bag container, or undefined for inventories, storage and ground. */
export function ownerItem(st: ItemStore, c: ItemContainer): ItemInstance | undefined {
  return c.kind === 'bag' ? st.items.get(c.owner) : undefined;
}

/** True when container `id` is `ancestor` or nested inside an item held by it. */
export function isInside(st: ItemStore, id: number, ancestor: number): boolean {
  let cur = st.containers.get(id);
  for (let depth = 0; cur && depth < 64; depth++) {
    if (cur.id === ancestor) return true;
    const owner = ownerItem(st, cur);
    if (!owner) return false;
    cur = st.containers.get(owner.loc);
  }
  return false;
}

/** Outermost container of `id` (inventory, world storage or ground pile). */
export function rootContainer(st: ItemStore, id: number): ItemContainer | undefined {
  let cur = st.containers.get(id);
  for (let depth = 0; cur && depth < 64; depth++) {
    const owner = ownerItem(st, cur);
    if (!owner) return cur;
    cur = st.containers.get(owner.loc);
  }
  return cur;
}

export function groundPile(st: ItemStore, x: number, y: number, z: number): ItemContainer {
  const key = tileKey(x, y, z);
  const id = st.ground.get(key);
  const hit = id === undefined ? undefined : st.containers.get(id);
  if (hit) return hit;
  const c = addContainer(st, { ...plain, kind: 'ground', x, y, z, capacityKg: Infinity });
  st.ground.set(key, c.id);
  return c;
}

/** Ground piles disappear when emptied (they are not part of the map). */
export function dropEmptyPile(st: ItemStore, c: ItemContainer): void {
  if (c.kind !== 'ground' || c.items.length > 0) return;
  st.containers.delete(c.id);
  st.ground.delete(tileKey(c.x, c.y, c.z));
  st.version++;
}
