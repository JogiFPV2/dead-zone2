import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { commander } from '../test/level-fixtures.js';
import { levelSim, mapA } from '../test/stairs-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { stairFallChance } from './stair-trip.js';

const pbody = (sim: Sim) =>
  [...sim.world.physics.bodies.values()].find((b) => b.kind === 'player')!;

const withStairs = (o: Partial<PhysicsConfig['stairs']>): PhysicsConfig => ({
  ...DEFAULT_PHYSICS_CONFIG,
  stairs: { ...DEFAULT_PHYSICS_CONFIG.stairs, ...o },
});

/** Walks up the flight (x 20..24, +x), then comes down in `gait`; physics events of the descent. */
function runDown(gait: 'walk' | 'run' | 'sneak', perSec: number) {
  const sim = levelSim(mapA(), { x: 17.5, y: 20.5 }, [], {
    physicsConfig: withStairs({ runDownFallPerSec: perSec }),
  });
  const c = commander(sim);
  c.move(1, 0);
  for (let i = 0; i < 240; i++) sim.step();
  sim.drainEvents();
  c.move(-1, 0, gait);
  const ev: SimEvent[] = [];
  for (let i = 0; i < 200; i++) {
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return { sim, kinds: eventsOf(ev, 'physics').map((e) => e.kind) };
}

describe('entering a flight from the top', () => {
  it('a body stopped against the edge over the flight still walks / runs down', () => {
    for (const gait of ['walk', 'run'] as const) {
      const sim = levelSim(mapA(), { x: 26.5, y: 20.5, z: 1 });
      commander(sim).move(-1, 0, gait);
      for (let i = 0; i < 260; i++) sim.step();
      expect(sim.getPlayer()!.z).toBe(0);
      expect(sim.getPlayer()!.x).toBeLessThan(20);
    }
  });
});

describe('falling when running down stairs', () => {
  it('running down with a sure chance: tripped + fellDown on the flight', () => {
    const { kinds } = runDown('run', 1000);
    expect(kinds).toEqual(expect.arrayContaining(['tripped', 'fellDown']));
  });

  it('walking or sneaking down never falls, even with a sure chance', () => {
    expect(runDown('walk', 1000).kinds).not.toContain('tripped');
    expect(runDown('sneak', 1000).kinds).not.toContain('tripped');
  });

  it('default chance is small; sprint, load, fatigue and leg wounds raise it', () => {
    const { sim } = runDown('walk', DEFAULT_PHYSICS_CONFIG.stairs.runDownFallPerSec);
    const b = pbody(sim);
    const base = { ...b, carriedKg: 0, capacityKg: 12, endurance: 100 };
    const run = stairFallChance(sim.world, base, 2);
    expect(stairFallChance(sim.world, base, 1)).toBe(0);
    expect(run).toBeGreaterThan(0);
    expect(run).toBeLessThan(0.01);
    expect(stairFallChance(sim.world, base, 3)).toBeGreaterThan(run);
    expect(stairFallChance(sim.world, { ...base, carriedKg: 14 }, 2)).toBeGreaterThan(run);
    expect(stairFallChance(sim.world, { ...base, endurance: 10 }, 2)).toBeGreaterThan(run);
  });
});
