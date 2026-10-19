import { buildContentBundle } from '@deadzone/content';
import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS_CONFIG } from '../physics/constants.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { DEFAULT_VEHICLE_CONFIG } from '../vehicles/config.js';
import { fixturePack } from '../test/content-fixtures.js';
import {
  car,
  DUMMY_ZOMBIE,
  SEDAN,
  seatedSim,
  type VehicleSimOptions,
} from '../test/vehicle-fixtures.js';

/** A short car: the driver seat is reachable through the windscreen and the left window. */
const BUGGY = {
  ...SEDAN,
  id: 'fixture:buggy',
  name: 'vehicle.fixture.buggy',
  length: 2.6,
  width: 1.4,
  wheelbase: 1.8,
  track: 1.2,
  seats: [
    { id: 'driver', doorSide: 'left', offset: { x: 0.35, y: -0.3 } },
    { id: 'passenger', doorSide: 'right', offset: { x: 0.35, y: 0.3 } },
  ],
};
const buggyContent = buildContentBundle([
  {
    ...fixturePack(),
    files: [
      ...fixturePack().files,
      { path: 'vehicle-types/sedan.json', json: SEDAN },
      { path: 'vehicle-types/buggy.json', json: BUGGY },
      { path: 'zombie-types/dummy.json', json: DUMMY_ZOMBIE },
    ],
  },
]);

/** Unbreakable windows (`zombieWindowDmg` 0): the old chase never breaks a window. */
const HARD_GLASS = {
  physicsConfig: {
    ...DEFAULT_PHYSICS_CONFIG,
    vehicle: { ...DEFAULT_VEHICLE_CONFIG, zombieWindowDmg: 0 },
  },
};

type Part = 'windowLeft' | 'windowRight' | 'windowFront' | 'windowRear';

/** Sedan at (20, 64) heading +x, player in the driver seat (left = −y); walkers around. */
function run(
  opts: VehicleSimOptions,
  broken: Part[],
  ticks: number,
  each?: (s: ReturnType<typeof seatedSim>, i: number) => void,
) {
  const s = seatedSim(opts);
  const { sim } = s;
  for (const p of broken) sim.setPartHp(car(sim).stableId, p, 0);
  const events: SimEvent[] = [...sim.drainEvents()];
  let goals = 0;
  const windows = new Map<number, Set<number>>();
  for (let i = 0; i < ticks; i++) {
    each?.(s, i);
    sim.step();
    events.push(...sim.drainEvents());
    const g = sim.world.ai!.windowGoals;
    goals += g.size;
    for (const [eid, goal] of g) {
      const sid = sim.world.c.StableId.value[eid]!;
      if (!windows.has(sid)) windows.set(sid, new Set());
      windows.get(sid)!.add(goal.window);
    }
  }
  return { ...s, events, goals, windows, player: sim.getPlayer()!.stableId };
}

const walker = (x: number, y: number) => ({ x, y, type: 'fixture:walker' });

describe('ai: vehicle window target', () => {
  it('walks around the car to the broken driver window and the driver gets pulled out', () => {
    // The zombie starts on the passenger side (+y): it has to go round the car.
    const r = run({ zombies: [walker(21, 70)] }, ['windowLeft'], 900);
    expect(r.goals).toBeGreaterThan(0);
    expect([...r.windows.values()].map((s) => [...s])).toEqual([[2]]);
    const exits = eventsOf(r.events, 'vehicleExit');
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ reason: 'pulled', seat: 0, entity: r.player });
    const hits = eventsOf(r.events, 'hit').filter((e) => e.source === 'zombie');
    expect(hits.filter((h) => h.tick < exits[0]!.tick).length).toBeGreaterThan(0);
    // After the pull-out: back to the normal chase of the player (no window target).
    const after = r.sim.world.ai!.windowGoals;
    expect(after.size).toBe(0);
    const z = r.sim.getZombies()[0]!;
    expect(z.state).toBe('chase');
    expect(z.targetId).toBe(r.player);
  });

  it('two zombies spread over two reachable openings (windscreen and left window)', () => {
    // Most zombies standing at their openings at the same tick, and at which windows.
    let together: number[] = [];
    const r = run(
      {
        car: { x: 20, y: 64, type: 'fixture:buggy' },
        content: buggyContent,
        zombies: [walker(24, 61), walker(25, 62)],
      },
      ['windowLeft', 'windowFront'],
      300,
      (s) => {
        const w = s.sim.world;
        const at: number[] = [];
        for (const [eid, g] of w.ai!.windowGoals) {
          const dx = (w.c.Position.x[eid] ?? 0) - g.sx;
          const dy = (w.c.Position.y[eid] ?? 0) - g.sy;
          if (dx * dx + dy * dy <= 0.15 * 0.15) at.push(g.window);
        }
        if (at.length > together.length) together = at.sort();
      },
    );
    const used = [...r.windows.values()].map((s) => [...s]);
    expect(used).toHaveLength(2);
    // Each zombie keeps one opening, and they are different ones.
    for (const u of used) expect(u).toHaveLength(1);
    expect(new Set(used.map((u) => u[0]))).toEqual(new Set([0, 2]));
    // Both stood at their openings at once.
    expect(together).toEqual([0, 2]);
    expect(eventsOf(r.events, 'hit').some((e) => e.source === 'zombie')).toBe(true);
    expect(eventsOf(r.events, 'vehicleExit')[0]).toMatchObject({ reason: 'pulled', seat: 0 });
  });

  it('no broken window (or only one that does not reach the seat): the old chase, bangs on the car', () => {
    for (const broken of [[], ['windowRight']] as Part[][]) {
      const r = run({ zombies: [walker(21, 58)], ...HARD_GLASS }, broken, 400);
      expect(r.goals).toBe(0);
      expect(eventsOf(r.events, 'physics').some((e) => e.kind === 'attackStart')).toBe(true);
      expect(eventsOf(r.events, 'hit').filter((e) => e.source === 'zombie')).toEqual([]);
      expect(eventsOf(r.events, 'vehicleExit')).toEqual([]);
    }
  });

  it('the car drives off faster than shakeOffSpeed: no window target, a normal chase', () => {
    let fastGoals = -1;
    const r = run({ zombies: [walker(21, 58)] }, ['windowLeft'], 220, (s, i) => {
      if (i >= 20) s.ctl.drive(1);
      if (i === 219) fastGoals = s.sim.world.ai!.windowGoals.size;
    });
    expect(car(r.sim).speed).toBeGreaterThan(r.sim.world.physics.cfg.vehicle.shakeOffSpeed);
    expect(fastGoals).toBe(0);
    expect(eventsOf(r.events, 'vehicleExit')).toEqual([]);
  });

  it('deterministic: same pull tick and hash in two runs', () => {
    const a = run({ zombies: [walker(21, 70), walker(18, 59)] }, ['windowLeft'], 600);
    const b = run({ zombies: [walker(21, 70), walker(18, 59)] }, ['windowLeft'], 600);
    expect(eventsOf(b.events, 'vehicleExit')).toEqual(eventsOf(a.events, 'vehicleExit'));
    expect(b.sim.hash()).toBe(a.sim.hash());
  });
});
