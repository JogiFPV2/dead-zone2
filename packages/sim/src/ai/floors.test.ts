import { simMapFromData, simMapToData, type SimMap, type SimZombieSpawn } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { fixtureContent, send } from '../test/content-fixtures.js';
import { NOON, eventsOf, runTicks, zombie } from '../test/ai-fixtures.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { storagesView } from '../items/views.js';
import { gridOf } from './commands.js';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from './config.js';
import { crossFloorWaypoint, floorOf, nearestPassage } from './floors.js';
import { emitNoise, heardRadius } from './noise.js';
import type { Noise } from './state.js';

/** All-around sight, so tests do not depend on the random spawn facing. */
const WIDE: Stage4Config = {
  ...DEFAULT_STAGE4_CONFIG,
  vision: { ...DEFAULT_STAGE4_CONFIG.vision, fovHalfAngleDeg: 180 },
};

/** A building of several floors: the same 64×64 layout (or `perLevel`) on every level of `levels`. */
function floorsMap(
  levels: readonly number[],
  perLevel: (z: number) => MapSpec = () => ({}),
): SimMap {
  const chunks = levels.flatMap((z) =>
    simMapToData(buildMap(perLevel(z)), { cx0: 0, cy0: 0, cx1: 1, cy1: 1, z: 0 }).chunks.map(
      (c) => ({ ...c, z }),
    ),
  );
  return simMapFromData({ chunks });
}

function floorsSim(
  opts: {
    levels?: readonly number[];
    perLevel?: (z: number) => MapSpec;
    spawn?: { x: number; y: number; z: number };
    zombies?: readonly SimZombieSpawn[];
    worldSettings?: object;
    seed?: number;
  } = {},
): Sim {
  return createSim({
    seed: opts.seed ?? 11,
    map: floorsMap(opts.levels ?? [-1, 0, 1, 2], opts.perLevel),
    spawn: opts.spawn ?? { x: 10.5, y: 10.5, z: 0 },
    content: fixtureContent(opts.worldSettings),
    dev: true,
    clockStart: NOON,
    aiConfig: WIDE,
    ...(opts.zombies ? { spawnZombies: opts.zombies } : {}),
  });
}

const noiseAt = (z: number, radius = 10): Noise => ({
  tick: 0,
  x: 20.5,
  y: 20.5,
  z,
  radius,
  volume: 1,
  source: 0,
  lingerSec: 0,
});

const zombieEid = (sim: Sim): number => {
  const sid = zombie(sim).stableId;
  const { StableId, Zombie } = sim.world.c;
  for (let eid = 0; eid < sim.world.capacity; eid++)
    if (Zombie.is[eid] && StableId.value[eid] === sid) return eid;
  return -1;
};

describe('floors: hearing through ceilings', () => {
  it('radius × floorMul per floor, nothing beyond maxFloors, fractional z = lower floor', () => {
    const sim = floorsSim();
    const ai = sim.world.ai!;
    const grid = gridOf(sim.world);
    const ref = ai.cfg.noise.referenceHearingTiles;
    expect(ai.cfg.noise).toMatchObject({ floorMul: 0.5, maxFloors: 2 });
    const r = (z: number, lz: number): number =>
      heardRadius(ai, grid, noiseAt(z), 20.5, 21.5, lz, ref);
    expect(r(0, 0)).toBeCloseTo(10, 5);
    expect(r(0, 1)).toBeCloseTo(5, 5);
    expect(r(0, -1)).toBeCloseTo(5, 5);
    expect(r(1, -1)).toBeCloseTo(2.5, 5);
    expect(r(0, 3)).toBe(0);
    // On stairs (z = 0.6) the listener counts as floor 0.
    expect(r(0, 0.6)).toBeCloseTo(10, 5);
    expect(r(1, 0.6)).toBeCloseTo(5, 5);
    // Out of the damped radius: 6 tiles away is heard on the same floor, not one floor up.
    expect(heardRadius(ai, grid, noiseAt(0), 26.5, 20.5, 0, ref)).toBeGreaterThan(0);
    expect(heardRadius(ai, grid, noiseAt(0), 26.5, 20.5, 1, ref)).toBe(0);
  });

  it('worldSettings.noise overrides the defaults (floorMul 0 = ceilings are soundproof)', () => {
    const sim = floorsSim({ worldSettings: { noise: { floorMul: 0, maxFloors: 1 } } });
    const ai = sim.world.ai!;
    const grid = gridOf(sim.world);
    expect(ai.cfg.noise).toMatchObject({ floorMul: 0, maxFloors: 1 });
    const ref = ai.cfg.noise.referenceHearingTiles;
    expect(heardRadius(ai, grid, noiseAt(0), 20.5, 21.5, 1, ref)).toBe(0);
    expect(heardRadius(ai, grid, noiseAt(0), 20.5, 21.5, 0, ref)).toBeGreaterThan(0);
  });

  it('emitNoise stores the floor index (fractional z on stairs)', () => {
    const sim = floorsSim();
    emitNoise(sim.world, 20.5, 20.5, 1.4, 4, 1, 'debug');
    emitNoise(sim.world, 20.5, 20.5, -0.5, 4, 1, 'debug');
    expect(sim.world.ai!.noises.map((n) => n.z)).toEqual([1, -1]);
    expect(eventsOf(sim.drainEvents(), 'noise').map((e) => e.z)).toEqual([1, -1]);
  });

  it('a zombie in the cellar hears a noise upstairs and remembers the source floor', () => {
    const sim = floorsSim({ zombies: [{ x: 40.5, y: 40.5, z: -1 }] });
    expect(zombie(sim).z).toBe(-1);
    send(sim, { type: 'debugNoise', x: 44.5, y: 40.5, z: 0, radiusTiles: 20 });
    runTicks(sim, 25);
    expect(zombie(sim).state).toBe('investigate');
    expect(sim.world.c.Zombie.tz[zombieEid(sim)]).toBe(0);
    expect(eventsOf(sim.drainEvents(), 'zombieAlerted')).toMatchObject([{ reason: 'noise' }]);
    // No stairs on this map: walks below the source on its own floor (stairs: stairs-ai.test.ts).
    runTicks(sim, 200);
    expect(zombie(sim).z).toBe(-1);
    expect(Math.abs(zombie(sim).x - 44.5)).toBeLessThan(1.5);
  });

  it('three floors away the noise is not heard', () => {
    const sim = floorsSim({ zombies: [{ x: 40.5, y: 40.5, z: -1 }] });
    send(sim, { type: 'debugNoise', x: 40.5, y: 40.5, z: 2, radiusTiles: 30 });
    runTicks(sim, 25);
    expect(zombie(sim).state).not.toBe('investigate');
  });
});

describe('floors: sight stays on one floor', () => {
  it('a zombie does not see a player on the floor above (control: same floor)', () => {
    const above = floorsSim({
      spawn: { x: 10.5, y: 10.5, z: 1 },
      zombies: [{ x: 13.5, y: 10.5, z: 0 }],
    });
    runTicks(above, 40);
    expect(zombie(above).state).not.toBe('chase');
    const same = floorsSim({ zombies: [{ x: 13.5, y: 10.5, z: 0 }] });
    runTicks(same, 8);
    expect(zombie(same).state).toBe('chase');
  });

  it('views only list storage on the player floor; the snapshot carries z for the client', () => {
    const sim = floorsSim({
      spawn: { x: 10.5, y: 10.5, z: 1 },
      perLevel: (z) =>
        z === 1 ? { objects: [{ contentId: 'fixture:cabinet', x: 11, y: 10 }] } : {},
      zombies: [{ x: 30.5, y: 30.5, z: 2 }],
    });
    const st = sim.world.items!;
    const world = [...st.containers.values()].filter((c) => c.kind === 'world');
    expect(world.map((c) => c.z)).toEqual([1]);
    const p = sim.world.players.get(0)!;
    expect(storagesView(sim.world, p, 20).map((v) => v.id)).toEqual([world[0]!.id]);
    sim.world.c.Position.z[p] = 0;
    expect(storagesView(sim.world, p, 20)).toEqual([]);
  });
});

describe('floors: spawning', () => {
  it('createSim({ spawnZombies }) and debugSpawnZombie use the given floor and its free tiles', () => {
    // Floor 1 has floor tiles only in x 20..29 (a small storey).
    const sim = floorsSim({
      levels: [0, 1],
      perLevel: (z) => (z === 1 ? { floor: (x) => (x >= 20 && x < 30 ? 1 : 0) } : {}),
      zombies: [{ x: 25.5, y: 25.5, z: 1 }],
    });
    expect(zombie(sim).z).toBe(1);
    expect(sim.world.c.Zombie.tz[zombieEid(sim)]).toBe(1);
    send(sim, { type: 'debugSpawnZombie', x: 20.5, y: 10.5, z: 1, count: 6 });
    sim.step();
    const up = sim.getZombies().filter((zz) => zz.z === 1);
    expect(up).toHaveLength(7);
    for (const zz of up) expect(zz.x).toBeGreaterThanOrEqual(20);
  });
});

describe('floors: loot', () => {
  it('floor loot and world storage are created on every floor of the map', () => {
    const sim = createSim({
      seed: 3,
      map: floorsMap([-1, 0, 1], () => ({
        objects: [{ contentId: 'fixture:cabinet', x: 5, y: 5 }],
      })),
      spawn: { x: 10.5, y: 10.5, z: 0 },
      content: fixtureContent(),
      floorLoot: true,
    });
    const cs = [...sim.world.items!.containers.values()];
    const floors = (kind: string): number[] =>
      [...new Set(cs.filter((c) => c.kind === kind).map((c) => c.z))].sort((a, b) => a - b);
    expect(floors('world')).toEqual([-1, 0, 1]);
    expect(floors('ground').length).toBeGreaterThan(1);
  });
});

describe('floors: goal on another floor (map without stairs)', () => {
  it('no stairs: nearestPassage / crossFloorWaypoint return none', () => {
    const sim = floorsSim({ zombies: [{ x: 40.5, y: 40.5, z: 0 }] });
    const grid = gridOf(sim.world);
    expect(nearestPassage(grid, 0, 40.5, 40.5, 1)).toBeUndefined();
    const eid = zombieEid(sim);
    sim.world.c.Zombie.tz[eid] = 1;
    expect(crossFloorWaypoint(sim.world, grid, eid, 40.5, 40.5, 0)).toBeUndefined();
    expect(floorOf(-0.5)).toBe(-1);
    expect(floorOf(1.99)).toBe(1);
  });

  it('deterministic, and a goal floor survives save / load', () => {
    const run = (): Sim => {
      const sim = floorsSim({ zombies: [{ x: 40.5, y: 40.5, z: -1 }], seed: 5 });
      // Fixed seq (the `send` helper numbers commands globally, which is hashed).
      const cmd = { type: 'debugNoise', x: 44.5, y: 40.5, z: 0, radiusTiles: 20 } as const;
      expect(sim.enqueue({ ...cmd, tick: sim.tick, playerId: 0, seq: 1 }).ok).toBe(true);
      runTicks(sim, 30);
      return sim;
    };
    const a = run();
    const b = run();
    expect(a.hash()).toBe(b.hash());
    expect(a.world.c.Zombie.tz[zombieEid(a)]).toBe(0);
    const loaded = createSim({
      seed: 5,
      map: floorsMap([-1, 0, 1, 2]),
      spawn: { x: 10.5, y: 10.5, z: 0 },
      content: fixtureContent(),
      dev: true,
      clockStart: NOON,
      aiConfig: WIDE,
      load: a.save(),
    });
    expect(loaded.hash()).toBe(a.hash());
    expect(loaded.world.c.Zombie.tz[zombieEid(loaded)]).toBe(0);
    runTicks(a, 20);
    runTicks(loaded, 20);
    expect(loaded.hash()).toBe(a.hash());
  });
});
