import { CHUNK_SIZE } from '@deadzone/protocol';
import { HashWriter } from '../core/hash.js';
import { rngFor } from '../core/rng.js';
import type { SimWorld } from '../core/world.js';
import { destroyItem, type ItemContainer } from '../items/store.js';
import { vehicleContainer } from './containers.js';
import { createKey } from './keys.js';
import { vehicleSettings } from './settings.js';
import { spawnVehicle } from './spawn.js';
import type { Vehicle } from './types.js';

/**
 * Parked cars from chunk data (`SimChunk.vehicles`, docs/sim-architecture.md 9.36). Spawned once
 * per chunk: with LOD when the chunk's loot is generated (`spawnChunkLoot`), else at init. Rolls
 * per car from `rngFor(seed, 'chunk-vehicle', cx, cy, z, index)`: lock, key place, fuel.
 */
export function spawnChunkVehicles(
  w: SimWorld,
  cx: number,
  cy: number,
  z: number,
  home: number,
): void {
  const list = w.map.getChunk(cx, cy, z)?.vehicles;
  const index = w.survival?.content.vehicleTypeIndex;
  if (!list || list.length === 0 || !index) return;
  const cfg = vehicleSettings(w).spawn;
  const weights = cfg.key;
  const total =
    weights.ignition + weights.glovebox + weights.building + weights.zombie + weights.none;
  list.forEach((e, i) => {
    const type = index.get(e.type ?? cfg.defaultType);
    if (type === undefined) return;
    const rng = rngFor(w.seed, 'chunk-vehicle', cx, cy, z, i);
    const locked = rng.nextFloat() < cfg.lockedChance;
    let r = rng.nextFloat() * total;
    const place =
      (['ignition', 'glovebox', 'building', 'zombie', 'none'] as const).find((k) => {
        r -= weights[k];
        return r < 0;
      }) ?? 'none';
    const frac = cfg.fuel.min + (cfg.fuel.max - cfg.fuel.min) * rng.nextFloat();
    const pick = rng.nextFloat();
    const t = w.survival!.content.vehicleTypes[type]!;
    const id = spawnVehicle(
      w,
      type,
      cx * CHUNK_SIZE + e.x,
      cy * CHUNK_SIZE + e.y,
      z,
      e.heading ?? 0,
      frac * t.fuelMax,
      { locked, key: place === 'ignition' || place === 'glovebox' ? place : 'none' },
    );
    const v = w.physics.vehicles.get(id)!;
    if (place === 'building') {
      const box = buildingContainers(w, cx, cy, z);
      const into = box[Math.floor(pick * box.length)] ?? vehicleContainer(w, v, 'vehicle-glovebox');
      if (into) createKey(w, v, into.id);
    } else if (place === 'zombie') v.keyZombie = true;
    if (home >= 0) {
      v.home = home;
      v.sig = vehicleSig(w, v);
    }
  });
}

/** World storage inside buildings (a room) of chunk (cx, cy, z), by id. */
function buildingContainers(w: SimWorld, cx: number, cy: number, z: number): ItemContainer[] {
  const out: ItemContainer[] = [];
  for (const c of w.items?.containers.values() ?? []) {
    if (c.kind !== 'world' || c.z !== z || !c.roomType) continue;
    if (Math.floor(c.x / CHUNK_SIZE) === cx && Math.floor(c.y / CHUNK_SIZE) === cy) out.push(c);
  }
  return out.sort((a, b) => a.id - b.id);
}

/** Signature of everything a player can change on a car (pristine check on chunk release). */
export function vehicleSig(w: SimWorld, v: Vehicle): number {
  const h = new HashWriter();
  h.f32(v.x).f32(v.y).u32(v.heading).f32(v.fuel).f32(v.engine).u32(v.doorsOpen);
  for (const a of [v.zones, v.tires, v.windows]) for (const x of a) h.f32(x);
  for (const x of v.occupants) h.u32(x);
  h.u32((v.locked ? 1 : 0) | (v.keyIn ? 2 : 0) | (v.hotwired ? 4 : 0) | (v.keyZombie ? 8 : 0));
  const st = w.items;
  for (const id of v.containers) {
    const c = st?.containers.get(id);
    if (!c) continue;
    h.u32(c.id)
      .u32(c.lootDone ? 1 : 0)
      .u32(c.searchedBy.length)
      .u32(c.items.length);
    for (const iid of c.items) {
      const it = st!.items.get(iid);
      if (it)
        h.u32(it.id)
          .u32(it.def)
          .u32(it.count)
          .u32(it.vehicle ?? 0)
          .f32(it.fuelL ?? 0);
    }
  }
  return h.digest();
}

/** Pristine chunk car (same signature as at spawn): may be removed with its chunk. */
export const pristineVehicle = (w: SimWorld, v: Vehicle): boolean =>
  v.sig !== undefined && vehicleSig(w, v) === v.sig;

/** Removes a car with its containers and their items (chunk release). */
export function removeVehicle(w: SimWorld, v: Vehicle): void {
  const st = w.items;
  for (const id of v.containers) {
    const c = st?.containers.get(id);
    if (!st || !c) continue;
    for (const iid of [...c.items]) {
      const it = st.items.get(iid);
      if (it) destroyItem(st, it);
    }
    st.containers.delete(id);
    st.version++;
  }
  w.physics.vehicles.delete(v.id);
}

/**
 * A zombie died at (x, y, z) into corpse `c`: the nearest car (then lowest id) within
 * `spawn.keyZombieTiles` whose key waits for a zombie puts it into the corpse.
 */
export function giveZombieKey(w: SimWorld, c: ItemContainer): void {
  let best: Vehicle | undefined;
  let bestD = Infinity;
  const r = vehicleSettings(w).spawn.keyZombieTiles;
  for (const v of w.physics.vehicles.values()) {
    if (!v.keyZombie || Math.floor(v.z) !== c.z) continue;
    const d = (v.x - c.x - 0.5) ** 2 + (v.y - c.y - 0.5) ** 2;
    if (d > r * r) continue;
    if (d < bestD || (d === bestD && best && v.id < best.id)) {
      best = v;
      bestD = d;
    }
  }
  if (!best) return;
  best.keyZombie = false;
  createKey(w, best, c.id);
}
