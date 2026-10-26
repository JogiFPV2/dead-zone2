import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import { car, seatedSim, type VehicleSimOptions } from '../test/vehicle-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG } from '../physics/constants.js';
import { DEFAULT_VEHICLE_CONFIG } from './config.js';

/** Unbreakable glass (blows never reach the driver) and a given body damage per blow. */
const opts = (zombieBodyDmg: number, x: number, y: number, n = 1): VehicleSimOptions => ({
  zombies: Array.from({ length: n }, (_, i) => ({ x: x + i * 0.4, y, type: 'fixture:walker' })),
  physicsConfig: {
    ...DEFAULT_PHYSICS_CONFIG,
    vehicle: { ...DEFAULT_VEHICLE_CONFIG, zombieWindowDmg: 0, zombieBodyDmg },
  },
});

function run(o: VehicleSimOptions, ticks: number) {
  const { sim } = seatedSim(o);
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  const swings = eventsOf(events, 'physics').filter((e) => e.kind === 'attackStart').length;
  return { sim, events, swings };
}

describe('vehicles: zombie blows dent the body (physics.vehicle.zombieBodyDmg)', () => {
  it('each blow takes zombieBodyDmg off the zone on the zombie side; 0 = off', () => {
    const r = run(opts(2, 20.1, 62.4), 300);
    expect(r.swings).toBeGreaterThan(0);
    expect(car(r.sim).zones[2]).toBeCloseTo(Math.max(0, 100 - 2 * r.swings), 4);
    expect(car(r.sim).zones[3]).toBe(100);
    const off = run(opts(0, 20.1, 62.4), 300);
    expect(car(off.sim).zones).toEqual([100, 100, 100, 100]);
  });

  it('a crowd wrecks the side zone (vehiclePartBroken); tyres and engine stay intact', () => {
    const r = run(opts(10, 19.2, 62.4, 4), 1200);
    const c = car(r.sim);
    expect(c.zones[2]).toBe(0);
    expect(eventsOf(r.events, 'vehiclePartBroken').some((e) => e.part === 'bodyLeft')).toBe(true);
    expect(c.tires).toEqual([100, 100, 100, 100]);
    expect(c.engine).toBe(100);
  });

  it('a wrecked front exposes the engine: blows there stall it at 0', () => {
    const { sim } = seatedSim(opts(25, 22.7, 64));
    sim.setPartHp(car(sim).stableId, 'bodyFront', 0);
    const events: SimEvent[] = [];
    for (let i = 0; i < 1200 && car(sim).engine > 0; i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(car(sim).engine).toBe(0);
    expect(eventsOf(events, 'vehiclePartBroken').some((e) => e.part === 'engine')).toBe(true);
  });

  it('is deterministic', () => {
    const a = run(opts(5, 19.2, 62.4, 3), 400);
    const b = run(opts(5, 19.2, 62.4, 3), 400);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(car(a.sim).zones).toEqual(car(b.sim).zones);
  });
});
