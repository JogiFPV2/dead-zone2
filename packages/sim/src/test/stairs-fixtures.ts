import type { SimMap, SimZombieSpawn } from '@deadzone/protocol';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { NOON } from './ai-fixtures.js';
import { fixtureContent } from './content-fixtures.js';
import { buildLevels } from './level-fixtures.js';

// Shared by physics/stairs.test.ts and physics/stairs.perf.test.ts (moved unchanged).

/**
 * Map A, level 0: floor everywhere; flight (20..23, 20) climbing E inside a walled corridor
 * (walls on its north and south side), entrance on x = 20. Level 1: floor except the stairwell.
 * Flight B (30, 28..30) climbing N, open on both sides (entrance on y = 31).
 */
export const inA = (x: number, y: number) => y === 20 && x >= 20 && x < 24;
export const inB = (x: number, y: number) => x === 30 && y >= 28 && y <= 30;
export const mapA = () =>
  buildLevels(
    [
      { z: 0, wallN: (x, y) => (y === 20 || y === 21) && x >= 20 && x < 24 },
      { z: 1, floor: (x, y) => !inA(x, y) && !inB(x, y) },
    ],
    [
      { x: 20, y: 20, z: 0, dir: 'E', len: 4 },
      { x: 30, y: 30, z: 0, dir: 'N', len: 3 },
    ],
  );

/** Levels 0..4, a shaft at (40, 40) without floor on levels 1..4 (floor at the bottom). */
export const shaftMap = () =>
  buildLevels(
    [0, 1, 2, 3, 4].map((z) => ({
      z,
      floor: (x: number, y: number) => z === 0 || !(x === 40 && y === 40),
    })),
  );

/** Zombies attack but never hit (the player survives the crowd tests). */
export const harmless = {
  ...DEFAULT_COMBAT_CONFIG,
  zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
};

export function levelSim(
  map: SimMap,
  spawn: { x: number; y: number; z?: number },
  zombies: SimZombieSpawn[] = [],
  extra: Partial<SimOptions> = {},
): Sim {
  return createSim({
    seed: 7,
    map,
    spawn,
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    combatConfig: harmless,
    ...(zombies.length ? { spawnZombies: zombies } : {}),
    ...extra,
  });
}
