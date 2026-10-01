import type { SimZombieSpawn } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { NOON, runTicks, runUntil, zombie } from '../test/ai-fixtures.js';
import { buildLevels, type LevelSpec, type StairSpec } from '../test/level-fixtures.js';
import { canStep } from '../nav/grid-nav.js';
import { walkableLine } from '../world/los.js';
import { gridOf } from './commands.js';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from './config.js';
import { crossFloorWaypoint, nearestPassage } from './floors.js';
import { ZombieState } from './state.js';

/**
 * Zombies walking to goals on other floors over stairs (ai/floors.ts, physics walks the flight).
 * Map: levels 0..2 on 64×64, floor everywhere except the stairwells above the flights.
 * Flight A (20..23, 30) climbs E from level 0 (entrance x = 19, landing (24, 30) on level 1).
 * Flight B (40, 20..17) climbs N from level 1 (entrance y = 21, landing (40, 16) on level 2).
 */
const A: StairSpec = { x: 20, y: 30, z: 0, dir: 'E', len: 4 };
const B: StairSpec = { x: 40, y: 20, z: 1, dir: 'N', len: 4 };
const inA = (x: number, y: number) => y === 30 && x >= 20 && x < 24;
const inB = (x: number, y: number) => x === 40 && y <= 20 && y > 16;

function stairsMap(withStairs = true) {
  const levels: LevelSpec[] = [
    { z: 0 },
    { z: 1, floor: (x, y) => !withStairs || !inA(x, y) },
    { z: 2, floor: (x, y) => !withStairs || !inB(x, y) },
  ];
  return buildLevels(levels, withStairs ? [A, B] : []);
}

const WIDE: Stage4Config = {
  ...DEFAULT_STAGE4_CONFIG,
  vision: { ...DEFAULT_STAGE4_CONFIG.vision, fovHalfAngleDeg: 180 },
};

function stairsSim(zombies: SimZombieSpawn[], opts: { stairs?: boolean; seed?: number } = {}): Sim {
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

const eidOf = (sim: Sim, i = 0): number => {
  const sid = zombie(sim, i).stableId;
  const { StableId, Zombie } = sim.world.c;
  for (let eid = 0; eid < sim.world.capacity; eid++)
    if (Zombie.is[eid] && StableId.value[eid] === sid) return eid;
  return -1;
};

/** Sends the zombie to investigate (x, y) on floor z (as if it heard a noise there). */
function sendTo(sim: Sim, i: number, x: number, y: number, z: number): void {
  const eid = eidOf(sim, i);
  const { Zombie } = sim.world.c;
  Zombie.state[eid] = ZombieState.investigate;
  Zombie.stateTick[eid] = 0;
  Zombie.memoryUntil[eid] = 6000; // long linger: stays at the spot
  Zombie.tx[eid] = Math.fround(x);
  Zombie.ty[eid] = Math.fround(y);
  Zombie.tz[eid] = z;
}

const near = (sim: Sim, x: number, y: number, z: number, d = 1.2, i = 0): boolean => {
  const zz = zombie(sim, i);
  return zz.z === z && (zz.x - x) ** 2 + (zz.y - y) ** 2 < d * d;
};

describe('stairs AI: nearestPassage', () => {
  it('up: the tile in front of the entrance; down: the top landing; none on other floors', () => {
    const grid = gridOf(stairsSim([]).world);
    expect(nearestPassage(grid, 0, 5.5, 5.5, 1)).toMatchObject({
      ax: 19,
      ay: 30,
      fromZ: 0,
      toZ: 1,
      stair: { tx: 20, ty: 30 },
    });
    // More than one floor up: the next floor first.
    expect(nearestPassage(grid, 0, 5.5, 5.5, 2)).toMatchObject({ ax: 19, ay: 30, toZ: 1 });
    expect(nearestPassage(grid, 1, 5.5, 5.5, 2)).toMatchObject({ ax: 40, ay: 21, toZ: 2 });
    expect(nearestPassage(grid, 1, 5.5, 5.5, 0)).toMatchObject({ ax: 24, ay: 30, toZ: 0 });
    expect(nearestPassage(grid, 2, 5.5, 5.5, 0)).toMatchObject({ ax: 40, ay: 16, toZ: 1 });
    expect(nearestPassage(grid, 0, 5.5, 5.5, -1)).toBeUndefined();
    expect(nearestPassage(grid, 2, 5.5, 5.5, 3)).toBeUndefined();
    expect(nearestPassage(grid, 0, 5.5, 5.5, 0)).toBeUndefined();
  });

  it('nearest by distance, ties by ty / tx; beyond the search radius: none', () => {
    const map = buildLevels(
      [{ z: 0 }, { z: 1 }],
      [
        { x: 10, y: 10, z: 0, dir: 'E', len: 2 },
        { x: 10, y: 20, z: 0, dir: 'E', len: 2 },
        { x: 50, y: 15, z: 0, dir: 'E', len: 2 },
      ],
      320,
    );
    const sim = createSim({
      seed: 1,
      map,
      spawn: { x: 300.5, y: 300.5 },
      content: fixtureContent(),
    });
    const grid = gridOf(sim.world);
    // (9, 10) and (9, 20) are equally far from (9.5, 15.5): lower ty wins.
    expect(nearestPassage(grid, 0, 9.5, 15.5, 1)).toMatchObject({ ax: 9, ay: 10 });
    expect(nearestPassage(grid, 0, 9.5, 19.5, 1)).toMatchObject({ ax: 9, ay: 20 });
    expect(nearestPassage(grid, 0, 45.5, 15.5, 1)).toMatchObject({ ax: 49, ay: 15 });
    // 2 chunks around chunk (9, 9): nothing at tile < 224.
    expect(nearestPassage(grid, 0, 300.5, 300.5, 1)).toBeUndefined();
  });

  it('nav: a flight is entered only through its entrance and left only through it', () => {
    const grid = gridOf(stairsSim([]).world);
    expect(canStep(grid, 0, 19, 30, 1, 0)).toBe(true); // entrance
    expect(canStep(grid, 0, 20, 30, 1, 0)).toBe(true); // along
    expect(canStep(grid, 0, 21, 30, -1, 0)).toBe(true);
    expect(canStep(grid, 0, 20, 30, -1, 0)).toBe(true); // out of the bottom
    expect(canStep(grid, 0, 21, 29, 0, 1)).toBe(false); // from the side
    expect(canStep(grid, 0, 21, 30, 0, -1)).toBe(false);
    expect(canStep(grid, 0, 24, 30, -1, 0)).toBe(false); // under the top
    expect(canStep(grid, 0, 23, 30, 1, 0)).toBe(false);
    expect(canStep(grid, 0, 19, 29, 1, 1)).toBe(false); // diagonal
    expect(canStep(grid, 0, 25, 29, 1, 0)).toBe(true); // elsewhere unchanged
    // Straight lines: across a flight no, along it through the entrance yes.
    expect(walkableLine(grid, 0, 21.5, 28.5, 21.5, 32.5)).toBe(false);
    expect(walkableLine(grid, 0, 10.5, 30.5, 40.5, 30.5)).toBe(false);
    expect(walkableLine(grid, 0, 15.5, 30.5, 22.5, 30.5)).toBe(true);
    expect(walkableLine(grid, 0, 21.5, 26.5, 21.5, 29.5)).toBe(true);
  });
});

describe('stairs AI: walking to another floor', () => {
  it('a zombie on the ground floor hears a noise upstairs and walks up the stairs to it', () => {
    const sim = stairsSim([{ x: 30.5, y: 24.5, z: 0 }]);
    // 4 tiles away in the plane, one floor up (radius × floorMul 0.5).
    sim.enqueue({
      type: 'debugNoise',
      x: 32.5,
      y: 26.5,
      z: 1,
      radiusTiles: 30,
      tick: sim.tick,
      playerId: 0,
      seq: 1,
    });
    runTicks(sim, 25);
    expect(zombie(sim).state).toBe('investigate');
    expect(sim.world.c.Zombie.tz[eidOf(sim)]).toBe(1);
    let climbed = false;
    const t = runUntil(
      sim,
      () => {
        const zz = sim.getZombies()[0]!;
        if (zz.z > 0 && zz.z < 1) climbed = true;
        return near(sim, 32.5, 26.5, 1);
      },
      3000,
    );
    expect(t).toBeGreaterThan(0);
    expect(climbed).toBe(true);
    // Stays there (investigating on the right floor).
    expect(zombie(sim).state).toBe('investigate');
  });

  it('down: from level 1 to a noise on the ground floor', () => {
    const sim = stairsSim([{ x: 30.5, y: 34.5, z: 1 }]);
    sendTo(sim, 0, 10.5, 34.5, 0);
    expect(runUntil(sim, () => near(sim, 10.5, 34.5, 0), 3000)).toBeGreaterThan(0);
  });

  it('two floors at once: one flight after the other (0 → 1 → 2 and back)', () => {
    const sim = stairsSim([{ x: 10.5, y: 10.5, z: 0 }]);
    sendTo(sim, 0, 50.5, 10.5, 2);
    expect(runUntil(sim, () => near(sim, 50.5, 10.5, 2), 5000)).toBeGreaterThan(0);
    sendTo(sim, 0, 10.5, 40.5, 0);
    expect(runUntil(sim, () => near(sim, 10.5, 40.5, 0), 5000)).toBeGreaterThan(0);
  });

  it('a chaser that lost sight follows its memory up the stairs', () => {
    const sim = stairsSim([{ x: 26.5, y: 26.5, z: 0 }]);
    const eid = eidOf(sim);
    const { Zombie } = sim.world.c;
    Zombie.state[eid] = ZombieState.chase;
    Zombie.targetId[eid] = sim.getPlayer()!.stableId;
    Zombie.memoryUntil[eid] = sim.tick + 2000;
    Zombie.tx[eid] = 30.5;
    Zombie.ty[eid] = 30.5;
    Zombie.tz[eid] = 1;
    expect(runUntil(sim, () => zombie(sim).z === 1, 2000)).toBeGreaterThan(0);
  });

  it('no stairs: walks to the projection on its own floor (as before)', () => {
    const sim = stairsSim([{ x: 30.5, y: 34.5, z: 0 }], { stairs: false });
    sendTo(sim, 0, 40.5, 34.5, 1);
    const eid = eidOf(sim);
    expect(crossFloorWaypoint(sim.world, gridOf(sim.world), eid, 30.5, 34.5, 0)).toBeUndefined();
    expect(runUntil(sim, () => near(sim, 40.5, 34.5, 0, 0.6), 1000)).toBeGreaterThan(0);
    runTicks(sim, 40);
    expect(zombie(sim).z).toBe(0);
    expect(zombie(sim).state).toBe('investigate');
  });

  it('a goal on its own floor ignores the stairs (no waypoint)', () => {
    const sim = stairsSim([{ x: 10.5, y: 30.5, z: 0 }]);
    sendTo(sim, 0, 40.5, 30.5, 0);
    expect(
      crossFloorWaypoint(sim.world, gridOf(sim.world), eidOf(sim), 10.5, 30.5, 0),
    ).toBeUndefined();
    expect(runUntil(sim, () => near(sim, 40.5, 30.5, 0, 0.6), 1500)).toBeGreaterThan(0);
  });
});

interface PerfHost {
  performance: { now(): number };
  process: { stderr: { write(s: string): void } };
}
// Test-only access to the host clock; the sim itself never reads real time.
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;

describe('stairs AI: determinism and cost', () => {
  it('same seed = same hash; save in the middle of the climb and load = same continuation', () => {
    const run = (): Sim => {
      const sim = stairsSim(
        [
          { x: 10.5, y: 10.5, z: 0 },
          { x: 12.5, y: 12.5, z: 0 },
          { x: 30.5, y: 40.5, z: 1 },
        ],
        { seed: 9 },
      );
      sendTo(sim, 0, 50.5, 10.5, 2);
      sendTo(sim, 1, 30.5, 26.5, 1);
      sendTo(sim, 2, 5.5, 40.5, 0);
      return sim;
    };
    const a = run();
    const b = run();
    const onFlight = () => a.getZombies().some((z) => z.z % 1 !== 0);
    expect(runUntil(a, onFlight, 2000)).toBeGreaterThan(0);
    runTicks(b, a.tick - b.tick);
    expect(b.hash()).toBe(a.hash());
    const loaded = createSim({
      seed: 9,
      map: stairsMap(),
      spawn: { x: 60.5, y: 60.5, z: 2 },
      content: fixtureContent(),
      dev: true,
      clockStart: NOON,
      aiConfig: WIDE,
      load: a.save(),
    });
    expect(loaded.hash()).toBe(a.hash());
    runTicks(a, 600);
    runTicks(b, 600);
    runTicks(loaded, 600);
    expect(b.hash()).toBe(a.hash());
    expect(loaded.hash()).toBe(a.hash());
  });

  it(
    '200 zombies with goals upstairs cost about the same as with goals on their floor',
    { timeout: 120_000 },
    () => {
      const zs: SimZombieSpawn[] = [];
      for (let i = 0; i < 200; i++)
        zs.push({ x: 2.5 + (i % 20) * 3, y: 2.5 + Math.floor(i / 20) * 2, z: 0 });
      const time = (goalZ: number) => {
        const sim = stairsSim(zs);
        for (let i = 0; i < sim.getZombies().length; i++)
          sendTo(sim, i, 30.5 + (i % 10), 40.5, goalZ);
        runTicks(sim, 20);
        let best = Infinity;
        for (let b = 0; b < 3; b++) {
          const t0 = host.performance.now();
          runTicks(sim, 100);
          best = Math.min(best, (host.performance.now() - t0) / 100);
        }
        return { best, sim };
      };
      const same = time(0);
      const up = time(1);
      host.process.stderr.write(
        `[perf] 200 zombies: goals upstairs ${up.best.toFixed(2)} ms vs same floor ${same.best.toFixed(2)} ms\n`,
      );
      expect(up.best).toBeLessThanOrEqual(same.best * 1.5 + 0.5);
      expect(up.sim.getZombies().some((z) => z.z >= 0.5)).toBe(true);
    },
  );
});
