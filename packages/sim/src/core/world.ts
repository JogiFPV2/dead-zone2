import type { PlayerId, SimEvent, SimMap } from '@deadzone/protocol';
import { addComponent, addEntity, createWorld, query, type World } from 'bitecs';
import { CommandQueue } from '../commands/queue.js';
import type { AiWorld } from '../ai/state.js';
import type { ItemStore } from '../items/store.js';
import type { SurvivalWorld } from '../survival/state.js';
import { createClock, type Clock, type ClockStart } from './clock.js';
import { createComponents, type Components } from './components.js';
import { createRngStreams, type RngStreams } from './rng.js';

export interface SimWorld {
  readonly ecs: World;
  readonly c: Components;
  readonly capacity: number;
  readonly seed: number;
  readonly map: SimMap;
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
  /** Debug commands allowed (dev builds, tests). Not part of the state. */
  readonly dev: boolean;
  events: SimEvent[];
  readonly sortedCache: Map<string, { version: number; eids: number[] }>;
}

export function createSimWorld(opts: {
  seed: number;
  map: SimMap;
  capacity: number;
  commandWindowTicks: number;
  dayLengthMinutes?: number | undefined;
  clockStart?: ClockStart | undefined;
  survival?: ((clock: Clock) => SurvivalWorld) | undefined;
  items?: ((survival: SurvivalWorld) => ItemStore) | undefined;
  ai?: ((survival: SurvivalWorld) => AiWorld) | undefined;
  dev?: boolean | undefined;
}): SimWorld {
  const clock = createClock(opts.dayLengthMinutes, opts.clockStart);
  const survival = opts.survival?.(clock);
  return {
    ecs: createWorld(),
    c: createComponents(opts.capacity),
    capacity: opts.capacity,
    seed: opts.seed | 0,
    map: opts.map,
    tick: 0,
    rng: createRngStreams(opts.seed),
    nextStableId: 1,
    structureVersion: 0,
    players: new Map(),
    queue: new CommandQueue(opts.commandWindowTicks),
    clock,
    survival,
    items: survival && opts.items ? opts.items(survival) : undefined,
    ai: survival && opts.ai ? opts.ai(survival) : undefined,
    dev: opts.dev ?? false,
    events: [],
    sortedCache: new Map(),
  };
}

/** Creates an entity with a fresh StableId. All spawns go through here. */
export function spawnEntity(w: SimWorld): number {
  const eid = addEntity(w.ecs);
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
