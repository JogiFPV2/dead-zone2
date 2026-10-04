import type { SimEvent, SimEdgeKind } from '@deadzone/protocol';
import { VEHICLE_PARTS, decodeVehicleSnapshot } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import type { MapSpec } from '../test/fixtures.js';
import {
  car,
  controls,
  seatedSim,
  vehicleSim,
  type VehicleSimOptions,
} from '../test/vehicle-fixtures.js';
import { DEFAULT_VEHICLE_CONFIG } from './config.js';
import { driveMods, impactDamage } from './damage.js';
import type { Vehicle } from './types.js';

const cfg = DEFAULT_VEHICLE_CONFIG;
const wallAt = (x0: number): MapSpec => ({
  wallW: (x) => x === x0,
  edgeKinds: [null, 'wall'] as (SimEdgeKind | null)[],
});

/** Cruise at `speed` m/s (± = forward / reverse), steer `steer`, collecting events. */
function cruise(opts: VehicleSimOptions, speed: number, ticks: number, steer = 0) {
  const { sim, ctl } = seatedSim(opts);
  const events: SimEvent[] = [...sim.drainEvents()];
  for (let i = 0; i < ticks; i++) {
    const sp = car(sim).speed;
    if (speed >= 0) ctl.drive(Math.max(0, Math.min(1, (speed - sp) * 2)), 0, steer);
    else ctl.drive(0, Math.max(0, Math.min(1, (sp - speed) * 2)), steer);
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, ctl, events };
}

const loss = (zones: number[]) => zones.map((z) => 100 - z);

describe('vehicles: damage', () => {
  it('calibration: 6 m/s into a wall ≈ 20 hp, a zombie at 8 m/s ≈ 2 hp', () => {
    const wall = 0.5 * 1200 * 36 * (1 - cfg.restitution ** 2);
    expect(impactDamage(wall, cfg)).toBeGreaterThan(15);
    expect(impactDamage(wall, cfg)).toBeLessThan(25);
    const mu = (1200 * 75) / 1275;
    expect(impactDamage(0.5 * mu * 64 * 0.96, cfg)).toBeLessThan(3);
    expect(impactDamage(cfg.damageMinJ, cfg)).toBe(0);
  });

  it('a frontal wall hit damages the front zone, windscreen and engine only', () => {
    const { sim } = cruise({ map: wallAt(40) }, 8, 120);
    const c = car(sim);
    const [front, rear, left, right] = loss(c.zones) as [number, number, number, number];
    expect(front).toBeGreaterThan(20);
    expect(rear).toBe(0);
    expect(left).toBe(0);
    expect(right).toBe(0);
    expect(c.windows[0]!).toBeLessThan(c.zones[0]!);
    expect(c.windows.slice(1)).toEqual([100, 100, 100]);
    expect(c.engine).toBeLessThan(100);
    expect(c.engine).toBeGreaterThan(c.zones[0]!);
  });

  it('reversing into a wall damages the rear (engine untouched)', () => {
    const { sim } = cruise({ map: wallAt(12) }, -5, 160);
    const c = car(sim);
    const [front, rear, left, right] = loss(c.zones) as [number, number, number, number];
    expect(rear).toBeGreaterThan(5);
    expect(front + left + right).toBe(0);
    expect(c.engine).toBe(100);
    expect(c.windows[1]!).toBeLessThan(100);
  });

  it('a T-bone hits the side of the parked car: right or left by its heading', () => {
    for (const [heading, side] of [
      [Math.PI / 2, 3],
      [-Math.PI / 2, 2],
    ] as const) {
      const { sim } = cruise(
        {
          spawnVehicles: [
            { x: 20, y: 64 },
            { x: 40, y: 64, heading },
          ],
        },
        8,
        90,
      );
      const [a, b] = sim.getVehicles();
      expect(loss(a!.zones)[0]!).toBeGreaterThan(3);
      const lb = loss(b!.zones);
      expect(lb[side]!).toBeGreaterThan(3);
      expect(lb.filter((_, i) => i !== side).every((x) => x === 0)).toBe(true);
      expect(b!.windows[side]!).toBeLessThan(100);
      expect(b!.engine).toBe(100);
    }
  });

  it('a damaged engine gives less power; a dead one stops (`broken`) and does not restart', () => {
    const top = (engine: number) => {
      const { sim, ctl } = seatedSim();
      sim.setPartHp(car(sim).stableId, 'engine', engine);
      for (let i = 0; i < 60; i++) {
        ctl.drive(1);
        sim.step();
      }
      return car(sim).speed;
    };
    const full = top(100);
    expect(top(60)).toBeCloseTo(full, 3);
    expect(top(20)).toBeLessThan(full * 0.75);
    expect(top(20)).toBeGreaterThan(top(5));

    const { sim, ctl } = seatedSim();
    const id = car(sim).stableId;
    sim.drainEvents();
    expect(sim.setPartHp(id, 'engine', 0)).toBe(true);
    const ev = sim.drainEvents();
    expect(eventsOf(ev, 'engineStop').map((e) => e.reason)).toEqual(['broken']);
    expect(car(sim).engineOn).toBe(false);
    ctl.exit();
    sim.step();
    ctl.enter(id);
    for (let i = 0; i < 5; i++) sim.step();
    expect(eventsOf(sim.drainEvents(), 'engineStart')).toEqual([]);
    expect(car(sim).engineOn).toBe(false);
    // Repair with the driver seated: it starts again.
    expect(sim.setPartHp(id, 'engine', 80)).toBe(true);
    expect(eventsOf(sim.drainEvents(), 'engineStart').length).toBe(1);
    expect(car(sim).engineOn).toBe(true);
  });

  it('wall hits kill the engine: vehiclePartBroken engine + engineStop broken', () => {
    const { sim, ctl } = seatedSim({ map: wallAt(40) });
    const events: SimEvent[] = [];
    for (let run = 0; run < 12 && car(sim).engine > 0; run++) {
      // Back off to x = 22, then floor it into the wall.
      for (let i = 0; i < 400 && car(sim).x > 22; i++) {
        ctl.drive(0, 1);
        sim.step();
      }
      for (let i = 0; i < 200 && car(sim).x < 37.6; i++) {
        ctl.drive(1);
        sim.step();
      }
      for (let i = 0; i < 10; i++) {
        ctl.drive(0);
        sim.step();
      }
      events.push(...sim.drainEvents());
    }
    expect(car(sim).engine).toBe(0);
    expect(car(sim).engineOn).toBe(false);
    expect(eventsOf(events, 'vehiclePartBroken').map((e) => e.part)).toContain('engine');
    expect(eventsOf(events, 'vehiclePartBroken').map((e) => e.part)).toContain('windowFront');
    expect(eventsOf(events, 'engineStop').map((e) => e.reason)).toEqual(['broken']);
    // A broken engine: throttle does nothing.
    for (let i = 0; i < 60; i++) {
      ctl.drive(0, 1);
      sim.step();
    }
    for (let i = 0; i < 60; i++) {
      ctl.drive(1);
      sim.step();
    }
    expect(Math.abs(car(sim).speed)).toBeLessThan(0.05);
  });

  it('a flat tyre pulls to its side and lowers grip; healthy drives straight', () => {
    const run = (part?: 'tireFR' | 'tireFL' | 'tireRR') => {
      const { sim, ctl } = seatedSim();
      if (part) sim.setPartHp(car(sim).stableId, part, 0);
      for (let i = 0; i < 100; i++) {
        ctl.drive(Math.max(0, Math.min(1, (8 - car(sim).speed) * 2)));
        sim.step();
      }
      return car(sim);
    };
    const ok = run();
    expect(ok.y).toBeCloseTo(64, 3);
    // Heading +x: right = +y.
    expect(run('tireFR').y).toBeGreaterThan(64.5);
    expect(run('tireFL').y).toBeLessThan(63.5);
    const rr = run('tireRR').y - 64;
    expect(rr).toBeGreaterThan(0);
    expect(rr).toBeLessThan(run('tireFR').y - 64);
    const v = { engine: 100, tires: [0, 100, 100, 100] } as unknown as Vehicle;
    const m = driveMods(v, cfg);
    expect(m.pull).toBeCloseTo(-cfg.tirePull, 6);
    expect(m.gripMul).toBeCloseTo(1 - cfg.flatGripLoss / 4, 6);
    expect(driveMods({ engine: 100, tires: [50, 50, 50, 50] } as unknown as Vehicle, cfg)).toEqual({
      powerMul: 1,
      pull: 0,
      gripMul: 1,
    });
  });

  it('ramming 10 zombies wears down the front (and the windscreen), not the rear zone', () => {
    const zombies = Array.from({ length: 10 }, (_, i) => ({
      x: 40 + i * 8,
      y: 64,
      type: 'fixture:dummy',
    }));
    const { sim, events } = cruise({ zombies }, 11, 300);
    expect(car(sim).x).toBeGreaterThan(120);
    const hits = eventsOf(events, 'vehicleImpact').filter((e) => e.targetKind === 'zombie');
    expect(new Set(hits.map((e) => e.target)).size).toBe(10);
    const c = car(sim);
    const [front, rear, left, right] = loss(c.zones) as [number, number, number, number];
    expect(front).toBeGreaterThan(8);
    expect(front).toBeLessThan(50);
    expect(rear).toBeLessThan(front / 2);
    expect(left + right).toBe(0);
    expect(c.windows[0]!).toBeLessThan(c.zones[0]!);
    // Running over the bodies scuffed the tyres a bit.
    expect(Math.min(...c.tires)).toBeLessThan(100);
    expect(Math.min(...c.tires)).toBeGreaterThan(50);
  });

  it('setPartHp / getPartHp: every part, clamped, unknown parts / cars rejected', () => {
    const { sim } = seatedSim();
    const id = car(sim).stableId;
    for (const p of VEHICLE_PARTS) {
      expect(sim.getPartHp(id, p)).toBe(100);
      expect(sim.setPartHp(id, p, 42.5)).toBe(true);
      expect(sim.getPartHp(id, p)).toBe(42.5);
    }
    expect(sim.setPartHp(id, 'bodyLeft', 250)).toBe(true);
    expect(sim.getPartHp(id, 'bodyLeft')).toBe(100);
    expect(sim.setPartHp(id, 'tireRL', -3)).toBe(true);
    expect(sim.getPartHp(id, 'tireRL')).toBe(0);
    expect(sim.setPartHp(id, 'nope' as never, 1)).toBe(false);
    expect(sim.getPartHp(id, 'nope' as never)).toBeUndefined();
    expect(sim.setPartHp(9999, 'engine', 1)).toBe(false);
    expect(sim.getPartHp(9999, 'engine')).toBeUndefined();
    const c = car(sim);
    expect(c.tires).toEqual([42.5, 42.5, 0, 42.5]);
    expect(c.windows).toEqual([42.5, 42.5, 42.5, 42.5]);
  });

  it('snapshot: damage / tires / engine / broken windows reach the client', () => {
    const { sim } = seatedSim();
    const id = car(sim).stableId;
    sim.setPartHp(id, 'bodyFront', 50);
    sim.setPartHp(id, 'tireRR', 0);
    sim.setPartHp(id, 'engine', 25);
    sim.setPartHp(id, 'windowLeft', 0);
    const [s] = decodeVehicleSnapshot(sim.vehicleSnapshot());
    expect(s!.damage.front).toBeCloseTo(0.5, 2);
    expect(s!.tires).toEqual([1, 1, 1, 0]);
    expect(s!.engine).toBeCloseTo(0.25, 2);
    expect(s!.windowsBroken).toBe(0b0100);
  });

  it('deterministic: same crashes → same hash and parts; save / load keeps the parts', () => {
    const go = () =>
      cruise({ map: wallAt(40), zombies: [{ x: 30, y: 64, type: 'fixture:dummy' }] }, 9, 90);
    const a = go();
    const b = go();
    expect(a.sim.hash()).toBe(b.sim.hash());
    expect(car(a.sim)).toEqual(car(b.sim));
    expect(car(a.sim).zones[0]!).toBeLessThan(100);

    const bytes = a.sim.save();
    const loaded = vehicleSim({ map: wallAt(40), load: bytes, spawnVehicles: [] });
    expect(car(loaded)).toEqual(car(a.sim));
    expect(loaded.hash()).toBe(a.sim.hash());
    // Both continue identically (reversing out of the wall).
    const ca = controls(a.sim, 0, a.ctl.seq);
    const cb = controls(loaded, 0, a.ctl.seq);
    for (let i = 0; i < 40; i++) {
      ca.drive(0, 1);
      cb.drive(0, 1);
      a.sim.step();
      loaded.step();
    }
    expect(loaded.hash()).toBe(a.sim.hash());
  });
});
