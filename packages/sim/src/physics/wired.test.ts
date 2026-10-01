import { SNAPSHOT_ENTITY_STRIDE, SnapshotField, ENTITY_PHYS_STATES } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { aiSim, eventsOf, zombie } from '../test/ai-fixtures.js';
import { send } from '../test/content-fixtures.js';
import { createSim } from '../sim.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { bodyOf } from './system.js';

const KD = 60;
const GETUP = DEFAULT_PHYSICS_CONFIG.durations.getupZombie;

/** Every shove floors the zombie for exactly KD ticks. */
const sureKnockdown: PhysicsConfig = {
  ...DEFAULT_PHYSICS_CONFIG,
  chance: { ...DEFAULT_PHYSICS_CONFIG.chance, knockdownPerImpulse: 100 },
  durations: { ...DEFAULT_PHYSICS_CONFIG.durations, knockdownZombie: { min: KD, max: KD } },
};

const zombieBody = (sim: ReturnType<typeof aiSim>) => {
  const w = sim.world;
  const eid = [...w.physics.bodies.values()].find((b) => b.kind === 'zombie')!;
  return eid;
};

describe('physics in the sim', () => {
  it('a shoved zombie falls, cannot move or attack while down, gets up after the set ticks', () => {
    const sim = aiSim({ zombies: [{ x: 11.2, y: 10.5 }], physicsConfig: sureKnockdown });
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    sim.step();
    sim.drainEvents();
    const z = zombieBody(sim);
    expect(z.gaitSeed).not.toBe(0);

    const t0 = sim.tick;
    send(sim, { type: 'shove' });
    sim.step();
    const ev = eventsOf(sim.drainEvents(), 'physics');
    const player = sim.getPlayer()!.stableId;
    expect(ev).toEqual([
      { type: 'physics', tick: t0, kind: 'attackStart', entity: player },
      { type: 'physics', tick: t0, kind: 'hitLanded', entity: z.id, source: player },
      { type: 'physics', tick: t0, kind: 'fellDown', entity: z.id },
    ]);
    expect(z.state).toBe('knockdown');
    expect(z.stateStartTick).toBe(t0);
    expect(z.stateDuration).toBe(KD);

    // Snapshot carries the body (zombie = second record).
    const buf = sim.snapshot();
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const o = SNAPSHOT_ENTITY_STRIDE;
    expect(f[o + SnapshotField.stableId]).toBe(z.id);
    expect(ENTITY_PHYS_STATES[f[o + SnapshotField.state]!]).toBe('knockdown');
    expect(u[o + SnapshotField.stateStartTick]).toBe(t0);
    expect(f[o + SnapshotField.stateDuration]).toBe(KD);
    expect(f[o + SnapshotField.knockbackDirX]).toBeCloseTo(1, 5);
    expect(f[o + SnapshotField.knockbackStrength]).toBeGreaterThan(0);
    expect(f[o + SnapshotField.hitFromDir]).toBeCloseTo(Math.PI, 3);
    expect(u[o + SnapshotField.gaitSeed]).toBe(z.gaitSeed);

    // Slide stops after a few ticks, then the zombie lies still although it chases the player.
    while (sim.tick < t0 + 15) sim.step();
    const xDown = zombie(sim).x;
    expect(xDown).toBeGreaterThan(11.3);
    const attacks: number[] = [];
    while (sim.tick < t0 + KD) {
      sim.step();
      expect(zombie(sim).x).toBe(xDown);
      for (const e of eventsOf(sim.drainEvents(), 'hit'))
        if (e.source === 'zombie') attacks.push(e.tick);
    }
    expect(z.state).toBe('knockdown');
    sim.step(); // tick t0 + KD
    expect(z.state).toBe('getup');
    expect(z.stateStartTick).toBe(t0 + KD);
    expect(z.stateDuration).toBe(GETUP);
    while (sim.tick < t0 + KD + GETUP) {
      sim.step();
      expect(zombie(sim).x).toBe(xDown);
      for (const e of eventsOf(sim.drainEvents(), 'hit'))
        if (e.source === 'zombie') attacks.push(e.tick);
    }
    expect(attacks).toEqual([]);
    expect(z.state).toBe('getup');
    sim.drainEvents();
    sim.step(); // tick t0 + KD + GETUP
    expect(eventsOf(sim.drainEvents(), 'physics')).toContainEqual({
      type: 'physics',
      tick: t0 + KD + GETUP,
      kind: 'gotUp',
      entity: z.id,
    });
    expect(z.state).toBe('idle');
    // In control again: it walks back to the player.
    for (let i = 0; i < 10; i++) sim.step();
    expect(zombie(sim).x).toBeLessThan(xDown);
  });

  it('save during a knock-down and load give the same future', () => {
    const sim = aiSim({ zombies: [{ x: 11.2, y: 10.5 }], physicsConfig: sureKnockdown });
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    sim.step();
    send(sim, { type: 'shove' });
    for (let i = 0; i < 5; i++) sim.step();
    expect(zombieBody(sim).state).toBe('knockdown');
    const loaded = aiSim({ load: sim.save(), physicsConfig: sureKnockdown });
    expect(loaded.hash()).toBe(sim.hash());
    for (let i = 0; i < 120; i++) {
      sim.step();
      loaded.step();
    }
    expect(loaded.hash()).toBe(sim.hash());
    expect(zombieBody(loaded).state).toBe(zombieBody(sim).state);
  });

  it('exhausted players are slower; players get a body at spawn', () => {
    const dist = (setup: (s: ReturnType<typeof aiSim>) => void) => {
      const sim = aiSim();
      setup(sim);
      sim.step();
      send(sim, { type: 'move', dx: 1, dy: 0 });
      for (let i = 0; i < 40; i++) sim.step();
      return sim.getPlayer()!.x;
    };
    const rested = dist(() => {});
    const tired = dist((s) => send(s, { type: 'debugStat', stat: 'endurance', value: 20 }));
    expect(tired).toBeLessThan(rested);
    const eid = (s: ReturnType<typeof aiSim>) => s.world.players.get(0)!;
    const sim = aiSim();
    sim.step();
    expect(bodyOf(sim.world, eid(sim))?.kind).toBe('player');
  });

  it('is deterministic with bodies, hits and knock-downs', () => {
    const run = () => {
      const sim = createSim({
        ...{ seed: 9 },
        map: aiSim().world.map,
        spawn: { x: 10.5, y: 10.5 },
        content: undefined,
      });
      for (let i = 0; i < 50; i++) sim.step();
      return sim.hash();
    };
    expect(run()).toBe(run());
    const fight = () => {
      const sim = aiSim({
        zombies: [
          { x: 11.2, y: 10.5 },
          { x: 9.6, y: 10.5 },
        ],
        seed: 4,
      });
      let seq = 0;
      for (let t = 0; t < 400; t++) {
        if (t % 9 === 0)
          sim.enqueue({
            type: 'aim',
            x: t % 18 ? 12 : 8,
            y: 10.5,
            tick: sim.tick,
            playerId: 0,
            seq: seq++,
          });
        if (t % 6 === 0)
          sim.enqueue({
            type: t % 12 ? 'attack' : 'shove',
            tick: sim.tick,
            playerId: 0,
            seq: seq++,
          });
        sim.step();
      }
      return sim.hash();
    };
    expect(fight()).toBe(fight());
  });
});
