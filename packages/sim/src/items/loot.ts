import { lootTableForContainer } from '@deadzone/content';
import { CHUNK_SIZE, tileIndex, type SimChunkAddress, type SimMap } from '@deadzone/protocol';
import type { LootTableDef } from '../content/adapter.js';
import { deriveSeed, Rng } from '../core/rng.js';
import { roomAt } from '../openings/state.js';
import {
  addContainer,
  createItem,
  fullUses,
  groundPile,
  maxCondition,
  stackLimit,
  tileKey,
  type ItemContainer,
  type ItemInstance,
  type ItemStore,
} from './store.js';

/**
 * World storage from map objects: storage types (`containers/`) and placeables with
 * `containerType`, plus one storage per `compartments` entry. Created once at init in chunk order (z, cy, cx) and object order, so the ids
 * are stable for a given map. Contents are generated lazily on the first search.
 */
export function createWorldContainers(st: ItemStore, map: SimMap, seed: number): void {
  const list = [...(map.listChunks?.() ?? [])].sort(
    (a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx,
  );
  for (const addr of list) createChunkContainers(st, map, seed, addr);
}

/** World storage of one chunk (`createWorldContainers` body; the sim LOD calls it lazily). */
export function createChunkContainers(
  st: ItemStore,
  map: SimMap,
  seed: number,
  addr: SimChunkAddress,
): void {
  const chunk = map.getChunk(addr.cx, addr.cy, addr.z);
  for (const obj of chunk?.objects ?? []) {
    for (const type of storageTypesOf(st, obj.contentId)) addWorldStorage(type, obj);
  }
  function addWorldStorage(type: number, obj: { x: number; y: number }): void {
    const x = addr.cx * CHUNK_SIZE + obj.x;
    const y = addr.cy * CHUNK_SIZE + obj.y;
    const key = tileKey(x, y, addr.z);
    const onTile = st.worldByTile.get(key) ?? [];
    const roomId = chunk?.room?.[tileIndex(obj.x, obj.y)] ?? 0;
    const roomType = roomId ? chunk?.rooms?.[String(roomId)] : undefined;
    const building = roomId ? (chunk?.roomBuildings?.[String(roomId)] ?? 0) : 0;
    const profile = buildingProfile(st, seed, building);
    const t = st.content.containerTypes[type]!;
    const c = addContainer(st, {
      kind: 'world',
      owner: 0,
      type,
      x,
      y,
      z: addr.z,
      capacityKg: t.capacityKg,
      acceptsTags: undefined,
      roomType,
      // Loot depends on the seed and the position only (docs 2.2 "RNG pochodne").
      lootKey: deriveSeed(seed, 'loot', x, y, addr.z, t.id, onTile.length),
      lootDone: false,
      ...(profile === undefined ? {} : { profile }),
    });
    onTile.push(c.id);
    st.worldByTile.set(key, onTile);
  }
}

/**
 * Building profile (`worldSettings.loot.buildingProfiles`): one per building, from the world seed
 * and the map-global building id, so every storage of a house shares it. Undefined outside
 * buildings or without profiles in the content.
 */
export function buildingProfile(st: ItemStore, seed: number, building: number): number | undefined {
  const list = st.content.loot.buildingProfiles ?? [];
  if (building <= 0 || list.length === 0) return undefined;
  return Rng.fromSeed(deriveSeed(seed, 'building-profile', building)).pickWeighted(
    list.map((p) => p.weight),
  );
}

type BuildingProfileDef = NonNullable<ItemStore['content']['loot']['buildingProfiles']>[number];

const profileOf = (st: ItemStore, c: ItemContainer): BuildingProfileDef | undefined =>
  c.profile === undefined ? undefined : st.content.loot.buildingProfiles?.[c.profile];

/**
 * All drops of a storage's first search: the table (scaled by the building profile's
 * `chancePct` / `rollsAdd`), then each matching profile `extra` with its own derived RNG.
 */
function rollStorage(
  st: ItemStore,
  c: ItemContainer,
  table: LootTableDef | undefined,
  out: (def: number, count: number) => void,
): void {
  const prof = profileOf(st, c);
  if (table) {
    const mod = prof ? { chancePct: prof.chancePct, rollsAdd: prof.rollsAdd } : undefined;
    rollTable(st, table, Rng.fromSeed(c.lootKey), 0, out, mod);
  }
  if (!prof || c.type < 0) return;
  const typeId = st.content.containerTypes[c.type]!.id;
  prof.extra.forEach((x, i) => {
    if (!x.containers.includes(typeId)) return;
    if (x.rooms.length > 0 && (!c.roomType || !x.rooms.includes(c.roomType))) return;
    const extra = st.content.lootTableById.get(x.table);
    const rng = Rng.fromSeed(deriveSeed(c.lootKey, 'profile-extra', i));
    if (extra && rng.chance(x.chance)) rollTable(st, extra, rng, 1, out);
  });
}

/**
 * Wear of found loot (`worldSettings.loot.wear`): with `wornChance` an item with durability gets
 * `minPct`–`maxPct` % of it, medicine and drinks with several uses a part of them used up.
 */
export function wearLoot(st: ItemStore, item: ItemInstance, rng: Rng): void {
  const w = st.content.loot.wear;
  if (!w || w.wornChance <= 0) return;
  const def = st.content.items[item.def]!;
  const maxC = maxCondition(def);
  const uses = def.kind === 'medical' || def.kind === 'drink' ? fullUses(def) : 0;
  if (maxC <= 0 && uses <= 1) return;
  if (!rng.chance(w.wornChance)) return;
  const pct = rng.int(w.minPct, w.maxPct);
  if (maxC > 0) item.condition = Math.max(1, Math.round((maxC * pct) / 100));
  if (uses > 1) item.uses = Math.max(1, Math.round((uses * pct) / 100));
}

/**
 * Storage types of a map object: a container type id directly or a placeable's `containerType`,
 * then one more storage per `compartments` entry of that type (fridge-freezer = fridge + freezer
 * on one tile, each with its own loot key, table and spoilage). Compartments have none of their own.
 */
export function storageTypesOf(st: ItemStore, contentId: string): number[] {
  let main = st.content.containerTypeIndex.get(contentId);
  if (main === undefined) {
    const def = st.content.items[st.content.itemIndex.get(contentId) ?? -1];
    const ref = def?.kind === 'placeable' ? def.placeable.containerType : undefined;
    main = ref === undefined ? undefined : st.content.containerTypeIndex.get(ref);
  }
  if (main === undefined) return [];
  const out = [main];
  for (const id of st.content.containerTypes[main]!.compartments ?? []) {
    const t = st.content.containerTypeIndex.get(id);
    if (t !== undefined) out.push(t);
  }
  return out;
}

/**
 * Loot table of a storage (content README "Loot", `lootTableForContainer`): a room table naming
 * this type in `containers`, else the type's own `defaultLootTable`, else the room's general
 * table (`containers` empty). Zombie corpses: the zombie type's `lootTable`.
 */
export function lootTableFor(st: ItemStore, c: ItemContainer): LootTableDef | undefined {
  if (c.kind === 'corpse')
    return c.lootTable ? st.content.lootTableById.get(c.lootTable) : undefined;
  if (c.type < 0) return undefined;
  return lootTableForContainer(
    st.content.lootTables,
    (id) => st.content.lootTableById.get(id),
    st.content.containerTypes[c.type]!,
    c.roomType,
  );
}

/**
 * Effective entry weight: `max(1, floor(weight × pct / 100))`, 0 when pct = 0
 * (`worldSettings.loot.rarityWeightPct`, integers only).
 */
export function lootWeight(st: ItemStore, weight: number, rarity: string): number {
  const pct =
    (st.content.loot.rarityWeightPct as Record<string, number | undefined>)[rarity] ?? 100;
  if (pct <= 0) return 0;
  return Math.max(1, Math.floor((weight * pct) / 100));
}

const MAX_TABLE_DEPTH = 8;

/**
 * Fills a world storage from its loot table with the storage's derived RNG. Items are aged since
 * the world start (food in houses is as old as the apocalypse), stacks split by `maxStack`.
 */
export function generateLoot(
  st: ItemStore,
  c: ItemContainer,
  worldStartMinute: number,
  keys?: BuildingKeys,
): void {
  if (c.lootDone) return;
  c.lootDone = true;
  st.version++;
  const table = lootTableFor(st, c);
  if (!table && c.profile === undefined) return;
  const drops = new Map<number, number>();
  const order: number[] = [];
  rollStorage(st, c, table, (def, count) => {
    if (!drops.has(def)) order.push(def);
    drops.set(def, (drops.get(def) ?? 0) + count);
  });
  // Own derived RNG, so wear never changes what is found.
  const wear = Rng.fromSeed(deriveSeed(c.lootKey, 'wear'));
  for (const def of order) {
    let left = drops.get(def) ?? 0;
    const maxStack = stackLimit(st, st.content.items[def]!);
    while (left > 0) {
      const n = Math.min(left, maxStack);
      wearLoot(st, createItem(st, def, c.id, n, worldStartMinute), wear);
      left -= n;
    }
  }
  if (table?.buildingKey && keys) addBuildingKey(st, c, table.buildingKey, worldStartMinute, keys);
}

/** What a loot roll needs to hand out building keys (map rooms, `openings.locks`). */
export interface BuildingKeys {
  readonly map: SimMap;
  readonly keyTag: string;
  /** Corpses: nearest building within this many tiles of the corpse. */
  readonly corpseRadiusTiles: number;
}

/** Building at (x, y, z), else (radius > 0) the nearest one within `radius` tiles (ring order). */
function buildingNear(map: SimMap, x: number, y: number, z: number, radius: number): number {
  for (let r = 0; r <= radius; r++) {
    let best = 0;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const b = roomAt(map, x + dx, y + dy, z)?.building ?? 0;
        const d = dx * dx + dy * dy;
        if (b > 0 && d < bestD) {
          best = b;
          bestD = d;
        }
      }
    }
    if (best > 0) return best;
  }
  return 0;
}

/**
 * Loot table `buildingKey` (Modules): with that chance a key to the storage's building (a
 * corpse: the building nearest to where the zombie fell) — the first item with `keyTag`.
 * Own derived RNG, so the rest of the loot does not change.
 */
function addBuildingKey(
  st: ItemStore,
  c: ItemContainer,
  chance: number,
  minute: number,
  keys: BuildingKeys,
): void {
  const def = st.content.items.findIndex((d) => d.tags.includes(keys.keyTag));
  if (def < 0) return;
  if (Rng.fromSeed(deriveSeed(c.lootKey, 'building-key')).nextFloat() >= chance) return;
  const x = Math.floor(c.x);
  const y = Math.floor(c.y);
  const building = buildingNear(
    keys.map,
    x,
    y,
    c.z,
    c.kind === 'corpse' ? keys.corpseRadiusTiles : 0,
  );
  if (building <= 0) return;
  const key = createItem(st, def, c.id, 1, minute);
  key.buildingId = building;
}

/**
 * Weight (kg) of the loot a first search of `c` will generate, without generating it (same
 * derived RNG, so the result never changes); 0 for containers without a table.
 */
export function previewLootWeight(st: ItemStore, c: ItemContainer): number {
  const table = lootTableFor(st, c);
  if (!table && c.profile === undefined) return 0;
  let kg = 0;
  rollStorage(st, c, table, (def, count) => {
    kg += st.content.items[def]!.weightKg * count;
  });
  return kg;
}

function rollTable(
  st: ItemStore,
  table: LootTableDef,
  rng: Rng,
  depth: number,
  out: (def: number, count: number) => void,
  /** Building profile on the storage's own table (top level only). */
  mod?: { chancePct: number; rollsAdd: number },
): void {
  if (depth > MAX_TABLE_DEPTH) return;
  const chance = mod ? Math.min(1, (table.chance * mod.chancePct) / 100) : table.chance;
  if (!rng.chance(chance)) return;
  const weights = table.entries.map((e) => lootWeight(st, e.weight, e.rarity));
  const rolls = Math.max(0, rng.int(table.rolls.min, table.rolls.max) + (mod?.rollsAdd ?? 0));
  for (let r = 0; r < rolls; r++) {
    const i = rng.pickWeighted(weights);
    const e = table.entries[i];
    if (!e) continue;
    const count = rng.int(e.count.min, e.count.max);
    if ('item' in e) {
      const def = st.content.itemIndex.get(e.item);
      if (def !== undefined && count > 0) out(def, count);
    } else {
      const nested = st.content.lootTableById.get(e.table);
      for (let k = 0; nested && k < count; k++) rollTable(st, nested, rng, depth + 1, out);
    }
  }
}

/** Floor loot at init (first playable build): chance per room / per chunk outdoors. */
export const FLOOR_LOOT = { roomChance: 0.6, outdoorChance: 0.35 } as const;

/**
 * Deterministic items lying on the floor (seed + chunk only): per room of a chunk one item from
 * the room's loot table with `roomChance`, and outdoors (floor tiles without a room, e.g. by
 * roads) one item from a random table with `outdoorChance`. Items go to ground piles, so they
 * show up in `nearby` and can be picked up with `pickUp`.
 */
export function scatterFloorLoot(
  st: ItemStore,
  map: SimMap,
  seed: number,
  worldStartMinute: number,
): void {
  if (st.content.lootTables.length === 0) return;
  const list = [...(map.listChunks?.() ?? [])].sort(
    (a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx,
  );
  for (const addr of list) scatterFloorLootChunk(st, map, seed, worldStartMinute, addr);
}

/** Floor loot of one chunk (`scatterFloorLoot` body; the sim LOD calls it lazily). */
export function scatterFloorLootChunk(
  st: ItemStore,
  map: SimMap,
  seed: number,
  worldStartMinute: number,
  addr: SimChunkAddress,
): void {
  const tables = st.content.lootTables;
  if (tables.length === 0) return;
  // Content with `scatter` tables places the outdoor items itself (items/search.ts).
  const outdoor = st.content.scatterTables.length === 0;
  const chunk = map.getChunk(addr.cx, addr.cy, addr.z);
  if (!chunk) return;
  const rng = Rng.fromSeed(deriveSeed(seed, 'floor-loot', addr.cx, addr.cy, addr.z));
  const byRoom = new Map<number, number[]>();
  for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
    if (!(chunk.floor[i] ?? 0)) continue;
    const room = chunk.room?.[i] ?? 0;
    let tiles = byRoom.get(room);
    if (!tiles) byRoom.set(room, (tiles = []));
    tiles.push(i);
  }
  for (const room of [...byRoom.keys()].sort((a, b) => a - b)) {
    const tiles = byRoom.get(room)!;
    const type = room ? chunk.rooms?.[String(room)] : undefined;
    const table = type
      ? tables.find((t) => t.rooms.includes(type))
      : tables[rng.int(0, tables.length - 1)];
    if (!rng.chance(room ? FLOOR_LOOT.roomChance : FLOOR_LOOT.outdoorChance) || !table) continue;
    if (!room && !outdoor) continue;
    // Rooms: `worldSettings.loot.floorRoomItems` items (no extra draw when min = max).
    const r = st.content.loot.floorRoomItems ?? { min: 1, max: 1 };
    const n = room && r.max > r.min ? rng.int(r.min, r.max) : room ? r.min : 1;
    for (let k = 0; k < n; k++) placeFloorItem(table, tiles);
  }

  function placeFloorItem(table: LootTableDef, tiles: number[]): void {
    const i = tiles[rng.int(0, tiles.length - 1)]!;
    const x = addr.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
    const y = addr.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
    const weights = table.entries.map((e) => lootWeight(st, e.weight, e.rarity));
    let e = table.entries[rng.pickWeighted(weights)];
    // One level of nested tables is enough for single floor items.
    if (e && !('item' in e)) {
      const nested = st.content.lootTableById.get(e.table);
      e =
        nested?.entries[
          rng.pickWeighted(nested.entries.map((n) => lootWeight(st, n.weight, n.rarity)))
        ];
    }
    if (!e || !('item' in e)) return;
    const def = st.content.itemIndex.get(e.item);
    if (def === undefined) return;
    const count = Math.min(Math.max(1, e.count.min), stackLimit(st, st.content.items[def]!));
    const item = createItem(st, def, groundPile(st, x, y, addr.z).id, count, worldStartMinute);
    wearLoot(st, item, Rng.fromSeed(deriveSeed(seed, 'floor-wear', item.id)));
  }
}
