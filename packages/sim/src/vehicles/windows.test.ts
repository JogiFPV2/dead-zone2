/* eslint-disable no-restricted-properties -- test geometry (cos / sin of the car heading), not sim state. */
import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { eventsOf } from '../test/ai-fixtures.js';
import { car, seatedSim, vehicleSim, type VehicleSimOptions } from '../test/vehicle-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG } from '../physics/constants.js';
import { DEFAULT_VEHICLE_CONFIG } from './config.js';

const cfg = DEFAULT_VEHICLE_CONFIG;
/** Car at (20, 64) heading +x: the driver (seat 0) sits on the left (−y); a walker by that door. */
const LEFT_ZOMBIE: VehicleSimOptions = { zombies: [{ x: 20.1, y: 62.4, type: 'fixture:walker' }] };
/** Unbreakable windows (`zombieWindowDmg` 0): blows never get through glass. */
const HARD_GLASS = {
  physicsConfig: {
    ...DEFAULT_PHYSICS_CONFIG,
    vehicle: { ...DEFAULT_VEHICLE_CONFIG, zombieWindowDmg: 0 },
  },
};
const one = (x: number, y: number): VehicleSimOptions => ({
  zombies: [{ x, y, type: 'fixture:walker' }],
});

function watch(
  opts: VehicleSimOptions,
  broken: ('windowLeft' | 'windowRight' | 'windowFront')[],
  ticks: number,
  each?: (
    sim: ReturnType<typeof seatedSim>['sim'],
    i: number,
    ctl: ReturnType<typeof seatedSim>['ctl'],
  ) => void,
) {
  const { sim, ctl } = seatedSim(opts);
  for (const p of broken) sim.setPartHp(car(sim).stableId, p, 0);
  const events: SimEvent[] = [...sim.drainEvents()];
  for (let i = 0; i < ticks; i++) {
    each?.(sim, i, ctl);
    sim.step();
    events.push(...sim.drainEvents());
  }
  const player = sim.getPlayer()!.stableId;
  const hits = eventsOf(events, 'hit').filter((e) => e.source === 'zombie' && e.target === player);
  return { sim, ctl, events, hits, player };
}

describe('vehicles: zombies at broken windows', () => {
  it('intact windows protect: the zombie bangs on the car, never hits the driver', () => {
    const r = watch({ ...LEFT_ZOMBIE, ...HARD_GLASS }, [], 400);
    expect(eventsOf(r.events, 'physics').some((e) => e.kind === 'attackStart')).toBe(true);
    expect(r.hits).toEqual([]);
    expect(eventsOf(r.events, 'vehicleExit')).toEqual([]);
    expect(car(r.sim).grab).toEqual([0, 0, 0, 0]);
  });

  it('a broken window on the far side does not expose the driver', () => {
    const r = watch({ ...LEFT_ZOMBIE, ...HARD_GLASS }, ['windowRight'], 400);
    expect(r.hits).toEqual([]);
    expect(eventsOf(r.events, 'vehicleExit')).toEqual([]);
  });

  it('through the broken driver window: normal zombie hits, then pulled out and knocked down', () => {
    const r = watch(LEFT_ZOMBIE, ['windowLeft'], 400);
    const exits = eventsOf(r.events, 'vehicleExit');
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ reason: 'pulled', seat: 0, entity: r.player });
    const pulled = exits[0]!.tick;
    const before = r.hits.filter((e) => e.tick < pulled);
    expect(before.length).toBeGreaterThan(0);
    // Walker damage 1..2 per hit: no car protection on that side.
    for (const h of before) {
      expect(h.damage).toBeGreaterThanOrEqual(1);
      expect(h.damage).toBeLessThanOrEqual(2);
    }
    // Contact first, the pull only after `pullTicks`.
    const firstHit = before[0]!.tick;
    expect(pulled - firstHit).toBeGreaterThanOrEqual(cfg.pullTicks - 20);
    const fell = eventsOf(r.events, 'physics').filter(
      (e) => e.kind === 'fellDown' && e.entity === r.player,
    );
    expect(fell.map((e) => e.tick)).toContain(pulled);
    expect(eventsOf(r.events, 'engineStop').map((e) => e.reason)).toEqual(['driver-left']);
    const c = car(r.sim);
    expect(c.occupants[0]).toBe(0);
    expect(c.engineOn).toBe(false);
    // Out on the left (door) side of the car.
    const p = r.sim.getPlayer()!;
    expect(p.y).toBeLessThan(63);
  });

  it('pull-out is deterministic: same tick and hash in two runs', () => {
    const a = watch(LEFT_ZOMBIE, ['windowLeft'], 300);
    const b = watch(LEFT_ZOMBIE, ['windowLeft'], 300);
    expect(eventsOf(b.events, 'vehicleExit')).toEqual(eventsOf(a.events, 'vehicleExit'));
    expect(b.sim.hash()).toBe(a.sim.hash());
  });

  it('zombies never get inside the car', () => {
    watch(LEFT_ZOMBIE, ['windowLeft', 'windowFront'], 400, (sim) => {
      const c = car(sim);
      for (const z of sim.getZombies()) {
        const dx = z.x - c.x;
        const dy = z.y - c.y;
        const l = dx * Math.cos(c.headingRad) + dy * Math.sin(c.headingRad);
        const s = -dx * Math.sin(c.headingRad) + dy * Math.cos(c.headingRad);
        expect(Math.abs(l) < 2.3 && Math.abs(s) < 0.9).toBe(false);
      }
    });
  });

  it('driving off faster than shakeOffSpeed shakes the zombie off (stagger), no pull', () => {
    let grabbed = 0;
    let zid = 0;
    const r = watch(LEFT_ZOMBIE, ['windowLeft'], 120, (sim, i, ctl) => {
      zid = sim.getZombies()[0]!.stableId;
      if (i === 40) grabbed = car(sim).grab[0]!;
      if (i >= 40) ctl.drive(1);
    });
    expect(grabbed).toBeGreaterThan(0);
    expect(eventsOf(r.events, 'vehicleExit')).toEqual([]);
    expect(car(r.sim).speed).toBeGreaterThan(cfg.shakeOffSpeed);
    expect(car(r.sim).grab).toEqual([0, 0, 0, 0]);
    const shaken = eventsOf(r.events, 'physics').filter(
      (e) => e.kind === 'staggered' && e.entity === zid,
    );
    expect(shaken.length).toBe(1);
    // No hits once the car is fast.
    const fastFrom = r.events.find(
      (e) => e.type === 'physics' && e.kind === 'staggered' && e.entity === zid,
    )!.tick;
    expect(r.hits.filter((h) => h.tick > fastFrom)).toEqual([]);
  });

  it('vehicleOpenings: broken windows with position, outward normal and seats', () => {
    const sim = vehicleSim();
    const id = car(sim).stableId;
    expect(sim.vehicleOpenings(id)).toEqual([]);
    expect(sim.vehicleOpenings(9999)).toBeUndefined();
    sim.setPartHp(id, 'windowLeft', 0);
    sim.setPartHp(id, 'windowFront', 0);
    const o = sim.vehicleOpenings(id)!;
    expect(o.map((x) => x.window)).toEqual(['front', 'left']);
    expect(o[0]).toMatchObject({ part: 'windowFront', nx: 1, ny: 0, seats: [0, 1] });
    expect(o[0]!.x).toBeCloseTo(22.3, 5);
    expect(o[0]!.y).toBeCloseTo(64, 5);
    expect(o[1]).toMatchObject({ part: 'windowLeft', nx: 0, ny: -1, seats: [0, 2] });
    expect(o[1]!.x).toBeCloseTo(20, 5);
    expect(o[1]!.y).toBeCloseTo(63.1, 5);
  });

  it('pullOutOfVehicle (mechanic for Symulacja): through the windscreen = in front of the car', () => {
    const { sim } = seatedSim();
    const id = car(sim).stableId;
    sim.drainEvents();
    expect(sim.pullOutOfVehicle(id, 1)).toBe(false); // empty seat
    expect(sim.pullOutOfVehicle(id, 0, 0)).toBe(true);
    const ev = sim.drainEvents();
    expect(eventsOf(ev, 'vehicleExit')[0]).toMatchObject({ reason: 'pulled', seat: 0 });
    const p = sim.getPlayer()!;
    expect(p.x).toBeGreaterThan(22.3);
    expect(Math.abs(p.y - 64)).toBeLessThan(0.01);
    expect(eventsOf(ev, 'physics').some((e) => e.kind === 'fellDown')).toBe(true);
    // Normal exit says so.
    const b = seatedSim();
    b.ctl.exit();
    b.sim.step();
    expect(eventsOf(b.sim.drainEvents(), 'vehicleExit')[0]!.reason).toBe('exit');
  });

  it('save / load during a grab keeps the hash and the pull tick', () => {
    const a = watch(LEFT_ZOMBIE, ['windowLeft'], 40);
    expect(car(a.sim).grab[0]!).toBeGreaterThan(0);
    const b = vehicleSim({ ...LEFT_ZOMBIE, load: a.sim.save(), spawnVehicles: [] });
    expect(b.hash()).toBe(a.sim.hash());
    expect(car(b).grab).toEqual(car(a.sim).grab);
    const ea: SimEvent[] = [];
    const eb: SimEvent[] = [];
    for (let i = 0; i < 300; i++) {
      a.sim.step();
      b.step();
      ea.push(...a.sim.drainEvents());
      eb.push(...b.drainEvents());
    }
    expect(eventsOf(eb, 'vehicleExit')).toEqual(eventsOf(ea, 'vehicleExit'));
    expect(eventsOf(ea, 'vehicleExit')).toHaveLength(1);
    expect(b.hash()).toBe(a.sim.hash());
  });

  it('zombie blows break the window on the side of the attack, then hit through it', () => {
    const r = watch(LEFT_ZOMBIE, [], 900);
    const broken = eventsOf(r.events, 'vehiclePartBroken');
    expect(broken.map((e) => e.part)).toEqual(['windowLeft']);
    const c = car(r.sim);
    // Only the left window (the zombie's side) took blows.
    expect(c.windows[0]).toBe(100);
    expect(c.windows[1]).toBe(100);
    expect(c.windows[3]).toBe(100);
    expect(c.windows[2]).toBe(0);
    const at = broken[0]!.tick;
    // At least 100 / zombieWindowDmg blows before it breaks, no hit before.
    const swings = eventsOf(r.events, 'physics').filter(
      (e) => e.kind === 'attackStart' && e.tick <= at,
    );
    expect(swings.length).toBeGreaterThanOrEqual(Math.ceil(100 / cfg.zombieWindowDmg));
    expect(r.hits.filter((h) => h.tick <= at)).toEqual([]);
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it('window hp drops by zombieWindowDmg per blow (setting physics.vehicle.zombieWindowDmg)', () => {
    const vehicle = { ...DEFAULT_VEHICLE_CONFIG, zombieWindowDmg: 25 };
    const r = watch(
      { ...LEFT_ZOMBIE, physicsConfig: { ...DEFAULT_PHYSICS_CONFIG, vehicle } },
      [],
      120,
    );
    const swings = eventsOf(r.events, 'physics').filter((e) => e.kind === 'attackStart').length;
    expect(swings).toBeGreaterThan(0);
    expect(car(r.sim).windows[2]).toBeCloseTo(Math.max(0, 100 - 25 * swings), 4);
  });

  it('a zombie at the rear hits the rear window, at the front the windscreen', () => {
    for (const [z, part, idx] of [
      [one(17.3, 64), 'windowRear', 1],
      [one(22.7, 64), 'windowFront', 0],
    ] as const) {
      const r = watch(z, [], 400);
      expect(car(r.sim).windows[idx]).toBeLessThan(100);
      expect(car(r.sim).windows[2]).toBe(100);
      expect(eventsOf(r.events, 'vehiclePartBroken').every((e) => e.part === part)).toBe(true);
    }
  });

  it('sedan: the broken windscreen reaches the front row, the rear window the back row', () => {
    const sim = vehicleSim();
    const id = car(sim).stableId;
    sim.setPartHp(id, 'windowFront', 0);
    sim.setPartHp(id, 'windowRear', 0);
    const o = sim.vehicleOpenings(id)!;
    expect(o.map((x) => x.window)).toEqual(['front', 'rear']);
    expect(o[0]!.seats).toEqual([0, 1]);
    expect(o[1]!.seats).toEqual([2, 3]);
    // The driver is pulled out through the windscreen by a zombie standing at the bonnet.
    const r = watch(one(22.7, 63.8), ['windowFront'], 600);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(eventsOf(r.events, 'vehicleExit')[0]).toMatchObject({ reason: 'pulled', seat: 0 });
    expect(r.sim.getPlayer()!.x).toBeGreaterThan(22.3);
  });

  it('a moving car (> shakeOffSpeed) takes no window damage from blows', () => {
    const r = watch(LEFT_ZOMBIE, [], 200, (_sim, i, ctl) => {
      if (i >= 30) ctl.drive(1);
    });
    const c = car(r.sim);
    expect(c.speed).toBeGreaterThan(cfg.shakeOffSpeed);
    const hpAtSpeed = c.windows[2]!;
    const more = watch(LEFT_ZOMBIE, [], 400, (_sim, i, ctl) => {
      if (i >= 30) ctl.drive(1);
    });
    expect(car(more.sim).windows[2]).toBe(hpAtSpeed);
  });

  it('window blows are deterministic and survive save / load', () => {
    const a = watch(LEFT_ZOMBIE, [], 200);
    expect(car(a.sim).windows[2]).toBeLessThan(100);
    const b = vehicleSim({ ...LEFT_ZOMBIE, load: a.sim.save(), spawnVehicles: [] });
    expect(b.hash()).toBe(a.sim.hash());
    for (let i = 0; i < 300; i++) {
      a.sim.step();
      b.step();
    }
    expect(car(b).windows).toEqual(car(a.sim).windows);
    expect(b.hash()).toBe(a.sim.hash());
  });
});
