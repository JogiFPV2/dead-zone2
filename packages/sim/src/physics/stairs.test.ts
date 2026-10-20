import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from '../ai/config.js';
import { sortedQuery } from '../core/world.js';
import { createSim, type Sim } from '../sim.js';
import { eventsOf, NOON } from '../test/ai-fixtures.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { commander } from '../test/level-fixtures.js';
import { floorZ, hasFloor, stairsAt } from '../world/levels.js';
import { TileGrid } from '../world/grid.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { physicsHit } from './system.js';
import { mapA, shaftMap, harmless, levelSim } from '../test/stairs-fixtures.js';

const player = (sim: Sim) => sim.getPlayer()!;
const pbody = (sim: Sim) =>
  [...sim.world.physics.bodies.values()].find((b) => b.kind === 'player')!;

describe('levels: accessors', () => {
  it('hasFloor reads the floor layer, stairsAt the chunk stairs, floorZ floors z', () => {
    const map = mapA();
    const g = new TileGrid(map);
    expect(hasFloor(g, 21, 20, 0)).toBe(true);
    expect(hasFloor(g, 21, 20, 1)).toBe(false);
    expect(hasFloor(g, 25, 20, 1)).toBe(true);
    expect(stairsAt(g, 22, 20, 0)).toMatchObject({ tx: 20, ty: 20, z: 0, dir: 'E', len: 4 });
    expect(stairsAt(g, 30, 28, 0)).toMatchObject({ dir: 'N', len: 3 });
    expect(stairsAt(g, 24, 20, 0)).toBeUndefined();
    const sim = levelSim(map, { x: 10.5, y: 10.5 });
    const eid = sim.world.players.get(0)!;
    sim.world.c.Position.z[eid] = 0.75;
    expect(floorZ(sim.world, eid)).toBe(0);
    sim.world.c.Position.z[eid] = 1;
    expect(floorZ(sim.world, eid)).toBe(1);
  });
});

describe('stairs: moving', () => {
  it('climbs up (z linear along the flight, slower than on the flat) and back down', () => {
    const sim = levelSim(mapA(), { x: 17.5, y: 20.5 });
    const c = commander(sim);
    c.move(1, 0);
    const samples: { x: number; z: number }[] = [];
    let flat = 0;
    let up = 0;
    for (let i = 0; i < 240; i++) {
      const x0 = player(sim).x;
      sim.step();
      const p = player(sim);
      samples.push({ x: p.x, z: p.z });
      if (x0 > 18 && p.x < 19.5) flat = Math.max(flat, p.x - x0);
      if (x0 > 21 && p.x < 23) up = Math.max(up, p.x - x0);
      if (x0 > 20.5 && p.x < 23.5) expect(pbody(sim).state).toBe('climb');
    }
    for (const s of samples) {
      if (s.x <= 19.7) expect(s.z).toBe(0);
      else if (s.x > 20 && s.x < 24) expect(s.z).toBeCloseTo((s.x - 20) / 4, 4);
      else if (s.x >= 24.3) expect(s.z).toBe(1);
    }
    expect(up / flat).toBeCloseTo(DEFAULT_PHYSICS_CONFIG.stairs.upMul, 1);
    expect(player(sim).x).toBeGreaterThan(26);
    expect(player(sim).z).toBe(1);
    expect(pbody(sim).stair).toBe(0);

    c.move(-1, 0);
    let down = 0;
    for (let i = 0; i < 320; i++) {
      const x0 = player(sim).x;
      sim.step();
      const p = player(sim);
      if (x0 < 23 && p.x > 21) down = Math.max(down, x0 - p.x);
      if (p.x > 20 && p.x < 24) expect(p.z).toBeCloseTo((p.x - 20) / 4, 4);
    }
    expect(down / flat).toBeCloseTo(DEFAULT_PHYSICS_CONFIG.stairs.downMul, 1);
    expect(player(sim).x).toBeLessThan(19);
    expect(player(sim).z).toBe(0);
  });

  it('heavy load and fatigue slow the climb further', () => {
    const climb = (endurance: number) => {
      const sim = levelSim(mapA(), { x: 18.5, y: 20.5 });
      commander(sim).move(1, 0);
      let ticks = 0;
      for (; ticks < 400 && player(sim).z < 1; ticks++) {
        sim.world.survival!.vitals.endurance[sim.world.players.get(0)!] = endurance;
        sim.step();
      }
      return ticks;
    };
    expect(climb(5)).toBeGreaterThan(climb(100) * 1.3);
  });

  it('a flight cannot be entered from the side', () => {
    const sim = levelSim(mapA(), { x: 27.5, y: 29.5 });
    commander(sim).move(1, 0);
    for (let i = 0; i < 80; i++) sim.step();
    expect(player(sim).x).toBeLessThanOrEqual(30 - 0.3 + 1e-3);
    expect(player(sim).z).toBe(0);
    expect(pbody(sim).stair).toBe(0);
    // From the entrance side (south, moving N) it works.
    const s2 = levelSim(mapA(), { x: 30.5, y: 33.5 });
    commander(s2).move(0, -1);
    for (let i = 0; i < 120; i++) s2.step();
    expect(player(s2).z).toBe(1);
    expect(player(s2).y).toBeLessThan(27.7);
  });
});

/** Player on level `z` next to the shaft, a zombie west of it; a hard shove pushes the player in. */
function fall(z: number, seed = 7) {
  const sim = levelSim(shaftMap(), { x: 39.6, y: 40.5, z }, [{ x: 38.9, y: 40.5, z }], { seed });
  sim.step();
  sim.drainEvents();
  const w = sim.world;
  const zid = sortedQuery(w, 'zombies', [w.c.Zombie])[0]!;
  physicsHit(w, zid, w.players.get(0)!, 'shove', 1);
  const events: SimEvent[] = [];
  const zs: number[] = [];
  for (let i = 0; i < 80; i++) {
    sim.step();
    events.push(...sim.drainEvents());
    zs.push(player(sim).z);
  }
  return { sim, events, zs, hash: sim.hash() };
}

describe('stairs: falling', () => {
  it.each([
    [1, 0, 15],
    [2, 30, 55],
    [3, 60, 95],
  ])('knocked into a shaft %i level(s) down: fall, landing, damage in range', (levels, lo, hi) => {
    const r = fall(levels);
    const kinds = eventsOf(r.events, 'physics').map((e) => e.kind);
    expect(kinds).toContain('startedFalling');
    expect(kinds).toContain('landed');
    const [ev] = eventsOf(r.events, 'fellFromHeight');
    expect(ev).toMatchObject({ levels, killed: false });
    expect(ev!.damage).toBeGreaterThanOrEqual(lo);
    expect(ev!.damage).toBeLessThanOrEqual(hi);
    expect(player(r.sim).z).toBe(0);
    // Lands in a knock-down.
    const after = kinds.slice(kinds.indexOf('landed'));
    expect(after[1]).toBe('fellDown');
    // z drops monotonically from the level to 0.
    for (let i = 1; i < r.zs.length; i++) expect(r.zs[i]!).toBeLessThanOrEqual(r.zs[i - 1]!);
    // Deterministic: same seed → same damage and hash.
    const again = fall(levels);
    expect(eventsOf(again.events, 'fellFromHeight')).toEqual([ev]);
    expect(again.hash).toBe(r.hash);
  });

  it('from 4 levels the fall kills (cause `fall`)', () => {
    const r = fall(4);
    expect(eventsOf(r.events, 'fellFromHeight')[0]).toMatchObject({ levels: 4, killed: true });
    const s = r.sim.world.survival!;
    expect(s.vitals.health[r.sim.world.players.get(0)!]).toBe(0);
  });

  it('walking cannot step into a shaft; without a floor below a push stops at the edge', () => {
    const sim = levelSim(shaftMap(), { x: 38.5, y: 40.5, z: 2 });
    commander(sim).move(1, 0);
    for (let i = 0; i < 60; i++) sim.step();
    expect(player(sim).x).toBeLessThanOrEqual(40 - 0.3 + 1e-3);
    expect(player(sim).z).toBe(2);
  });
});

/** Player walks up flight A to along ≈ 3 (x ≈ 23) and stops; zombies wait on level 0. */
function crowdOnStairs(
  n: number,
  physicsConfig?: PhysicsConfig,
  seed = 7,
  aiConfig?: Stage4Config,
) {
  const zombies = Array.from({ length: n }, (_, i) => ({
    x: 12.5 - (i % 3),
    y: 18.5 + Math.floor(i / 3),
  }));
  const sim = levelSim(mapA(), { x: 18.5, y: 20.5 }, zombies, {
    seed,
    ...(physicsConfig ? { physicsConfig } : {}),
    ...(aiConfig ? { aiConfig } : {}),
  });
  const c = commander(sim);
  // Runs up (3.75 m/s) so the crowd starts queueing behind a player already holding the top.
  c.move(1, 0, 'run');
  // Releases early: braking from a run is jerk-limited, so the player coasts to x ≈ 23.
  while (player(sim).x < 22.6) sim.step();
  c.move(0, 0);
  for (let i = 0; i < 20; i++) sim.step();
  return { sim, c };
}

describe('stairs: crowds', () => {
  it('one at a time: zombies queue up the flight with the set spacing', () => {
    const { sim } = crowdOnStairs(8);
    const gap = DEFAULT_PHYSICS_CONFIG.stairs.spacing;
    let maxOn = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const on = [...sim.world.physics.bodies.values()]
        .filter((b) => b.stair === 1)
        .map((b) => b.x)
        .sort((a, b) => a - b);
      maxOn = Math.max(maxOn, on.length);
      for (let k = 1; k < on.length; k++) expect(on[k]! - on[k - 1]!).toBeGreaterThan(gap - 0.02);
    }
    // Player at x ≈ 23 + zombies from x ≈ 19.7 up: at most 5 bodies fit.
    expect(maxOn).toBeGreaterThanOrEqual(4);
    expect(maxOn).toBeLessThanOrEqual(5);
    // Nobody got onto the flight from the side or past the player.
    for (const z of sim.getZombies()) expect(z.x).toBeLessThan(player(sim).x);
  });

  it('a crowd pushing up the flight shoves the player holding it; a lone zombie does not', () => {
    const pushes = (n: number) => {
      const { sim } = crowdOnStairs(n);
      const pid = player(sim).stableId;
      let hits = 0;
      for (let i = 0; i < 400; i++) {
        sim.step();
        hits += eventsOf(sim.drainEvents(), 'physics').filter(
          (e) => e.kind === 'hitLanded' && e.entity === pid,
        ).length;
      }
      return hits;
    };
    expect(pushes(1)).toBe(0);
    expect(pushes(8)).toBeGreaterThan(0);
  });

  it('domino: a shove down the flight floors the column below (chance 1) or only the first (0)', () => {
    const sure: PhysicsConfig = {
      ...DEFAULT_PHYSICS_CONFIG,
      chance: { ...DEFAULT_PHYSICS_CONFIG.chance, knockdownPerImpulse: 100 },
    };
    const run = (dominoChance: number) => {
      const cfg = { ...sure, stairs: { ...sure.stairs, dominoChance, dominoDecay: 1 } };
      // The crowd stops 0.45 m short of the player (the stop gap before contact attacks), so
      // the shove reaches only the first zombie and the rest is the domino.
      const { sim, c } = crowdOnStairs(6, cfg, 7, {
        ...DEFAULT_STAGE4_CONFIG,
        ai: { ...DEFAULT_STAGE4_CONFIG.ai, reachTiles: 0.45 },
      });
      for (let i = 0; i < 300; i++) sim.step();
      // Turn to face down the flight (the facing turns smoothly).
      c.aim(20, 20.5);
      for (let i = 0; i < 20; i++) sim.step();
      sim.drainEvents();
      const onFlight = [...sim.world.physics.bodies.values()].filter(
        (b) => b.kind === 'zombie' && b.stair === 1,
      ).length;
      c.shove();
      const evs: SimEvent[] = [];
      for (let i = 0; i < 10; i++) {
        sim.step();
        evs.push(...sim.drainEvents());
      }
      const fell = eventsOf(evs, 'physics').filter((e) => e.kind === 'fellDown');
      return { onFlight, fell: fell.length };
    };
    const all = run(1);
    expect(all.onFlight).toBeGreaterThanOrEqual(3);
    expect(all.fell).toBe(all.onFlight);
    expect(run(0).fell).toBe(1);
  });

  it('is deterministic (crowd on stairs, same seed → same hash)', () => {
    const go = () => {
      const { sim } = crowdOnStairs(8, undefined, 3);
      for (let i = 0; i < 300; i++) sim.step();
      return sim.hash();
    };
    expect(go()).toBe(go());
  });

  it('save / load on the stairs keeps the hash', () => {
    const { sim } = crowdOnStairs(6);
    for (let i = 0; i < 150; i++) sim.step();
    const b = createSim({
      seed: 7,
      map: mapA(),
      content: fixtureContent(),
      dev: true,
      clockStart: NOON,
      combatConfig: harmless,
      load: sim.save(),
    });
    expect(b.hash()).toBe(sim.hash());
    for (let i = 0; i < 150; i++) {
      sim.step();
      b.step();
    }
    expect(b.hash()).toBe(sim.hash());
  });
});
