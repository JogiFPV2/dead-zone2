import type { PlayerId, SimEvent, SimMap } from '@deadzone/protocol';
import { addComponent, addEntity, createWorld, query, type World } from 'bitecs';
import { CommandQueue } from '../commands/queue.js';
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
  events: SimEvent[];
  readonly sortedCache: Map<string, { version: number; eids: number[] }>;
}

export function createSimWorld(opts: {
  seed: number;
  map: SimMap;
  capacity: number;
  commandWindowTicks: number;
}): SimWorld {
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
