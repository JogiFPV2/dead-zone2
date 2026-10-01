import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { createSim, type Sim } from '../sim.js';
import { aiSim, NOON } from '../test/ai-fixtures.js';
import { fixtureContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { activeChunkRadius } from './active.js';
import type { PhysicsBody } from './types.js';

const KD = 60;
/** Window = the player's chunk only; every shove floors the zombie for exactly KD ticks. */
const cfg: PhysicsConfig = {
  ...DEFAULT_PHYSICS_CONFIG,
  activeChunkRadius: 0,
  chance: { ...DEFAULT_PHYSICS_CONFIG.chance, knockdownPerImpulse: 100 },
  durations: { ...DEFAULT_PHYSICS_CONFIG.durations, knockdownZombie: { min: KD, max: KD } },
};
const harmless = {
  ...DEFAULT_COMBAT_CONFIG,
  zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
};
const MAP = { width: 128, height: 32 };
const zombies = [
  { x: 11.2, y: 10.5 },
  { x: 100.5, y: 10.5 },
  { x: 120.5, y: 20.5 },
];
const make = (load?: Uint8Array): Sim =>
  load
    ? createSim({
        seed: 11,
        map: buildMap(MAP),
        content: fixtureContent(),
        dev: true,
        clockStart: NOON,
        physicsConfig: cfg,
        combatConfig: harmless,
        load,
      })
    : aiSim({ map: MAP, zombies, physicsConfig: cfg, combatConfig: harmless });
const bodies = (sim: Sim): PhysicsBody[] =>
  [...sim.world.physics.bodies.values()].filter((b) => b.kind === 'zombie');
const playerEid = (sim: Sim) => [...sim.world.players.values()][0]!;
const movePlayer = (sim: Sim, x: number) => (sim.world.c.Position.x[playerEid(sim)] = x);

describe('physics: active chunks', () => {
  it('reuses the AI radius: ceil(ai.farTiles / 32) chunks, overridable', () => {
    expect(activeChunkRadius(aiSim({}).world)).toBe(2);
    expect(activeChunkRadius(make().world)).toBe(0);
  });

  it('bodies outside every window are frozen: no movement, no separation', () => {
    const sim = make();
    const far = sim.getZombies().filter((z) => z.x > 64);
    for (let i = 0; i < 200; i++) sim.step();
    const [near, ...rest] = bodies(sim);
    expect(near!.frozenAt).toBe(-1);
    for (const b of rest) expect(b.frozenAt).toBeGreaterThanOrEqual(0);
    const now = sim.getZombies().filter((z) => z.x > 64);
    expect(now.map((z) => [z.x, z.y])).toEqual(far.map((z) => [z.x, z.y]));
  });

  it('a knock-down counts active ticks only: it continues where it stopped', () => {
    /** Ticks in knock-down (from the shove to getting up), optionally frozen for 200 ticks. */
    const downFor = (freeze: boolean) => {
      const sim = make();
      send(sim, { type: 'aim', x: 12, y: 10.5 });
      sim.step();
      send(sim, { type: 'shove' });
      sim.step();
      const z = bodies(sim)[0]!;
      expect(z.state).toBe('knockdown');
      let active = 1;
      for (let i = 0; i < 9; i++, active++) sim.step();
      if (freeze) {
        const before = sim.tick - z.stateStartTick;
        movePlayer(sim, 100.5); // the zombie's chunk leaves the window
        for (let i = 0; i < 200; i++) sim.step();
        expect(z.frozenAt).toBeGreaterThanOrEqual(0);
        expect(z.state).toBe('knockdown');
        movePlayer(sim, 10.5);
        sim.step();
        expect(z.frozenAt).toBe(-1);
        expect(sim.tick - z.stateStartTick).toBe(before + 1);
        active++;
      }
      while (z.state === 'knockdown' && active < 500) {
        sim.step();
        active++;
      }
      return active;
    };
    expect(downFor(true)).toBe(downFor(false));
    expect(downFor(false)).toBe(KD + 1);
  });

  it('deterministic, and save / load with frozen bodies keeps the hash', () => {
    const run = () => {
      const sim = make();
      for (let i = 0; i < 120; i++) sim.step();
      return sim;
    };
    const a = run();
    expect(a.hash()).toBe(run().hash());
    const b = make(a.save());
    expect(b.hash()).toBe(a.hash());
    for (let i = 0; i < 100; i++) {
      a.step();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
  });
});
