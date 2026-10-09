import type { SimZombieSpawn } from '@deadzone/protocol';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from '../ai/config.js';
import { ZombieState } from '../ai/state.js';
import { createSim, type Sim } from '../sim.js';
import { NOON, zombie } from './ai-fixtures.js';
import { fixtureContent } from './content-fixtures.js';
import { buildLevels, type LevelSpec, type StairSpec } from './level-fixtures.js';

// Shared by ai/stairs-ai.test.ts and ai/stairs-ai.perf.test.ts (moved unchanged).

/**
 * Zombies walking to goals on other floors over stairs (ai/floors.ts, physics walks the flight).
 * Map: levels 0..2 on 64×64, floor everywhere except the stairwells above the flights.
 * Flight A (20..23, 30) climbs E from level 0 (entrance x = 19, landing (24, 30) on level 1).
 * Flight B (40, 20..17) climbs N from level 1 (entrance y = 21, landing (40, 16) on level 2).
 */
export const A: StairSpec = { x: 20, y: 30, z: 0, dir: 'E', len: 4 };
export const B: StairSpec = { x: 40, y: 20, z: 1, dir: 'N', len: 4 };
export const inA = (x: number, y: number) => y === 30 && x >= 20 && x < 24;
export const inB = (x: number, y: number) => x === 40 && y <= 20 && y > 16;

export function stairsMap(withStairs = true) {
  const levels: LevelSpec[] = [
    { z: 0 },
    { z: 1, floor: (x, y) => !withStairs || !inA(x, y) },
    { z: 2, floor: (x, y) => !withStairs || !inB(x, y) },
  ];
  return buildLevels(levels, withStairs ? [A, B] : []);
}

export const WIDE: Stage4Config = {
  ...DEFAULT_STAGE4_CONFIG,
  vision: { ...DEFAULT_STAGE4_CONFIG.vision, fovHalfAngleDeg: 180 },
};

export function stairsSim(
  zombies: SimZombieSpawn[],
  opts: { stairs?: boolean; seed?: number } = {},
): Sim {
  return createSim({
    seed: opts.seed ?? 5,
    map: stairsMap(opts.stairs ?? true),
    // The player far away on level 2 (not seen, footsteps not heard).
    spawn: { x: 60.5, y: 60.5, z: 2 },
    content: fixtureContent(),
    dev: true,
    clockStart: NOON,
    aiConfig: WIDE,
    spawnZombies: zombies,
  });
}

export const eidOf = (sim: Sim, i = 0): number => {
  const sid = zombie(sim, i).stableId;
  const { StableId, Zombie } = sim.world.c;
  for (let eid = 0; eid < sim.world.capacity; eid++)
    if (Zombie.is[eid] && StableId.value[eid] === sid) return eid;
  return -1;
};

/** Sends the zombie to investigate (x, y) on floor z (as if it heard a noise there). */
export function sendTo(sim: Sim, i: number, x: number, y: number, z: number): void {
  const eid = eidOf(sim, i);
  const { Zombie } = sim.world.c;
  Zombie.state[eid] = ZombieState.investigate;
  Zombie.stateTick[eid] = 0;
  Zombie.memoryUntil[eid] = 6000; // long linger: stays at the spot
  Zombie.tx[eid] = Math.fround(x);
  Zombie.ty[eid] = Math.fround(y);
  Zombie.tz[eid] = z;
}
