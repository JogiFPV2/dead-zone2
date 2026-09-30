import type { SimEvent, SimZombieSpawn } from '@deadzone/protocol';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import type { ClockStart } from '../core/clock.js';
import { fixtureContent } from './content-fixtures.js';
import { buildMap, type MapSpec } from './fixtures.js';

export const NOON: ClockStart = { day: 1, hour: 12, minute: 0 };
export const MIDNIGHT: ClockStart = { day: 1, hour: 0, minute: 0 };

/** Fixture content sim with zombies (fixture:walker: sight 16, hearing 30, chase 2 tiles/s). */
export function aiSim(
  opts: {
    map?: MapSpec;
    spawn?: { x: number; y: number };
    zombies?: readonly SimZombieSpawn[];
    clock?: ClockStart;
    seed?: number;
  } & Partial<Omit<SimOptions, 'map'>> = {},
): Sim {
  const { map, spawn, zombies, clock, seed, ...rest } = opts;
  return createSim({
    seed: seed ?? 11,
    map: buildMap(map ?? {}),
    spawn: spawn ?? { x: 10.5, y: 10.5 },
    content: fixtureContent(),
    dev: true,
    clockStart: clock ?? NOON,
    ...(zombies ? { spawnZombies: zombies } : {}),
    ...rest,
  });
}

export const zombie = (sim: Sim, i = 0) => sim.getZombies()[i]!;

export function runTicks(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}

/** Steps until `pred` holds (max `limit` ticks); returns the ticks used or −1. */
export function runUntil(sim: Sim, pred: () => boolean, limit = 2000): number {
  for (let i = 0; i < limit; i++) {
    if (pred()) return i;
    sim.step();
  }
  return pred() ? limit : -1;
}

export const eventsOf = <T extends SimEvent['type']>(
  events: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }>[] =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
