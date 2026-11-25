import { CHUNK_SIZE } from '@deadzone/protocol';
import { HashWriter } from '../core/hash.js';
import { hashString32 } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { createChunkContainers, scatterFloorLootChunk } from '../items/loot.js';
import { scatterLootChunk } from '../items/search.js';
import { destroyItem, tileKey, type ItemContainer, type ItemStore } from '../items/store.js';
import { ChunkLoot, chunkIndex, type LodWorld } from './state.js';
import { pristineVehicle, removeVehicle, spawnChunkVehicles } from '../vehicles/chunk-spawn.js';
import type { Vehicle } from '../vehicles/types.js';

/** Container kinds placed on map tiles (the rest live inside items or inventories). */
const PLACED = new Set(['world', 'ground', 'hidden', 'corpse']);

/**
 * Generates world storage (contents still lazy, on the first search) and floor / scattered loot
 * of chunk column (cx, cy) on all levels, in the same per-chunk order as the whole-map init.
 * Food is stamped with the world start minute, so spoilage "catches up" by itself
 * (`items/spoilage.ts` computes the age when read).
 */
export function spawnChunkLoot(w: SimWorld, lod: LodWorld, cx: number, cy: number): void {
  const st = w.items;
  if (!st) return;
  const first = st.nextContainerId;
  const i = chunkIndex(lod, cx, cy);
  for (let z = lod.bounds.z0; z <= lod.bounds.z1; z++) {
    const addr = { cx, cy, z };
    createChunkContainers(st, w.map, w.seed, addr);
    if (lod.floorLoot) {
      scatterFloorLootChunk(st, w.map, w.seed, w.clock.startMinute, addr);
      scatterLootChunk(st, w.map, w.seed, w.clock.startMinute, addr);
    }
    // Parked cars after the storage (a key may go into a building's storage of this chunk).
    spawnChunkVehicles(w, cx, cy, z, i);
  }
  const created: ItemContainer[] = [];
  for (let id = first; id < st.nextContainerId; id++) {
    const c = st.containers.get(id);
    if (c && PLACED.has(c.kind)) created.push(c);
  }
  lod.chunkLoot[i] = ChunkLoot.live;
  lod.chunkSig.set(i, signature(st, created));
}

function inChunk(c: ItemContainer, cx: number, cy: number): boolean {
  return Math.floor(c.x / CHUNK_SIZE) === cx && Math.floor(c.y / CHUNK_SIZE) === cy;
}

/** Placed containers per chunk column of `chunks` (one pass over the store), by id. */
function placedIn(
  st: ItemStore,
  lod: LodWorld,
  chunks: ReadonlySet<number>,
): Map<number, ItemContainer[]> {
  const out = new Map<number, ItemContainer[]>();
  for (const c of st.containers.values()) {
    if (!PLACED.has(c.kind)) continue;
    const cx = Math.floor(c.x / CHUNK_SIZE);
    const cy = Math.floor(c.y / CHUNK_SIZE);
    if (cx < lod.bounds.cx0 || cy < lod.bounds.cy0 || cx > lod.bounds.cx1 || cy > lod.bounds.cy1)
      continue;
    const i = chunkIndex(lod, cx, cy);
    if (!chunks.has(i) || !inChunk(c, cx, cy)) continue;
    let list = out.get(i);
    if (!list) out.set(i, (list = []));
    list.push(c);
  }
  for (const list of out.values()) list.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * Leaving live chunks: unchanged ones (same signature as when generated) are removed from the
 * store and generated again next time (deterministic, new ids); changed ones become `dirty` and
 * stay (they are the save delta).
 */
export function releaseChunks(w: SimWorld, lod: LodWorld, chunks: readonly number[]): void {
  const st = w.items;
  if (!st || chunks.length === 0) return;
  const set = new Set(chunks);
  const placed = placedIn(st, lod, set);
  const cars = new Map<number, Vehicle[]>();
  for (const v of w.physics.vehicles.values()) {
    if (v.home === undefined || !set.has(v.home)) continue;
    const list = cars.get(v.home);
    if (list) list.push(v);
    else cars.set(v.home, [v]);
  }
  for (const i of chunks) {
    const list = placed.get(i) ?? [];
    const own = (cars.get(i) ?? []).sort((a, b) => a.id - b.id);
    // A changed car keeps the whole chunk (and the other way round): keys may sit in storage.
    if (signature(st, list) !== lod.chunkSig.get(i) || !own.every((v) => pristineVehicle(w, v))) {
      lod.chunkLoot[i] = ChunkLoot.dirty;
      lod.chunkSig.delete(i);
      continue;
    }
    for (const c of list) removeContainer(st, c);
    for (const v of own) removeVehicle(w, v);
    lod.chunkLoot[i] = ChunkLoot.none;
    lod.chunkSig.delete(i);
  }
}

function removeContainer(st: ItemStore, c: ItemContainer): void {
  for (const id of [...c.items]) {
    const item = st.items.get(id);
    if (item) destroyItem(st, item);
  }
  st.containers.delete(c.id);
  const key = tileKey(c.x, c.y, c.z);
  if (c.kind === 'world') {
    const list = st.worldByTile.get(key)?.filter((id) => id !== c.id) ?? [];
    if (list.length > 0) st.worldByTile.set(key, list);
    else st.worldByTile.delete(key);
  } else if (c.kind === 'ground' && st.ground.get(key) === c.id) st.ground.delete(key);
  else if (c.kind === 'hidden' && st.hidden.get(key) === c.id) st.hidden.delete(key);
  st.version++;
}

/** xxHash32 of placed containers and everything inside them (ids included). */
export function signature(st: ItemStore, list: readonly ItemContainer[]): number {
  const h = new HashWriter();
  h.u32(list.length);
  const writeContainer = (c: ItemContainer): void => {
    h.u32(c.id)
      .u32(c.type + 1)
      .u32(c.x)
      .u32(c.y)
      .u32(c.z + 128);
    h.u32(c.lootDone ? 1 : 0)
      .u32(c.searchedBy.length)
      .u32(c.items.length);
    for (const id of c.items) {
      const it = st.items.get(id);
      if (!it) {
        h.u32(0xdead);
        continue;
      }
      h.u32(it.id).u32(it.def).u32(it.count).u32(it.condition).u32(it.uses);
      h.f32(it.ageMin)
        .u32(it.ageStamp)
        .u32(it.placed ? 1 : 0);
      if (it.vehicle !== undefined) h.u32(0x6e70_0001).u32(it.vehicle);
      if (it.fuelL !== undefined) h.u32(0x6e70_0002).f32(it.fuelL);
      if (it.wear !== undefined) h.u32(0x6e70_0004).u32(it.wear);
      if (it.tint !== undefined) h.u32(0x6e70_0006).u32(hashString32(it.tint.join(',')));
      const inner = it.inner ? st.containers.get(it.inner) : undefined;
      if (inner) writeContainer(inner);
      else h.u32(0);
    }
  };
  for (const c of list) {
    h.u32(PLACED_CODE[c.kind] ?? 0);
    writeContainer(c);
  }
  return h.digest();
}

const PLACED_CODE: Record<string, number> = { world: 1, ground: 2, hidden: 3, corpse: 4 };
