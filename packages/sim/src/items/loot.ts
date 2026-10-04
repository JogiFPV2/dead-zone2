import { CHUNK_SIZE, tileIndex, type SimChunkAddress, type SimMap } from '@deadzone/protocol';
import type { LootTableDef } from '../content/adapter.js';
import { deriveSeed, Rng } from '../core/rng.js';
import {
  addContainer,
  createItem,
  groundPile,
  stackLimit,
  tileKey,
  type ItemContainer,
  type ItemStore,
} from './store.js';

/**
 * World storage from map objects: storage types (`containers/`) and placeables with
 * `containerType`. Created once at init in chunk order (z, cy, cx) and object order, so the ids
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
    const type = storageTypeOf(st, obj.contentId);
    if (type < 0) continue;
    const x = addr.cx * CHUNK_SIZE + obj.x;
    const y = addr.cy * CHUNK_SIZE + obj.y;
    const key = tileKey(x, y, addr.z);
    const onTile = st.worldByTile.get(key) ?? [];
    const roomId = chunk?.room?.[tileIndex(obj.x, obj.y)] ?? 0;
    const roomType = roomId ? chunk?.rooms?.[String(roomId)] : undefined;
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
    });
    onTile.push(c.id);
    st.worldByTile.set(key, onTile);
  }
}

function storageTypeOf(st: ItemStore, contentId: string): number {
  const direct = st.content.containerTypeIndex.get(contentId);
  if (direct !== undefined) return direct;
  const def = st.content.items[st.content.itemIndex.get(contentId) ?? -1];
  if (def?.kind === 'placeable' && def.placeable.containerType) {
    return st.content.containerTypeIndex.get(def.placeable.containerType) ?? -1;
  }
  return -1;
}

/**
 * Loot table of a storage (content README "Loot"): the first table (by id) whose `rooms` has the
 * storage's room type and whose `containers` has its type (empty = any); otherwise the type's
 * `defaultLootTable`; otherwise nothing.
 */
export function lootTableFor(st: ItemStore, c: ItemContainer): LootTableDef | undefined {
  // Zombie corpse: the zombie type's `lootTable`.
  if (c.kind === 'corpse')
    return c.lootTable ? st.content.lootTableById.get(c.lootTable) : undefined;
  if (c.type < 0) return undefined;
  const t = st.content.containerTypes[c.type]!;
  if (c.roomType) {
    for (const table of st.content.lootTables) {
      if (!table.rooms.includes(c.roomType)) continue;
      if (table.containers.length === 0 || table.containers.includes(t.id)) return table;
    }
  }
  return t.defaultLootTable ? st.content.lootTableById.get(t.defaultLootTable) : undefined;
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
export function generateLoot(st: ItemStore, c: ItemContainer, worldStartMinute: number): void {
  if (c.lootDone) return;
  c.lootDone = true;
  st.version++;
  const table = lootTableFor(st, c);
  if (!table) return;
  const rng = Rng.fromSeed(c.lootKey);
  const drops = new Map<number, number>();
  const order: number[] = [];
  rollTable(st, table, rng, 0, (def, count) => {
    if (!drops.has(def)) order.push(def);
    drops.set(def, (drops.get(def) ?? 0) + count);
  });
  for (const def of order) {
    let left = drops.get(def) ?? 0;
    const maxStack = stackLimit(st, st.content.items[def]!);
    while (left > 0) {
      const n = Math.min(left, maxStack);
      createItem(st, def, c.id, n, worldStartMinute);
      left -= n;
    }
  }
}

/**
 * Weight (kg) of the loot a first search of `c` will generate, without generating it (same
 * derived RNG, so the result never changes); 0 for containers without a table.
 */
export function previewLootWeight(st: ItemStore, c: ItemContainer): number {
  const table = lootTableFor(st, c);
  if (!table) return 0;
  let kg = 0;
  rollTable(st, table, Rng.fromSeed(c.lootKey), 0, (def, count) => {
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
): void {
  if (depth > MAX_TABLE_DEPTH) return;
  if (!rng.chance(table.chance)) return;
  const weights = table.entries.map((e) => lootWeight(st, e.weight, e.rarity));
  const rolls = rng.int(table.rolls.min, table.rolls.max);
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
    if (!e || !('item' in e)) continue;
    const def = st.content.itemIndex.get(e.item);
    if (def === undefined) continue;
    const count = Math.min(Math.max(1, e.count.min), stackLimit(st, st.content.items[def]!));
    createItem(st, def, groundPile(st, x, y, addr.z).id, count, worldStartMinute);
  }
}
