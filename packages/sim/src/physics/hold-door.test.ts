import type { SimEvent, SimZombieSpawn } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { eventsOf, NOON } from '../test/ai-fixtures.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { openingKey } from '../openings/state.js';

/** Room x/y ∈ [20, 30) with a door in the west wall at (20, 25); the player holds it inside. */
const room = {
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) => (x === 20 && y === 25 ? 2 : 1),
  edgeKinds: [null, 'wall', 'door'] as const,
};
const KEY = openingKey(1, 20, 25, 0);
const DOOR = { tx: 20, ty: 25, side: 'w' } as const;

const crowd = (n: number): SimZombieSpawn[] =>
  Array.from({ length: n }, (_, i) => ({ x: 13.5 - (i % 2), y: 25.5 + ((i >> 1) % 4) - 1.5 }));

const opts = (n: number, seed = 3) => ({
  seed,
  map: buildMap(room),
  spawn: { x: 20.6, y: 25.5 },
  dev: true,
  content: fixtureContent(),
  clockStart: NOON,
  spawnZombies: crowd(n),
});

interface Run {
  held: Extract<SimEvent, { type: 'doorHeld' }>[];
  broken: number;
  endurance: number;
  hash: number;
}

function step(sim: Sim, i: number, r: Run): void {
  // The noise keeps the zombies coming at the door.
  if (i % 60 === 0)
    sim.enqueue({
      type: 'debugNoise',
      x: 25.5,
      y: 25.5,
      radiusTiles: 40,
      tick: sim.tick,
      playerId: 0,
      seq: 1000 + i,
    });
  sim.step();
  const ev = sim.drainEvents();
  r.held.push(...eventsOf(ev, 'doorHeld'));
  for (const e of eventsOf(ev, 'openingChanged'))
    if (e.state === 'broken' && r.broken < 0) r.broken = i;
}

function run(n: number, ticks: number, seed = 3): Run & { sim: Sim } {
  const sim = createSim(opts(n, seed));
  sim.step();
  expect(sim.holdDoor(DOOR)).toBeUndefined();
  const r: Run = { held: [], broken: -1, endurance: 0, hash: 0 };
  for (let i = 0; i < ticks; i++) step(sim, i, r);
  r.endurance = sim.world.survival!.vitals.endurance[sim.world.players.get(0)!] ?? 0;
  r.hash = sim.hash();
  return { ...r, sim };
}

describe('physics: holding a door', () => {
  it('canHoldDoor: reasons and the holder’s strength', () => {
    const sim = createSim({ ...opts(0), spawn: { x: 25.5, y: 25.5 } });
    sim.step();
    expect(sim.canHoldDoor(DOOR).reason).toBe('out-of-range');
    expect(sim.canHoldDoor({ tx: 21, ty: 25, side: 'w' }).reason).toBe('invalid-target');
    const near = createSim(opts(0));
    near.step();
    const c = near.canHoldDoor(KEY);
    expect(c.ok).toBe(true);
    // Same strength as pushing furniture (fixture character: strength skill 0 → 70 kg).
    expect(c.strengthKg).toBeCloseTo(near.canMoveFurniture(0, 'push').strengthKg || 70, 3);
    expect(c.units).toBeCloseTo(c.strengthKg * 0.038, 3);
    expect(near.releaseDoor()).toBe('invalid-state');
  });

  it('one player holds the door against 2 zombies (no damage from the crowd)', () => {
    const r = run(2, 400);
    expect(r.held.map((e) => e.state)).toEqual(['holding']);
    expect(r.sim.getAction()?.kind).toBe('holdDoor');
    expect(r.sim.world.physics.pressure.get(KEY) ?? 0).toBe(0);
  });

  it('8 zombies push through: the holder is knocked down, the hold ends, the door gives', () => {
    const r = run(8, 2400);
    const over = r.held.find((e) => e.state === 'overpowered');
    expect(over).toBeDefined();
    expect(over!.units).toBeGreaterThanOrEqual(0.5);
    expect(r.broken).toBeGreaterThan(0);
  });

  it('holding drains endurance with the pressure; exhausted ends the hold', () => {
    // Endurance regenerates at rest; holding against 2 zombies costs more than it regains.
    const idle = createSim(opts(2));
    const ri: Run = { held: [], broken: -1, endurance: 0, hash: 0 };
    for (let i = 0; i < 400; i++) step(idle, i, ri);
    const two = run(2, 400);
    expect(two.endurance).toBeLessThan(100);
    expect(two.endurance).toBeLessThan(
      idle.world.survival!.vitals.endurance[idle.world.players.get(0)!]!,
    );
    const sim = createSim(opts(1));
    sim.step();
    sim.world.survival!.vitals.endurance[sim.world.players.get(0)!] = 5.5;
    expect(sim.holdDoor(DOOR)).toBeUndefined();
    const r: Run = { held: [], broken: -1, endurance: 0, hash: 0 };
    for (let i = 0; i < 3000 && !r.held.some((e) => e.state === 'exhausted'); i++) step(sim, i, r);
    expect(r.held.map((e) => e.state)).toEqual(['holding', 'exhausted']);
    expect(sim.getAction()).toBeNull();
  });

  it('moving interrupts the hold; releaseDoor ends it', () => {
    const sim = createSim(opts(0));
    sim.step();
    expect(sim.holdDoor(DOOR)).toBeUndefined();
    sim.drainEvents();
    expect(sim.releaseDoor()).toBeUndefined();
    expect(eventsOf(sim.drainEvents(), 'doorHeld').map((e) => e.state)).toEqual(['released']);
    expect(sim.holdDoor(DOOR)).toBeUndefined();
    sim.enqueue({ type: 'move', dx: 1, dy: 0, tick: sim.tick, playerId: 0, seq: 1 } as never);
    for (let i = 0; i < 3; i++) sim.step();
    const states = eventsOf(sim.drainEvents(), 'doorHeld').map((e) => e.state);
    expect(states).toContain('interrupted');
  });

  it('is deterministic and survives save / load', () => {
    const a = run(8, 500, 7);
    const b = run(8, 500, 7);
    expect(b.hash).toBe(a.hash);
    expect(b.held).toEqual(a.held);
    const s = createSim(opts(2, 5));
    s.step();
    s.holdDoor(DOOR);
    const r: Run = { held: [], broken: -1, endurance: 0, hash: 0 };
    for (let i = 0; i < 200; i++) step(s, i, r);
    const l = createSim({ ...opts(2, 5), load: s.save() });
    expect(l.hash()).toBe(s.hash());
    expect(l.getAction()?.kind).toBe('holdDoor');
    const r2: Run = { held: [], broken: -1, endurance: 0, hash: 0 };
    for (let i = 200; i < 400; i++) {
      step(s, i, r);
      step(l, i, r2);
    }
    expect(l.hash()).toBe(s.hash());
  });
});
