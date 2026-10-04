import type { ContentBundle } from '@deadzone/content';
import type { SimEvent, SimVehicleSpawn, SimViewPatch } from '@deadzone/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { nearbyView } from '../items/views.js';
import { pumpReserve } from './fuel.js';

/**
 * Vehicle API for the UI (protocol 19): real `searched` of trunk / glovebox, `drive` stops
 * timed actions, `commandRejected.missing`, `ActionView.fuel`, `pumps` view, `seats`,
 * `battery` / `fuelTank` parts, `debugDamageVehicle`, `refuelVehicle {pump}`.
 */

/** Car at (20, 20) heading +x; pump on tile (20, 22), 1.6 m from the car's left side. */
const CAR = { x: 20, y: 20 };
const DRIVER_DOOR = { x: CAR.x + 0.1, y: CAR.y - 1.3 };
const BEHIND = { x: CAR.x - 2.6, y: CAR.y };
const PUMP = { x: 20, y: 22 };
const AT_PUMP = { x: 20.5, y: 21.6 };
const FAR_PUMP = { x: 20, y: 28 };

let content: ContentBundle;
beforeAll(async () => {
  content = await baseContent();
});

function gameSim(
  car: Partial<SimVehicleSpawn> = {},
  spawn: { x: number; y: number } = DRIVER_DOOR,
  dev = true,
): Sim {
  return createSim({
    seed: 7,
    map: buildMap({
      width: 64,
      height: 64,
      objects: [
        { contentId: 'base:fuel-pump', ...PUMP },
        { contentId: 'base:fuel-pump', ...FAR_PUMP },
      ],
    }),
    spawn,
    content,
    dev,
    spawnVehicles: [{ ...CAR, type: 'base:sedan', ...car }],
  });
}

const vid = (sim: Sim) => sim.getVehicles()[0]!.stableId;
const info = (sim: Sim) => sim.getVehicles()[0]!;

function run(sim: Sim, n: number, until?: (ev: SimEvent[]) => boolean): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    ev.push(...sim.drainEvents());
    if (until?.(ev)) break;
  }
  return ev;
}
const rejects = (ev: SimEvent[]) => eventsOf(ev, 'commandRejected');
const done = (ev: SimEvent[]) => eventsOf(ev, 'actionCompleted').length > 0;

/** Merged view patches over `n` ticks (later fields win). */
function viewAfter(sim: Sim, n = 1): SimViewPatch {
  const out: SimViewPatch = {};
  for (let i = 0; i < n; i++) {
    sim.step();
    Object.assign(out, sim.drainView() ?? {});
  }
  return out;
}

function enterDriver(sim: Sim): SimEvent[] {
  send(sim, { type: 'enterVehicle', vehicleId: vid(sim), seat: 0 });
  return run(sim, 60, (ev) => eventsOf(ev, 'vehicleEnter').length > 0);
}

function giveCan(sim: Sim, litres = 0): number {
  send(sim, { type: 'debugGiveItem', itemId: 'base:gas-can' });
  sim.step();
  const st = sim.world.items!;
  const def = st.content.itemIndex.get('base:gas-can');
  const can = [...st.items.values()].filter((i) => i.def === def).pop()!;
  if (litres > 0) can.fuelL = litres;
  return can.id;
}

describe('trunk / glovebox `searched`', () => {
  it('false until this player searched it (like world storage), then true', () => {
    const sim = gameSim({}, BEHIND);
    const trunk = info(sim).containers[0]!;
    const near = viewAfter(sim, 2).nearby!.find((c) => c.id === trunk)!;
    expect(near).toMatchObject({ kind: 'vehicle-trunk', searched: false });
    // Opening an unsearched trunk starts the search, like world storage.
    send(sim, { type: 'openContainer', container: trunk });
    expect(eventsOf(run(sim, 1), 'actionStarted')[0]?.action).toBe('search');
    run(sim, 200, done);
    expect(viewAfter(sim).nearby!.find((c) => c.id === trunk)!.searched).toBe(true);
  });

  it('the glovebox from the driver seat: false before the search', () => {
    const sim = gameSim();
    enterDriver(sim);
    const box = info(sim).containers[1]!;
    const near = nearbyView(sim.world, sim.world.players.get(0)!);
    expect(near.find((c) => c.id === box)).toMatchObject({ searched: false });
  });
});

describe('`drive` stops timed actions', () => {
  it('gas or brake interrupts `hotwire` (`moved`), steering alone does not', () => {
    const sim = gameSim({ key: 'none' });
    send(sim, { type: 'debugSkill', skill: 'base:electrical', level: 10 });
    enterDriver(sim);
    send(sim, { type: 'hotwire' });
    run(sim, 5);
    send(sim, { type: 'drive', throttle: 0, brake: 0, steer: 1, handbrake: false });
    expect(eventsOf(run(sim, 2), 'actionInterrupted')).toHaveLength(0);
    send(sim, { type: 'drive', throttle: 0, brake: 0.5, steer: 0, handbrake: false });
    const ev = run(sim, 200, (e) => eventsOf(e, 'hotwired').length > 0);
    expect(eventsOf(ev, 'actionInterrupted')[0]).toMatchObject({
      action: 'hotwire',
      reason: 'moved',
    });
    expect(eventsOf(ev, 'hotwired')).toHaveLength(0);
  });
});

describe('`commandRejected.missing`', () => {
  it('repair: every tool, part and the skill that is lacking', () => {
    const sim = gameSim({}, { x: CAR.x, y: CAR.y - 1.6 });
    sim.setPartHp(vid(sim), 'tireFL', 0);
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'tireFL' });
    expect(rejects(run(sim, 1))[0]).toMatchObject({
      reason: 'missing-tool',
      missing: { tools: ['base:tool-wrench'], parts: [{ item: 'base:car-tire', qty: 1 }] },
    });
    sim.setPartHp(vid(sim), 'engine', 10);
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'engine' });
    const r = rejects(run(sim, 1))[0]!;
    expect(r.reason).toBe('skill-too-low');
    expect(r.missing?.skill).toEqual({ skill: 'base:mechanics', level: 2, have: 0 });
  });

  it('hotwire skill, siphon hose, refuel can; other rejects carry none', () => {
    const sim = gameSim({ key: 'none' });
    enterDriver(sim);
    send(sim, { type: 'hotwire' });
    expect(rejects(run(sim, 1))[0]!.missing).toEqual({
      skill: { skill: 'base:electrical', level: 1, have: 0 },
    });
    send(sim, { type: 'horn' });
    send(sim, { type: 'lockVehicle', vehicleId: 999, locked: true });
    expect(rejects(run(sim, 1)).every((e) => e.missing === undefined)).toBe(true);
    const foot = gameSim({}, { x: CAR.x, y: CAR.y - 1.6 });
    const can = giveCan(foot);
    send(foot, { type: 'siphonFuel', vehicleId: vid(foot), item: can });
    expect(rejects(run(foot, 1))[0]).toMatchObject({
      reason: 'missing-tool',
      missing: { tools: ['base:tool-hose'] },
    });
    send(foot, { type: 'refuelVehicle', vehicleId: vid(foot), item: 12345 });
    expect(rejects(run(foot, 1))[0]).toMatchObject({
      reason: 'no-item',
      missing: { items: ['base:gas-can'] },
    });
  });
});

describe('pumps', () => {
  it('`pumps` view: stock known before the first use (= that roll), power / crank and rate', () => {
    const sim = gameSim({}, AT_PUMP);
    const pumps = viewAfter(sim).pumps!;
    expect(pumps).toHaveLength(2);
    const stock = Math.round(pumpReserve(sim.world, PUMP.x, PUMP.y, 0) * 10) / 10;
    expect(pumps[0]).toEqual({ ...PUMP, z: 0, stockL: stock, source: 'power', lps: 1.5 });
    const can = giveCan(sim);
    send(sim, { type: 'fillFuelCan', item: can, ...PUMP });
    run(sim, 2);
    expect(sim.getAction()?.fuel).toEqual({ source: 'power', lps: 1.5, pump: PUMP });
    run(sim, 400, done);
    const after = viewAfter(sim).pumps!;
    expect(after[0]!.stockL).toBeCloseTo(stock - 10, 1);
    sim.world.items!.powered = false;
    expect(viewAfter(sim).pumps![0]).toMatchObject({ source: 'crank', lps: 0.3 });
  });

  it('`refuelVehicle {pump}`: the car straight from the pump, no can', () => {
    const sim = gameSim({ fuel: 10 }, AT_PUMP);
    const before = pumpReserve(sim.world, PUMP.x, PUMP.y, 0);
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), pump: PUMP });
    const start = eventsOf(run(sim, 1), 'actionStarted')[0]!;
    expect(start.endTick - start.tick).toBe(Math.ceil((40 / 1.5) * 20));
    expect(sim.getAction()?.fuel).toEqual({ source: 'power', lps: 1.5, pump: PUMP });
    const ev = run(sim, 1000, done);
    expect(eventsOf(ev, 'refueled')[0]).toMatchObject({
      kind: 'pump',
      item: 0,
      canL: 0,
      litres: 40,
      fuel: 50,
      vehicleId: vid(sim),
    });
    expect(eventsOf(ev, 'refueled')[0]!.pumpL).toBeCloseTo(before - 40, 1);
    expect(info(sim).fuel).toBe(50);
  });

  it('pump refuel rejects: car beyond the hose (`detail: hose`), both or no source', () => {
    const sim = gameSim({ fuel: 10 }, { x: FAR_PUMP.x + 0.5, y: FAR_PUMP.y - 0.5 });
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), pump: FAR_PUMP });
    expect(rejects(run(sim, 1))[0]).toMatchObject({ reason: 'out-of-range', detail: 'hose' });
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), pump: FAR_PUMP, item: 1 });
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim) });
    expect(rejects(run(sim, 1)).map((e) => e.reason)).toEqual(['invalid-target', 'invalid-target']);
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), pump: { x: 1, y: 1 } });
    expect(rejects(run(sim, 1))[0]!.reason).toBe('no-station');
  });

  it('a can pour reports `fuel {source: can}`', () => {
    const sim = gameSim({ fuel: 10 }, { x: CAR.x, y: CAR.y - 1.6 });
    const can = giveCan(sim, 5);
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), item: can });
    run(sim, 2);
    expect(sim.getAction()?.fuel).toEqual({ source: 'can', lps: 1 });
  });
});

describe('vehicle view: seats and parts', () => {
  it('`seats` (PlayerId | null per seat), `driverId`, `parts`', () => {
    const sim = gameSim();
    const v0 = viewAfter(sim).vehicles![0]!;
    expect(v0.seats).toEqual([null, null, null, null]);
    expect(v0.driverId).toBeNull();
    expect(v0.parts).toEqual({ battery: 100, fuelTank: 100 });
    enterDriver(sim);
    const v1 = viewAfter(sim).vehicles![0]!;
    expect(v1.seats).toEqual([0, null, null, null]);
    expect(v1.driverId).toBe(0);
  });
});

describe('parts `battery` / `fuelTank`, `debugDamageVehicle`', () => {
  it('debugDamageVehicle sets hp (dev only); a dead battery: no start (`no-power`)', () => {
    const prod = gameSim({}, DRIVER_DOOR, false);
    send(prod, { type: 'debugDamageVehicle', vehicleId: vid(prod), part: 'battery', hp: 0 });
    expect(rejects(run(prod, 1))[0]!.reason).toBe('dev-only');
    const sim = gameSim();
    const hash = sim.hash();
    send(sim, { type: 'debugDamageVehicle', vehicleId: vid(sim), part: 'battery', hp: 0 });
    send(sim, { type: 'debugDamageVehicle', vehicleId: 999, part: 'engine', hp: 0 });
    expect(rejects(run(sim, 1)).map((e) => e.reason)).toEqual(['invalid-target']);
    expect(sim.getPartHp(vid(sim), 'battery')).toBe(0);
    expect(sim.hash()).not.toBe(hash);
    enterDriver(sim);
    expect(info(sim).engineOn).toBe(false);
    send(sim, { type: 'vehicleEngine', on: true });
    expect(rejects(run(sim, 1))[0]!.reason).toBe('no-power');
    expect(viewAfter(sim).vehicles![0]!.parts).toEqual({ battery: 0, fuelTank: 100 });
  });

  it('a damaged tank leaks tankLeakLps × damage; a car battery replaces the battery', () => {
    const sim = gameSim({ fuel: 20 }, { x: CAR.x, y: CAR.y - 1.6 });
    send(sim, { type: 'debugDamageVehicle', vehicleId: vid(sim), part: 'fuelTank', hp: 50 });
    run(sim, 1);
    const f0 = info(sim).fuel;
    run(sim, 200);
    // 0.02 l/s × (1 − 0.5) × 10 s.
    expect(f0 - info(sim).fuel).toBeCloseTo(0.1, 3);
    sim.setPartHp(vid(sim), 'battery', 0);
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'battery' });
    expect(rejects(run(sim, 1))[0]).toMatchObject({
      reason: 'missing-parts',
      missing: { parts: [{ item: 'base:car-battery', qty: 1 }] },
    });
    send(sim, { type: 'debugGiveItem', itemId: 'base:car-battery' });
    sim.step();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'battery' });
    const ev = run(sim, 400, done);
    expect(eventsOf(ev, 'partRepaired')[0]).toMatchObject({ part: 'battery', hp: 100 });
  });

  it('damaged parts survive a save; undamaged cars hash as before', () => {
    const sim = gameSim();
    send(sim, { type: 'debugDamageVehicle', vehicleId: vid(sim), part: 'fuelTank', hp: 30 });
    run(sim, 3);
    const back = createSim({
      seed: 7,
      map: buildMap({ width: 64, height: 64 }),
      content,
      dev: true,
      load: sim.save(),
    });
    expect(back.hash()).toBe(sim.hash());
    expect(back.getPartHp(vid(back), 'fuelTank')).toBeCloseTo(30, 4);
    expect('battery' in sim.world.physics.vehicles.get(vid(sim))!).toBe(false);
  });
});
