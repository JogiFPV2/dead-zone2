/* eslint-disable no-restricted-properties -- Math.cos/sin only to check where the zombie ended up relative to the car. */
import type { SimEdgeKind, SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import type { MapSpec } from '../test/fixtures.js';
import { car, seatedSim, type VehicleSimOptions } from '../test/vehicle-fixtures.js';

/** Column x = 60: a wall (edge 1) or a low fence (edge 2) for every y. */
const column = (kind: 'wall' | 'fence' | 'partition'): MapSpec => ({
  wallW: (x) => x === 60,
  edgeId: () => (kind === 'fence' ? 2 : kind === 'partition' ? 3 : 1),
  edgeKinds: [null, 'wall', 'fence', 'partition'] as (SimEdgeKind | null)[],
});

/** Drives at full throttle to `speed`, then coasts for `ticks`; returns all events. */
function ram(opts: VehicleSimOptions, speed: number, ticks = 160) {
  const { sim, ctl } = seatedSim(opts);
  ctl.drive(1);
  for (let i = 0; i < 400 && car(sim).speed < speed; i++) sim.step();
  ctl.drive(0);
  const events: SimEvent[] = [...sim.drainEvents()];
  let maxSpeed = 0;
  for (let i = 0; i < ticks; i++) {
    sim.step();
    maxSpeed = Math.max(maxSpeed, car(sim).speed);
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}

describe('vehicles: collisions', () => {
  it('stops at a wall without passing it and reports the impact on the front', () => {
    const { sim, events } = ram({ map: column('wall') }, 10);
    const c = car(sim);
    expect(c.x + 2.3).toBeLessThanOrEqual(60.001);
    expect(Math.abs(c.speed)).toBeLessThan(2);
    const hits = eventsOf(events, 'vehicleImpact');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.targetKind).toBe('wall');
    expect(hits[0]!.energy).toBeGreaterThan(20_000);
    expect(hits[0]!.nx).toBeLessThan(-0.9);
    expect(hits[0]!.x).toBeCloseTo(60, 1);
  });

  it('a slow car stops at a fence; a fast one knocks it over and drives on', () => {
    const slow = ram({ map: column('fence') }, 2, 300);
    expect(car(slow.sim).x + 2.3).toBeLessThanOrEqual(60.001);
    expect(eventsOf(slow.events, 'openingChanged')).toEqual([]);

    const fast = ram({ map: column('fence') }, 8, 100);
    const broken = eventsOf(fast.events, 'openingChanged');
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((e) => e.by === 'vehicle' && e.kind === 'fence')).toBe(true);
    expect(car(fast.sim).x).toBeGreaterThan(62);
    expect(eventsOf(fast.events, 'vehicleImpact').map((e) => e.targetKind)).toContain('fence');
  });

  it('a thin partition wall stops a slow car; a fast one breaks through (brick never)', () => {
    const slow = ram({ map: column('partition') }, 3.5, 300);
    expect(car(slow.sim).x + 2.3).toBeLessThanOrEqual(60.001);
    expect(eventsOf(slow.events, 'openingChanged')).toEqual([]);

    const fast = ram({ map: column('partition') }, 10, 100);
    const broken = eventsOf(fast.events, 'openingChanged');
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((e) => e.by === 'vehicle' && e.kind === 'partition')).toBe(true);
    expect(car(fast.sim).x).toBeGreaterThan(62);
    expect(eventsOf(fast.events, 'vehicleImpact')[0]!.targetKind).toBe('wall');

    const brick = ram({ map: column('wall') }, 10, 100);
    expect(eventsOf(brick.events, 'openingChanged')).toEqual([]);
    expect(car(brick.sim).x + 2.3).toBeLessThanOrEqual(60.001);
  });

  it('at walking pace it shoves a zombie ahead (no tunnelling, no reaction)', () => {
    const { sim, events } = ram({ zombies: [{ x: 25, y: 64, type: 'fixture:dummy' }] }, 1.2, 80);
    const z = sim.getZombies()[0]!;
    const c = car(sim);
    // The zombie ended up in front of the car, never inside or behind it.
    const ahead = (z.x - c.x) * Math.cos(c.headingRad) + (z.y - c.y) * Math.sin(c.headingRad);
    expect(ahead).toBeGreaterThan(2.3);
    expect(z.x).toBeGreaterThan(25.05);
    // A soft shove (below `minImpactJ`) sends no vehicleImpact and no physics reaction.
    expect(eventsOf(events, 'vehicleImpact')).toEqual([]);
    expect(eventsOf(events, 'physics').filter((e) => e.entity === z.stableId)).toEqual([]);
  });

  it('two cars collide and push each other (momentum is shared)', () => {
    const { sim, events } = ram(
      {
        spawnVehicles: [
          { x: 20, y: 64 },
          { x: 45, y: 64 },
        ],
      },
      8,
      60,
    );
    const [a, b] = sim.getVehicles();
    expect(b!.x - a!.x).toBeGreaterThanOrEqual(4.6 - 0.01);
    expect(b!.x).toBeGreaterThan(45.2);
    expect(eventsOf(events, 'vehicleImpact').some((e) => e.targetKind === 'vehicle')).toBe(true);
  });
});
