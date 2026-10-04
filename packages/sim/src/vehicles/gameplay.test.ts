import { VehiclesSettingsSchema, type ContentBundle } from '@deadzone/content';
import type { SimEvent, SimVehicleSpawn } from '@deadzone/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { ensureVehicleGameplay } from './keys.js';
import { DEFAULT_VEHICLE_GAMEPLAY } from './settings.js';
import type { Vehicle } from './types.js';

/** Car at (20, 20) heading +x: driver door (left = −y) and the point behind the trunk. */
const CAR = { x: 20, y: 20 };
const DRIVER_DOOR = { x: CAR.x + 0.1, y: CAR.y - 1.3 };
const BEHIND = { x: CAR.x - 2.6, y: CAR.y };

let content: ContentBundle;
beforeAll(async () => {
  content = await baseContent();
});

function gameSim(car: Partial<SimVehicleSpawn> = {}, spawn = DRIVER_DOOR, seed = 7): Sim {
  return createSim({
    seed,
    map: buildMap({ width: 64, height: 64 }),
    spawn,
    content,
    dev: true,
    spawnVehicles: [{ ...CAR, type: 'base:sedan', ...car }],
  });
}

const vid = (sim: Sim) => sim.getVehicles()[0]!.stableId;
const info = (sim: Sim) => sim.getVehicles()[0]!;
const seated = (sim: Sim) =>
  info(sim).occupants[0] === sim.world.c.StableId.value[sim.world.players.get(0)!];

/** Steps up to `n` ticks, collecting events, until `until` holds. */
function run(sim: Sim, n: number, until?: (ev: SimEvent[]) => boolean): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    ev.push(...sim.drainEvents());
    if (until?.(ev)) break;
  }
  return ev;
}

const rejected = (ev: SimEvent[]) => eventsOf(ev, 'commandRejected');

/** Enters the driver seat (timed) and waits until seated. */
function enterDriver(sim: Sim): SimEvent[] {
  send(sim, { type: 'enterVehicle', vehicleId: vid(sim), seat: 0 });
  return run(sim, 60, (ev) => eventsOf(ev, 'vehicleEnter').length > 0);
}

describe('vehicle gameplay settings', () => {
  it('sim defaults equal the content schema defaults', () => {
    expect(DEFAULT_VEHICLE_GAMEPLAY).toEqual(VehiclesSettingsSchema.parse({}));
  });

  it('state from before vehicle gameplay: unlocked, key in the ignition', () => {
    const v = { containers: [] } as unknown as Vehicle;
    ensureVehicleGameplay(v);
    expect(v).toMatchObject({ locked: false, keyIn: true, hotwired: false, hornTick: -1 });
  });
});

describe('timed enter / exit', () => {
  it('enterVehicle takes ~1.5 s (30 ticks) and reports the action with the car', () => {
    const sim = gameSim();
    send(sim, { type: 'enterVehicle', vehicleId: vid(sim), seat: 0 });
    const first = run(sim, 1);
    const started = eventsOf(first, 'actionStarted')[0]!;
    expect(started.action).toBe('enterVehicle');
    expect(started.vehicleId).toBe(vid(sim));
    expect(sim.getAction()?.vehicle).toEqual({ vehicleId: vid(sim), seat: 0 });
    expect(seated(sim)).toBe(false);
    const ev = run(sim, 60, (e) => eventsOf(e, 'vehicleEnter').length > 0);
    const ticks = eventsOf(ev, 'vehicleEnter')[0]!.tick - started.tick;
    expect(ticks).toBeGreaterThanOrEqual(28);
    expect(ticks).toBeLessThanOrEqual(32);
    expect(seated(sim)).toBe(true);
    expect(info(sim).engineOn).toBe(true);
  });

  it('moving away cancels getting in', () => {
    const sim = gameSim();
    send(sim, { type: 'enterVehicle', vehicleId: vid(sim), seat: 0 });
    run(sim, 5);
    send(sim, { type: 'move', dx: 0, dy: -1 });
    const ev = run(sim, 60);
    expect(eventsOf(ev, 'vehicleEnter')).toHaveLength(0);
    expect(seated(sim)).toBe(false);
  });

  it('exitVehicle takes ~1 s', () => {
    const sim = gameSim();
    enterDriver(sim);
    send(sim, { type: 'exitVehicle' });
    const ev = run(sim, 40, (e) => eventsOf(e, 'vehicleExit').length > 0);
    const started = eventsOf(ev, 'actionStarted')[0]!;
    expect(started.action).toBe('exitVehicle');
    const exitTick = eventsOf(ev, 'vehicleExit')[0]!.tick;
    expect(exitTick - started.tick).toBeGreaterThanOrEqual(18);
    expect(seated(sim)).toBe(false);
  });
});

describe('locks and keys', () => {
  it('a locked car without its key: `locked`', () => {
    const sim = gameSim({ locked: true });
    send(sim, { type: 'enterVehicle', vehicleId: vid(sim), seat: 0 });
    const ev = run(sim, 2);
    expect(rejected(ev).map((r) => [r.reason, r.command])).toEqual([['locked', 'enterVehicle']]);
  });

  it('the carried key unlocks on getting in', () => {
    const sim = gameSim({ locked: true });
    expect(sim.giveVehicleKey(vid(sim))).toBeTypeOf('number');
    const ev = enterDriver(sim);
    expect(eventsOf(ev, 'vehicleLocked')[0]).toMatchObject({ locked: false, by: 'key' });
    expect(info(sim).locked).toBe(false);
    expect(sim.drainView()?.vehicles?.[0]).toMatchObject({ hasKey: true, locked: false });
  });

  it('a broken window on the door side lets a hand reach the lock', () => {
    const sim = gameSim({ locked: true });
    sim.setPartHp(vid(sim), 'windowLeft', 0);
    const ev = enterDriver(sim);
    expect(eventsOf(ev, 'vehicleLocked')[0]).toMatchObject({ locked: false, by: 'window' });
  });

  it('lockVehicle: from inside always, from outside only with the key', () => {
    const sim = gameSim();
    send(sim, { type: 'lockVehicle', vehicleId: vid(sim), locked: true });
    expect(rejected(run(sim, 1)).map((r) => r.reason)).toEqual(['no-key']);
    enterDriver(sim);
    send(sim, { type: 'lockVehicle', vehicleId: vid(sim), locked: true });
    const ev = run(sim, 1);
    expect(eventsOf(ev, 'vehicleLocked')[0]).toMatchObject({ locked: true, by: 'inside' });
    expect(info(sim).locked).toBe(true);
  });

  it('takeVehicleKey stops the engine; the carried key starts it again', () => {
    const sim = gameSim();
    enterDriver(sim);
    send(sim, { type: 'takeVehicleKey' });
    const ev = run(sim, 1);
    const taken = eventsOf(ev, 'vehicleKeyTaken')[0]!;
    expect(eventsOf(ev, 'engineStop')[0]!.reason).toBe('key');
    expect(info(sim)).toMatchObject({ keyIn: false, engineOn: false });
    const key = sim.world.items!.items.get(taken.itemId)!;
    expect(key.vehicle).toBe(vid(sim));
    send(sim, { type: 'vehicleEngine', on: true });
    expect(eventsOf(run(sim, 1), 'engineStart')).toHaveLength(1);
  });

  it('no key anywhere: the engine does not start (`no-key`)', () => {
    const sim = gameSim({ key: 'none' });
    enterDriver(sim);
    expect(info(sim).engineOn).toBe(false);
    send(sim, { type: 'vehicleEngine', on: true });
    expect(rejected(run(sim, 1)).map((r) => [r.reason, r.command])).toEqual([
      ['no-key', 'vehicleEngine'],
    ]);
  });

  it('a glovebox key lies in the glovebox', () => {
    const sim = gameSim({ key: 'glovebox' });
    const v = sim.world.physics.vehicles.get(vid(sim))!;
    expect(v.keyIn).toBe(false);
    const st = sim.world.items!;
    const glove = v.containers
      .map((id) => st.containers.get(id)!)
      .find((c) => c.kind === 'vehicle-glovebox')!;
    const keys = [...st.items.values()].filter((i) => i.loc === glove.id && i.vehicle === v.id);
    expect(keys).toHaveLength(1);
  });
});

describe('hotwiring', () => {
  it('needs Electrical 1 (`skill-too-low`)', () => {
    const sim = gameSim({ key: 'none' });
    enterDriver(sim);
    send(sim, { type: 'hotwire' });
    expect(rejected(run(sim, 1)).map((r) => r.reason)).toEqual(['skill-too-low']);
  });

  it('timed, noisy, gives XP; success starts the engine and it runs without a key', () => {
    const sim = gameSim({ key: 'none' });
    send(sim, { type: 'debugSkill', skill: 'base:electrical', level: 10 });
    enterDriver(sim);
    let ev: SimEvent[] = [];
    for (let attempt = 0; attempt < 20 && !info(sim).hotwired; attempt++) {
      send(sim, { type: 'hotwire' });
      ev = run(sim, 200, (e) => eventsOf(e, 'hotwired').length > 0);
      const noise = eventsOf(ev, 'playerNoise').filter((n) => n.kind === 'hotwire');
      expect(noise).toHaveLength(1);
      const done = eventsOf(ev, 'hotwired')[0]!;
      const start = eventsOf(ev, 'actionStarted')[0]!;
      expect(done.tick - start.tick).toBeGreaterThanOrEqual(115);
    }
    expect(info(sim)).toMatchObject({ hotwired: true, engineOn: true });
    expect(eventsOf(ev, 'engineStart')).toHaveLength(1);
    send(sim, { type: 'hotwire' });
    expect(rejected(run(sim, 1)).map((r) => r.reason)).toEqual(['invalid-state']);
  });

  it('chance grows with skill and fails sometimes at low skill', () => {
    let ok = 0;
    let fail = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = gameSim({ key: 'none' }, DRIVER_DOOR, seed);
      send(sim, { type: 'debugSkill', skill: 'base:electrical', level: 1 });
      enterDriver(sim);
      send(sim, { type: 'hotwire' });
      const ev = run(sim, 200, (e) => eventsOf(e, 'hotwired').length > 0);
      if (eventsOf(ev, 'hotwired')[0]!.success) ok++;
      else fail++;
    }
    expect(ok + fail).toBe(6);
    expect(fail).toBeGreaterThan(0);
  });
});

describe('horn', () => {
  it('noise `horn` + vehicleHorn, at most once per cooldown', () => {
    const sim = gameSim();
    enterDriver(sim);
    send(sim, { type: 'horn' });
    let ev = run(sim, 1);
    expect(eventsOf(ev, 'vehicleHorn')).toHaveLength(1);
    const n = eventsOf(ev, 'playerNoise').find((e) => e.kind === 'horn')!;
    expect(n.radius).toBe(45);
    send(sim, { type: 'horn' });
    ev = run(sim, 1);
    expect(eventsOf(ev, 'vehicleHorn')).toHaveLength(0);
    expect(rejected(ev)).toHaveLength(0);
    run(sim, 10);
    send(sim, { type: 'horn' });
    expect(eventsOf(run(sim, 1), 'vehicleHorn')).toHaveLength(1);
  });

  it('only from the driver seat', () => {
    const sim = gameSim();
    send(sim, { type: 'horn' });
    expect(rejected(run(sim, 1)).map((r) => r.reason)).toEqual(['invalid-state']);
  });
});

describe('trunk and glovebox', () => {
  const trunkOf = (sim: Sim) => sim.getVehicles()[0]!.containers[0]!;
  const gloveOf = (sim: Sim) => sim.getVehicles()[0]!.containers[1]!;

  it('every car has a trunk (60 kg) and a glovebox (3 kg)', () => {
    const sim = gameSim();
    expect(sim.getVehicles()[0]!.containers).toHaveLength(2);
    expect(sim.getContainer(trunkOf(sim))).toMatchObject({
      kind: 'vehicle-trunk',
      vehicle: vid(sim),
    });
    expect(sim.getContainer(gloveOf(sim))!.kind).toBe('vehicle-glovebox');
    expect(sim.world.items!.containers.get(trunkOf(sim))!.capacityKg).toBe(60);
    expect(sim.world.items!.containers.get(gloveOf(sim))!.capacityKg).toBe(3);
  });

  it('trunk: searched from behind the car (timed, loot rolled), not from the door', () => {
    const far = gameSim();
    send(far, { type: 'search', container: trunkOf(far) });
    expect(rejected(run(far, 1)).map((r) => r.reason)).toEqual(['out-of-range']);

    const sim = gameSim({}, BEHIND);
    const near = sim.drainView()?.nearby ?? [];
    expect(near.find((c) => c.id === trunkOf(sim))).toMatchObject({ vehicle: vid(sim) });
    send(sim, { type: 'search', container: trunkOf(sim) });
    const ev = run(sim, 2000, (e) => eventsOf(e, 'actionCompleted').length > 0);
    expect(eventsOf(ev, 'actionCompleted')[0]!.action).toBe('search');
    expect(sim.world.items!.containers.get(trunkOf(sim))!.lootDone).toBe(true);
  });

  it('a locked trunk: `locked`', () => {
    const sim = gameSim({ locked: true }, BEHIND);
    send(sim, { type: 'search', container: trunkOf(sim) });
    expect(rejected(run(sim, 1)).map((r) => r.reason)).toEqual(['locked']);
  });

  it('glovebox only from a front seat', () => {
    const sim = gameSim();
    send(sim, { type: 'search', container: gloveOf(sim) });
    expect(rejected(run(sim, 1)).map((r) => r.reason)).toEqual(['out-of-range']);
    enterDriver(sim);
    send(sim, { type: 'search', container: gloveOf(sim) });
    const ev = run(sim, 2000, (e) => eventsOf(e, 'actionCompleted').length > 0);
    expect(rejected(ev)).toHaveLength(0);
    expect(sim.world.items!.containers.get(gloveOf(sim))!.lootDone).toBe(true);
  });
});

describe('view, saves, determinism', () => {
  it('SimViewPatch.vehicles: lock / key / fuel state', () => {
    const sim = gameSim({ locked: true, key: 'none', fuel: 20 });
    const v = sim.drainView()!.vehicles![0]!;
    expect(v).toMatchObject({
      vehicleId: vid(sim),
      type: 'base:sedan',
      locked: true,
      keyInIgnition: false,
      hasKey: false,
      hotwired: false,
      engineOn: false,
      fuel: 20,
      fuelMax: 50,
    });
    expect(v.trunk).toBeTypeOf('number');
  });

  it('locks, keys and container contents survive a save', () => {
    const sim = gameSim();
    enterDriver(sim);
    send(sim, { type: 'takeVehicleKey' });
    send(sim, { type: 'lockVehicle', vehicleId: vid(sim), locked: true });
    run(sim, 3);
    const back = createSim({
      seed: 7,
      map: buildMap({ width: 64, height: 64 }),
      spawn: DRIVER_DOOR,
      content,
      dev: true,
      load: sim.save(),
    });
    expect(back.hash()).toBe(sim.hash());
    expect(info(back)).toMatchObject({ locked: true, keyIn: false });
    const keys = [...back.world.items!.items.values()].filter((i) => i.vehicle === vid(back));
    expect(keys).toHaveLength(1);
  });

  it('same commands → same hash', () => {
    const play = () => {
      const sim = gameSim({ key: 'none' });
      let seq = 0;
      const cmd = (c: Record<string, unknown>) =>
        sim.enqueue({ ...c, tick: sim.tick, playerId: 0, seq: seq++ } as never);
      cmd({ type: 'debugSkill', skill: 'base:electrical', level: 3 });
      cmd({ type: 'enterVehicle', vehicleId: vid(sim), seat: 0 });
      run(sim, 40);
      cmd({ type: 'hotwire' });
      run(sim, 150);
      cmd({ type: 'horn' });
      run(sim, 5);
      expect(seated(sim)).toBe(true);
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
