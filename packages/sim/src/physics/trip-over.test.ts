import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { survivalSim } from '../test/content-fixtures.js';
import { commander } from '../test/level-fixtures.js';
import { createItem, groundPile } from '../items/store.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { tripOverChance, underfoot } from './trip-over.js';
import type { PhysicsBody } from './types.js';

const withTrip = (o: Partial<PhysicsConfig['tripOver']>): PhysicsConfig => ({
  ...DEFAULT_PHYSICS_CONFIG,
  tripOver: { ...DEFAULT_PHYSICS_CONFIG.tripOver, ...o },
});

const pbody = (sim: Sim) =>
  [...sim.world.physics.bodies.values()].find((b) => b.kind === 'player')!;

/** A row of ground piles (one item each) on tiles x 12..20, y 10. */
function litter(sim: Sim): void {
  const st = sim.world.items!;
  for (let x = 12; x <= 20; x++) createItem(st, 0, groundPile(st, x, 10, 0).id, 1, 0);
}

function dash(gait: 'walk' | 'run', perSec: number): string[] {
  const sim = survivalSim(undefined, { physicsConfig: withTrip({ itemPerSec: perSec }) });
  litter(sim);
  commander(sim).move(1, 0, gait);
  const ev: SimEvent[] = [];
  for (let i = 0; i < 120; i++) {
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return eventsOf(ev, 'physics').map((e) => e.kind);
}

describe('tripping over things on the floor while running', () => {
  it('running over ground piles with a sure chance: tripped + fellDown', () => {
    expect(dash('run', 1000)).toEqual(expect.arrayContaining(['tripped', 'fellDown']));
  });

  it('walking over them never trips', () => {
    expect(dash('walk', 1000)).not.toContain('tripped');
  });

  it('underfoot: a lying body within reach, a ground pile on the tile, else nothing', () => {
    const sim = survivalSim();
    sim.step();
    const w = sim.world;
    const eid = w.players.get(0)!;
    const b = pbody(sim);
    const sids = new Map([[b.id, eid]]);
    expect(underfoot(w, eid, b, [b], sids)).toBeUndefined();
    const corpse = { ...b, id: 999, state: 'dead', x: b.x + 0.4, y: b.y } as PhysicsBody;
    const standing = { ...corpse, id: 998, state: 'idle' } as PhysicsBody;
    const both = new Map([...sids, [999, eid], [998, eid]]);
    expect(underfoot(w, eid, b, [b, standing], both)).toBeUndefined();
    expect(underfoot(w, eid, b, [b, corpse], both)).toBe('body');
    createItem(w.items!, 0, groundPile(w.items!, Math.floor(b.x), Math.floor(b.y), 0).id, 1, 0);
    expect(underfoot(w, eid, b, [b], sids)).toBe('item');
  });

  it('chance: 0 below a run; a body is worse than an item; sprint, load, fatigue raise it', () => {
    const sim = survivalSim();
    sim.step();
    const w = sim.world;
    const base = { ...pbody(sim), carriedKg: 0, capacityKg: 12, endurance: 100 };
    const run = tripOverChance(w, base, 2, 'item');
    expect(tripOverChance(w, base, 1, 'body')).toBe(0);
    expect(run).toBeGreaterThan(0);
    expect(tripOverChance(w, base, 2, 'body')).toBeGreaterThan(run);
    expect(tripOverChance(w, base, 3, 'item')).toBeGreaterThan(run);
    expect(tripOverChance(w, { ...base, carriedKg: 14 }, 2, 'item')).toBeGreaterThan(run);
    expect(tripOverChance(w, { ...base, endurance: 10 }, 2, 'item')).toBeGreaterThan(run);
  });
});
