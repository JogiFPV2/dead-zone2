import type { PlayerId, SimEvent, SimMap, WorldSource } from '@deadzone/protocol';
import { createFurnitureIndex, type FurnitureIndex } from '../world/furniture.js';
import { createChunkWatch, type ChunkWatch } from '../world/chunk-events.js';
import type { LodWorld } from '../lod/state.js';
import type { SafeStart } from '../lod/safe-start.js';
import type { PlayerMapWorld } from '../map/player-map.js';
import { addComponent, addEntity, createWorld, query, removeComponent, type World } from 'bitecs';
import { CommandQueue } from '../commands/queue.js';
import type { AiWorld } from '../ai/state.js';
import type { ItemStore } from '../items/store.js';
import type { SurvivalWorld } from '../survival/state.js';
import {
  createOpeningsWorld,
  DEFAULT_OPENINGS_CONFIG,
  type OpeningsWorld,
} from '../openings/state.js';
import { createClock, type Clock, type ClockStart } from './clock.js';
import { createComponents, type Components } from './components.js';
import { createRngStreams, type RngStreams } from './rng.js';
import { createPhysicsWorld } from '../physics/step.js';
import type { PhysicsWorld } from '../physics/types.js';
import type { PhysicsConfig } from '../physics/constants.js';

/** A `setInterest` area: chunk (cx, cy) with a Chebyshev radius r ≥ 1 in chunks. */
export interface ChunkInterest {
  cx: number;
  cy: number;
  r: number;
}

export interface SimWorld {
  readonly ecs: World;
  readonly c: Components;
  readonly capacity: number;
  readonly seed: number;
  readonly map: SimMap;
  /** Where the map comes from (generator seed and version, saved in the save header). */
  readonly source: WorldSource;
  /** Big-map LOD (docs 9.24); undefined on maps that fit the active area (demo maps). */
  lod: LodWorld | undefined;
  /**
   * Safe start of a new game (lod/safe-start.ts; `createSim({ safeStart })`): no zombie near or in
   * sight of a player until `untilTick`. Config, not state (not saved: a load runs without it).
   */
  safeStart: SafeStart | undefined;
  /** Characters' world maps: fog of war, trail, markers (map/player-map.ts; not hashed). */
  playerMap: PlayerMapWorld | undefined;
  /**
   * Polish item names by content id (`SimOptions.namesPl`, the pack's `i18n/pl.json` `items`):
   * menu labels such as the dish of `cook:<recipeId>`. Display only (not saved, not hashed).
   */
  namesPl?: Readonly<Record<string, string>> | undefined;
  /**
   * Eids of entities removed by the LOD (no components left), reused by the next spawn (LIFO).
   * State: saved, so eids stay identical after a load. Empty without LOD.
   */
  readonly freeEids: number[];
  /**
   * `setInterest` per player id (docs 9.24): extra chunk square (cx, cy, radius r) simulated in
   * detail by the LOD, on top of the area around each player. State (saved, hashed when set).
   */
  readonly interest: Map<number, ChunkInterest>;
  /** `chunkChanged` bookkeeping (derived, not state; world/chunk-events.ts). */
  readonly chunkWatch: ChunkWatch;
  /** Index of the next tick to run (= number of ticks already run). */
  tick: number;
  readonly rng: RngStreams;
  nextStableId: number;
  /** Bumped on every structural change (spawn, despawn, component add/remove). */
  structureVersion: number;
  readonly players: Map<PlayerId, number>;
  readonly queue: CommandQueue;
  readonly clock: Clock;
  /** Survival (Stage 2); undefined when the sim was created without content. */
  readonly survival: SurvivalWorld | undefined;
  /** Items, inventories, storage and timed actions (Stage 3); undefined without content. */
  readonly items: ItemStore | undefined;
  /** Noise, zombies, vision, navigation (Stage 4); undefined without content. */
  readonly ai: AiWorld | undefined;
  /** Door / window state (always present; config from `worldSettings.openings`). */
  readonly openings: OpeningsWorld;
  /**
   * Furniture footprint (`worldSettings.furnitureFootprint`; undefined = off): tiles occupied by
   * furniture. Derived from map + content, not state.
   */
  readonly furniture: FurnitureIndex | undefined;
  /** Physics bodies of players and zombies (`physics/*`, stream `rng.physics`). */
  readonly physics: PhysicsWorld;
  /** Debug commands allowed (dev builds, tests). Not part of the state. */
  readonly dev: boolean;
  events: SimEvent[];
  readonly sortedCache: Map<string, { version: number; eids: number[] }>;
}

export function createSimWorld(opts: {
  seed: number;
  map: SimMap;
  source: WorldSource;
  capacity: number;
  commandWindowTicks: number;
  dayLengthMinutes?: number | undefined;
  clockStart?: ClockStart | undefined;
  survival?: ((clock: Clock) => SurvivalWorld) | undefined;
  items?: ((survival: SurvivalWorld) => ItemStore) | undefined;
  ai?: ((survival: SurvivalWorld) => AiWorld) | undefined;
  dev?: boolean | undefined;
  physicsConfig?: PhysicsConfig | undefined;
}): SimWorld {
  const clock = createClock(opts.dayLengthMinutes, opts.clockStart);
  const survival = opts.survival?.(clock);
  const rng = createRngStreams(opts.seed);
  return {
    ecs: createWorld(),
    c: createComponents(opts.capacity),
    capacity: opts.capacity,
    seed: opts.seed | 0,
    map: opts.map,
    source: opts.source,
    lod: undefined,
    safeStart: undefined,
    playerMap: undefined,
    freeEids: [],
    interest: new Map(),
    chunkWatch: createChunkWatch(),
    tick: 0,
    rng,
    nextStableId: 1,
    structureVersion: 0,
    players: new Map(),
    queue: new CommandQueue(opts.commandWindowTicks),
    clock,
    survival,
    items: survival && opts.items ? opts.items(survival) : undefined,
    ai: survival && opts.ai ? opts.ai(survival) : undefined,
    openings: createOpeningsWorld(
      opts.map,
      survival?.content.openings ?? DEFAULT_OPENINGS_CONFIG,
      opts.seed,
    ),
    furniture: createFurnitureIndex(opts.map, survival?.content),
    physics: createPhysicsWorld(rng.physics, opts.physicsConfig),
    dev: opts.dev ?? false,
    events: [],
    sortedCache: new Map(),
  };
}

/** Creates an entity with a fresh StableId. All spawns go through here. */
export function spawnEntity(w: SimWorld): number {
  const eid = w.freeEids.length > 0 ? w.freeEids.pop()! : addEntity(w.ecs);
  if (eid >= w.capacity) throw new Error(`SimWorld capacity ${w.capacity} exceeded`);
  addComponent(w.ecs, eid, w.c.StableId);
  w.c.StableId.value[eid] = w.nextStableId++;
  w.structureVersion++;
  return eid;
}

export function attach(w: SimWorld, eid: number, component: object): void {
  addComponent(w.ecs, eid, component);
  w.structureVersion++;
}

export function detach(w: SimWorld, eid: number, component: object): void {
  removeComponent(w.ecs, eid, component);
  w.structureVersion++;
}

/**
 * Query result sorted by StableId (stable iteration order independent of bitecs id reuse).
 * Cached per key and invalidated by `structureVersion`.
 */
export function sortedQuery(w: SimWorld, key: string, terms: object[]): readonly number[] {
  const hit = w.sortedCache.get(key);
  if (hit && hit.version === w.structureVersion) return hit.eids;
  const sid = w.c.StableId.value;
  const eids = Array.from(query(w.ecs, [w.c.StableId, ...terms])).sort(
    (a, b) => (sid[a] ?? 0) - (sid[b] ?? 0),
  );
  w.sortedCache.set(key, { version: w.structureVersion, eids });
  return eids;
}
