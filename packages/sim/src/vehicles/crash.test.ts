import type { SimEdgeKind, SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import type { MapSpec } from '../test/fixtures.js';
import { car, seatedSim, type VehicleSimOptions } from '../test/vehicle-fixtures.js';
import { DEFAULT_VEHICLE_CONFIG } from './config.js';
import { crashWounds } from './crash.js';

const wall: MapSpec = {
  wallW: (x) => x === 200,
  edgeId: () => 1,
  edgeKinds: [null, 'wall'] as (SimEdgeKind | null)[],
};

/** Full throttle to `speed`, then cruise into the wall at x = 200; all events after the run-up. */
function crash(speed: number, opts: VehicleSimOptions = {}) {
  const { sim, ctl } = seatedSim({ map: wall, ...opts });
  ctl.drive(1);
  for (let i = 0; i < 600 && car(sim).speed < speed; i++) sim.step();
  sim.drainEvents();
  const events: SimEvent[] = [];
  for (let i = 0; i < 2400 && !events.some((e) => e.type === 'vehicleImpact'); i++) {
    ctl.drive(car(sim).speed < speed ? 1 : 0);
    sim.step();
    events.push(...sim.drainEvents());
  }
  ctl.drive(0);
  for (let i = 0; i < 60; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, events, hit: eventsOf(events, 'vehicleImpact')[0] };
}

describe('vehicles: crash injuries (no seatbelts)', () => {
  it('wound kinds by impact speed, capped', () => {
    const c = DEFAULT_VEHICLE_CONFIG;
    expect(crashWounds(3, c)).toEqual([]);
    expect(crashWounds(7, c)).toEqual([0]);
    expect(crashWounds(12, c)).toEqual([1]);
    expect(crashWounds(25, c)).toEqual([3, 1]);
    expect(crashWounds(25, { ...c, crashMaxWounds: 1 })).toEqual([3]);
  });

  it('a slow bump hurts nobody; a fast wall crash wounds the driver once', () => {
    const slow = crash(3);
    expect(slow.hit?.targetKind).toBe('wall');
    expect(eventsOf(slow.events, 'wounded')).toEqual([]);
    const fast = crash(13);
    expect(fast.hit!.speed).toBeGreaterThanOrEqual(DEFAULT_VEHICLE_CONFIG.crashLacerationSpeed);
    const wounds = eventsOf(fast.events, 'wounded');
    expect(wounds.length).toBeGreaterThanOrEqual(1);
    expect(wounds.length).toBeLessThanOrEqual(DEFAULT_VEHICLE_CONFIG.crashMaxWounds);
    expect(wounds.every((e) => e.playerId === 0)).toBe(true);
  });

  it('ramming zombies does not wound the occupants', () => {
    const zombies = [{ x: 150, y: 64, type: 'fixture:dummy' }];
    const { events } = crash(13, { map: {}, zombies });
    expect(eventsOf(events, 'vehicleImpact').some((e) => e.targetKind === 'zombie')).toBe(true);
    expect(eventsOf(events, 'wounded')).toEqual([]);
  });

  it('is deterministic', () => {
    const a = crash(13);
    const b = crash(13);
    expect(b.sim.hash()).toBe(a.sim.hash());
    expect(eventsOf(b.events, 'wounded')).toEqual(eventsOf(a.events, 'wounded'));
  });
});
