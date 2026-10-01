import { CHUNK_SIZE, type SimAnimalSpawn } from '@deadzone/protocol';
import type { AiWorld } from '../ai/state.js';
import { secToTicks } from '../ai/zombies.js';
import { attach, sortedQuery, spawnEntity, type SimWorld } from '../core/world.js';
import { circleOverlaps } from '../world/collision.js';
import type { TileGrid } from '../world/grid.js';
import { AnimalState } from './state.js';

/** Type index for a content id, or a weighted pick (`spawnWeight`, RNG `animals`); −1 = none. */
export function pickAnimalType(
  w: SimWorld,
  ai: AiWorld,
  typeId?: string,
  among?: number[],
): number {
  if (typeId !== undefined) return w.survival?.content.animalTypeIndex.get(typeId) ?? -1;
  const list = among ?? ai.animalTypes.map((_, i) => i);
  if (list.length === 0) return -1;
  if (list.length === 1) return list[0]!;
  const k = w.rng.animals.pickWeighted(list.map((i) => ai.animalSpawnWeights[i] ?? 0));
  return k < 0 ? -1 : list[k]!;
}

/**
 * Spawns one animal (all spawns go through here): ECS body like a zombie (Position, Velocity,
 * Facing, Collider, MoveIntent, AimIntent, MoveStats) plus `Animal`; no physics body. Facing and
 * the first graze pause from RNG `animals`. Emits `animalSpawned`.
 */
export function spawnAnimal(
  w: SimWorld,
  ai: AiWorld,
  type: number,
  x: number,
  y: number,
  z: number,
): number {
  const c = w.c;
  const eid = spawnEntity(w);
  for (const comp of [
    c.Position,
    c.Velocity,
    c.Facing,
    c.Collider,
    c.MoveIntent,
    c.AimIntent,
    c.MoveStats,
    c.Animal,
  ]) {
    attach(w, eid, comp);
  }
  const t = ai.animalTypes[type]!;
  const rng = w.rng.animals;
  c.Position.x[eid] = Math.fround(x);
  c.Position.y[eid] = Math.fround(y);
  c.Position.z[eid] = z;
  c.Velocity.x[eid] = 0;
  c.Velocity.y[eid] = 0;
  c.Collider.radius[eid] = Math.fround(t.def.radiusTiles);
  c.Facing.angle[eid] = rng.int(0, 65535);
  c.MoveIntent.dx[eid] = 0;
  c.MoveIntent.dy[eid] = 0;
  c.MoveIntent.gait[eid] = 1;
  c.AimIntent.active[eid] = 0;
  c.MoveStats.speedPerTick[eid] = t.wanderPerTick;
  const a = c.Animal;
  a.is[eid] = 1;
  a.type[eid] = type;
  a.state[eid] = AnimalState.graze;
  a.stateTick[eid] = w.tick + rng.int(0, secToTicks(t.def.grazeSec.max) - 1);
  a.tx[eid] = Math.fround(x);
  a.ty[eid] = Math.fround(y);
  a.fromX[eid] = Math.fround(x);
  a.fromY[eid] = Math.fround(y);
  a.homeX[eid] = Math.fround(x);
  a.homeY[eid] = Math.fround(y);
  a.hp[eid] = Math.fround(t.def.health);
  ai.animalCount++;
  ai.animalsSpawned++;
  w.events.push({
    type: 'animalSpawned',
    tick: w.tick,
    animal: c.StableId.value[eid] ?? 0,
    animalType: t.def.id,
    x: c.Position.x[eid] ?? 0,
    y: c.Position.y[eid] ?? 0,
    z,
  });
  return eid;
}

/** Spawns animals from a list (`createSim({ spawnAnimals })`, worker `init.animals`). */
export function spawnAnimals(w: SimWorld, spawns: readonly SimAnimalSpawn[]): number[] {
  const ai = w.ai;
  if (!ai) return [];
  const out: number[] = [];
  for (const s of spawns) {
    const type = pickAnimalType(w, ai, s.type);
    if (type < 0) continue;
    out.push(spawnAnimal(w, ai, type, s.x, s.y, s.z ?? 0));
  }
  return out;
}

/** Players closer than this are avoided by map population (animals would bolt at once). */
export const POPULATE_MIN_PLAYER_TILES = 12;
/** Random tiles tried per animal in its chunk. */
const POPULATE_TRIES = 12;

/**
 * Populates the map with up to `count` animals (`createSim({ populateAnimals })`, worker
 * `init.populateAnimals`). Habitat by chunk: a chunk with any room tile (buildings) is `town`,
 * one with floor but no rooms is `wild`; `any` takes both. Per animal: type by `spawnWeight`,
 * a chunk of its habitat (falls back to any chunk when the map has none), then random outdoor
 * floor tiles (room 0, free for its radius, ≥ POPULATE_MIN_PLAYER_TILES from players). All
 * randomness from RNG `animals`, chunks in (z, cy, cx) order, so the result depends only on the
 * seed, the map and the content.
 */
export function populateAnimals(w: SimWorld, grid: TileGrid, count: number): number[] {
  const ai = w.ai;
  if (!ai || count <= 0 || ai.animalTypes.length === 0) return [];
  const town: { cx: number; cy: number; z: number }[] = [];
  const wild: { cx: number; cy: number; z: number }[] = [];
  const list = [...(w.map.listChunks?.() ?? [])].sort(
    (a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx,
  );
  for (const addr of list) {
    const ch = w.map.getChunk(addr.cx, addr.cy, addr.z);
    if (!ch) continue;
    let outdoor = false;
    let rooms = false;
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      if (!(ch.floor[i] ?? 0)) continue;
      if (ch.room?.[i]) rooms = true;
      else outdoor = true;
    }
    if (!outdoor) continue;
    (rooms ? town : wild).push(addr);
  }
  const all = [...town, ...wild].sort((a, b) => a.z - b.z || a.cy - b.cy || a.cx - b.cx);
  if (all.length === 0) return [];
  const players = sortedQuery(w, 'players', [w.c.Player]).map((e) => ({
    x: w.c.Position.x[e] ?? 0,
    y: w.c.Position.y[e] ?? 0,
    z: Math.floor(w.c.Position.z[e] ?? 0),
  }));
  const rng = w.rng.animals;
  const out: number[] = [];
  for (let n = 0; n < count; n++) {
    const type = pickAnimalType(w, ai);
    if (type < 0) break;
    const def = ai.animalTypes[type]!.def;
    const pool = def.habitat === 'town' ? town : def.habitat === 'wild' ? wild : all;
    const chunks = pool.length > 0 ? pool : all;
    const addr = chunks[rng.int(0, chunks.length - 1)]!;
    const ch = w.map.getChunk(addr.cx, addr.cy, addr.z)!;
    for (let t = 0; t < POPULATE_TRIES; t++) {
      const i = rng.int(0, CHUNK_SIZE * CHUNK_SIZE - 1);
      if (!(ch.floor[i] ?? 0) || ch.room?.[i]) continue;
      const x = addr.cx * CHUNK_SIZE + (i % CHUNK_SIZE) + 0.5;
      const y = addr.cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE) + 0.5;
      if (circleOverlaps(grid, addr.z, x, y, def.radiusTiles)) continue;
      const near = POPULATE_MIN_PLAYER_TILES * POPULATE_MIN_PLAYER_TILES;
      const close = players.some((p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        return p.z === addr.z && dx * dx + dy * dy < near;
      });
      if (close) continue;
      out.push(spawnAnimal(w, ai, type, x, y, addr.z));
      break;
    }
  }
  return out;
}
