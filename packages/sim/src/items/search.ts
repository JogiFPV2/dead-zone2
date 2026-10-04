import {
  CHUNK_SIZE,
  tileIndex,
  type CommandRejectReason,
  type ContainerKind,
  type SimChunkAddress,
  type SimMap,
  type SimZone,
} from '@deadzone/protocol';
import type { LootTableDef } from '../content/adapter.js';
import { ticksPerGameMinute } from '../core/clock.js';
import { TICKS_PER_SECOND } from '../core/constants.js';
import { deriveSeed, Rng } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { floorZ } from '../world/levels.js';
import { newAction, startAction } from '../actions/queue.js';
import { moveItem, stableIdOf, tileInReach } from './inventory.js';
import { lootWeight } from './loot.js';
import { isVehicleContainer } from '../vehicles/containers.js';
import {
  addContainer,
  createItem,
  defOf,
  groundPile,
  stackLimit,
  tileKey,
  type ItemContainer,
  type ItemStore,
} from './store.js';

/**
 * Searching (docs 9.18): world storage and zombie corpses hide their contents until a timed
 * `search` by this player; a spot search (`search {x, y}`) reveals hidden items around a tile.
 */

/** Containers whose contents are only visible after this player's search. */
export const searchable = (c: ItemContainer): boolean =>
  c.kind === 'world' || c.kind === 'corpse' || isVehicleContainer(c.kind);

/** `c` must be searched by `eid` before it can be opened or taken from. */
export function needsSearch(w: SimWorld, eid: number, c: ItemContainer): boolean {
  return searchable(c) && !c.searchedBy.includes(stableIdOf(w, eid));
}

/** Protocol kind of a container that may be shown (hidden caches are never shown). */
export const viewKind = (c: ItemContainer): ContainerKind =>
  c.kind === 'hidden' ? 'ground' : c.kind;

/** Game minutes of `worldSettings.loot.search.searchSec` (real seconds at ×1). */
export function searchSecMin(w: SimWorld): number {
  const sec = w.items!.content.search.searchSec;
  return (sec * TICKS_PER_SECOND) / ticksPerGameMinute(w.clock);
}

/** `search {container}` or `search {x, y}` → the timed `search` action. */
export function applySearchCommand(
  w: SimWorld,
  eid: number,
  cmd: { container?: number | undefined; x?: number | undefined; y?: number | undefined },
): CommandRejectReason | undefined {
  const st = w.items!;
  const hasTile = cmd.x !== undefined || cmd.y !== undefined;
  if ((cmd.container !== undefined) === hasTile) return 'invalid-target';
  if (cmd.container !== undefined) {
    const c = st.containers.get(cmd.container);
    if (!c || c.kind === 'hidden') return 'no-item';
    if (!searchable(c)) return 'invalid-target';
    return startAction(w, eid, newAction('search', { container: c.id }));
  }
  if (cmd.x === undefined || cmd.y === undefined) return 'invalid-target';
  const z = floorZ(w, eid);
  if (!tileInReach(w, eid, cmd.x, cmd.y, z)) return 'out-of-range';
  const a = newAction('search');
  a.spot = { x: cmd.x, y: cmd.y, z };
  return startAction(w, eid, a);
}

/**
 * Zombie corpse as a container (kind `corpse`, owner = the zombie's StableId) on the tile it died
 * on; loot from the zombie type's `lootTable`, generated lazily on the first search with an RNG
 * derived from the seed and the StableId (so the same kill always drops the same items).
 */
export function createCorpse(
  w: SimWorld,
  zombieSid: number,
  x: number,
  y: number,
  z: number,
  lootTable: string | undefined,
): ItemContainer | undefined {
  const st = w.items;
  if (!st || st.corpses.has(zombieSid)) return undefined;
  const table = lootTable && st.content.lootTableById.has(lootTable) ? lootTable : undefined;
  const c = addContainer(st, {
    kind: 'corpse',
    owner: zombieSid,
    type: -1,
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
    capacityKg: Infinity,
    acceptsTags: undefined,
    roomType: undefined,
    lootKey: deriveSeed(w.seed, 'corpse', zombieSid),
    lootDone: table === undefined,
    lootTable: table,
  });
  st.corpses.set(zombieSid, c.id);
  return c;
}

function hiddenCache(st: ItemStore, x: number, y: number, z: number): ItemContainer {
  const key = tileKey(x, y, z);
  const id = st.hidden.get(key);
  const hit = id === undefined ? undefined : st.containers.get(id);
  if (hit) return hit;
  const c = addContainer(st, {
    kind: 'hidden',
    owner: 0,
    type: -1,
    x,
    y,
    z,
    capacityKg: Infinity,
    acceptsTags: undefined,
    roomType: undefined,
    lootKey: 0,
  });
  st.hidden.set(key, c.id);
  return c;
}

export interface FoundItem {
  itemId: number;
  defId: string;
  count: number;
  container: number;
}

/**
 * Spot search done: every hidden cache within `search.spotRadiusTiles` of the tile (centre to
 * centre, same floor) becomes a normal ground pile on its tile, in tile order (y, x).
 */
export function revealHidden(w: SimWorld, spot: { x: number; y: number; z: number }): FoundItem[] {
  const st = w.items!;
  const r = st.content.search.spotRadiusTiles;
  const k = Math.ceil(r);
  const found: FoundItem[] = [];
  for (let y = spot.y - k; y <= spot.y + k; y++) {
    for (let x = spot.x - k; x <= spot.x + k; x++) {
      if ((x - spot.x) ** 2 + (y - spot.y) ** 2 > r * r + 1e-9) continue;
      const key = tileKey(x, y, spot.z);
      const id = st.hidden.get(key);
      const cache = id === undefined ? undefined : st.containers.get(id);
      if (!cache) continue;
      const pile = groundPile(st, x, y, spot.z);
      for (const itemId of [...cache.items]) {
        const item = st.items.get(itemId);
        if (!item) continue;
        const def = defOf(st, item).id;
        const n = item.count;
        const moved = moveItem(w, item, pile, n);
        found.push({ itemId: moved.id, defId: def, count: n, container: pile.id });
      }
      st.containers.delete(cache.id);
      st.hidden.delete(key);
      st.version++;
    }
  }
  return found;
}

const MAX_PICK_DEPTH = 8;

/** One item of a table (nested tables followed), or undefined (empty weights). */
function pickOne(
  st: ItemStore,
  table: LootTableDef,
  rng: Rng,
  depth = 0,
): { def: number; count: number } | undefined {
  if (depth > MAX_PICK_DEPTH) return undefined;
  const weights = table.entries.map((e) => lootWeight(st, e.weight, e.rarity));
  if (!weights.some((v) => v > 0)) return undefined;
  const e = table.entries[rng.pickWeighted(weights)];
  if (!e) return undefined;
  if (!('item' in e)) {
    const nested = st.content.lootTableById.get(e.table);
    return nested ? pickOne(st, nested, rng, depth + 1) : undefined;
  }
  const def = st.content.itemIndex.get(e.item);
  if (def === undefined) return undefined;
  const count = rng.int(e.count.min, e.count.max);
  return { def, count: Math.min(Math.max(1, count), stackLimit(st, st.content.items[def]!)) };
}

function zoneMatches(zn: SimZone, names: readonly string[]): boolean {
  return (
    names.includes(zn.role) ||
    names.includes(zn.id) ||
    (zn.tags ?? []).some((t) => names.includes(t))
  );
}

const inZone = (zn: SimZone, x: number, y: number): boolean =>
  zn.rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);

/**
 * Scattered loot at world init (`lootTable.scatter`): per chunk (order z, cy, cx) and table (by
 * id) an RNG derived from the seed, the chunk and the table; `perChunk` rolls, each a random
 * matching floor tile and one item from the table. With `hiddenChance` it goes to a hidden cache
 * on that tile instead of a visible ground pile.
 */
export function scatterLoot(
  st: ItemStore,
  map: SimMap,
  seed: number,
  worldStartMinute: number,
): void {
  if (st.content.scatterTables.length === 0) return;
  const list = [...(map.listChunks?.() ?? [])].sort(
    (a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx,
  );
  for (const addr of list) scatterLootChunk(st, map, seed, worldStartMinute, addr);
}

/** Scattered loot of one chunk (`scatterLoot` body; the sim LOD calls it lazily). */
export function scatterLootChunk(
  st: ItemStore,
  map: SimMap,
  seed: number,
  worldStartMinute: number,
  addr: SimChunkAddress,
): void {
  const tables = st.content.scatterTables;
  if (tables.length === 0) return;
  const palette = map.floorTiles;
  const tags = st.content.tileTags;
  const terrainOf = (v: number): string[] => {
    const id = palette?.[v];
    return id ? [id, ...(tags.get(id) ?? [])] : [];
  };
  const chunk = map.getChunk(addr.cx, addr.cy, addr.z);
  if (!chunk) return;
  for (const table of tables) {
    const sc = table.scatter!;
    const rng = Rng.fromSeed(deriveSeed(seed, 'scatter', addr.cx, addr.cy, addr.z, table.id));
    const rolls = rng.int(sc.perChunk.min, sc.perChunk.max);
    if (rolls <= 0) continue;
    const zones =
      sc.zones.length > 0
        ? (map.zones ?? []).filter((zn) => zn.z === addr.z && zoneMatches(zn, sc.zones))
        : undefined;
    if (zones && zones.length === 0) continue;
    const tiles: number[] = [];
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = tileIndex(lx, ly);
        const v = chunk.floor[i] ?? 0;
        if (!v) continue;
        if (sc.outdoor && (chunk.room?.[i] ?? 0) !== 0) continue;
        if (sc.terrain.length > 0 && !terrainOf(v).some((t) => sc.terrain.includes(t))) continue;
        const gx = addr.cx * CHUNK_SIZE + lx;
        const gy = addr.cy * CHUNK_SIZE + ly;
        if (zones && !zones.some((zn) => inZone(zn, gx, gy))) continue;
        tiles.push(i);
      }
    }
    if (tiles.length === 0) continue;
    for (let k = 0; k < rolls; k++) {
      const i = tiles[rng.int(0, tiles.length - 1)]!;
      const pick = pickOne(st, table, rng);
      const hidden = sc.hiddenChance > 0 && rng.chance(sc.hiddenChance);
      if (!pick) continue;
      const x = addr.cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const y = addr.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      const c = hidden ? hiddenCache(st, x, y, addr.z) : groundPile(st, x, y, addr.z);
      createItem(st, pick.def, c.id, pick.count, worldStartMinute);
    }
  }
}
