import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import { fixturePack } from '../test/content-fixtures.js';
import { car, DUMMY_ZOMBIE, SEDAN, seatedSim } from '../test/vehicle-fixtures.js';

/** Pieces 1×2 across the car's lane (y 63–64): crate 30 kg, wardrobe 200 kg, fridge 50 kg fixed. */
let cached: ContentBundle | undefined;
const content = (): ContentBundle => {
  const pack = fixturePack({
    vehicles: { enterSec: 0, exitSec: 0 },
    furnitureFootprint: true,
    furnitureFixed: ['fixture:vf-fridge'],
  });
  const piece = (id: string, weightKg: number) => ({
    id,
    name: `item.${id.replace(':', '.')}`,
    kind: 'placeable',
    weightKg,
    placeable: { footprint: { w: 1, h: 2 } },
  });
  return (cached ??= buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files,
        { path: 'vehicle-types/sedan.json', json: SEDAN },
        { path: 'zombie-types/dummy.json', json: DUMMY_ZOMBIE },
        {
          path: 'items/vf.json',
          json: [
            piece('fixture:vf-crate', 30),
            piece('fixture:vf-wardrobe', 200),
            piece('fixture:vf-fridge', 50),
          ],
        },
      ],
    },
  ]));
};

/** Full throttle to `speed`, then cruise at it into the piece at x = 60; events after the run-up. */
function ram(contentId: string, speed: number) {
  const { sim, ctl } = seatedSim({
    content: content(),
    map: { objects: [{ contentId, x: 60, y: 63 }] },
  });
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
  for (let i = 0; i < 100; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}

const front = (sim: ReturnType<typeof ram>['sim']) => car(sim).x + SEDAN.length / 2;

describe('vehicles: furniture collisions (protocol 44)', () => {
  it('a slow car stops at a light piece without moving it', () => {
    const { sim, events } = ram('fixture:vf-crate', 2);
    expect(front(sim)).toBeLessThanOrEqual(60.05);
    expect(eventsOf(events, 'furnitureMoved')).toEqual([]);
    expect(eventsOf(events, 'vehicleImpact')[0]!.targetKind).toBe('furniture');
  });

  it('a fast car knocks a light piece aside and drives on, slower, body damaged', () => {
    const { sim, events } = ram('fixture:vf-crate', 9);
    const moved = eventsOf(events, 'furnitureMoved');
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((e) => e.cause === 'vehicle' && e.contentId === 'fixture:vf-crate')).toBe(
      true,
    );
    expect(front(sim)).toBeGreaterThan(61);
    const hit = eventsOf(events, 'vehicleImpact')[0]!;
    expect(hit.targetKind).toBe('furniture');
    expect(car(sim).zones[0]!).toBeLessThan(100);
  });

  it('a heavy wardrobe and a fixed fridge stop a fast car; the driver gets hurt', () => {
    for (const id of ['fixture:vf-wardrobe', 'fixture:vf-fridge']) {
      const { sim, events } = ram(id, 13);
      expect(front(sim)).toBeLessThanOrEqual(60.05);
      expect(eventsOf(events, 'furnitureMoved')).toEqual([]);
      expect(eventsOf(events, 'vehicleImpact')[0]!.targetKind).toBe('furniture');
      expect(eventsOf(events, 'wounded').length).toBeGreaterThan(0);
      expect(car(sim).zones[0]!).toBeLessThan(100);
    }
  });

  it('is deterministic', () => {
    const a = ram('fixture:vf-crate', 9);
    const b = ram('fixture:vf-crate', 9);
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(a.events).toEqual(b.events);
  });
});
