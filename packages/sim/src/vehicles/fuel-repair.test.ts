import type { ContentBundle } from '@deadzone/content';
import {
  CHUNK_SIZE,
  type SimChunkVehicle,
  type SimEvent,
  type SimMap,
  type SimVehicleSpawn,
  type WorldSource,
} from '@deadzone/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSim, type Sim } from '../sim.js';
import { createCorpse } from '../items/search.js';
import { ChunkLoot } from '../lod/state.js';
import { eventsOf } from '../test/ai-fixtures.js';
import { baseContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { gridWorld, lodSim, walk } from '../test/lod-fixtures.js';
import { vehicleContent } from '../test/vehicle-fixtures.js';

const CAR = { x: 20, y: 20 };
/** Left of the car, next to the body (≤ 1.5 m) but not at the trunk. */
const SIDE = { x: CAR.x, y: CAR.y - 1.6 };
const PUMP = { x: 30, y: 30 };

let content: ContentBundle;
beforeAll(async () => {
  content = await baseContent();
});

function gameSim(car: Partial<SimVehicleSpawn> = {}, spawn: { x: number; y: number } = SIDE): Sim {
  return createSim({
    seed: 7,
    map: buildMap({ width: 64, height: 64, objects: [{ contentId: 'base:fuel-pump', ...PUMP }] }),
    spawn,
    content,
    dev: true,
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
const rejected = (ev: SimEvent[]) => eventsOf(ev, 'commandRejected').map((r) => r.reason);
const done = (ev: SimEvent[]) => eventsOf(ev, 'actionCompleted').length > 0;

/** Gives a gas can with `litres` and returns its id. */
function giveCan(sim: Sim, litres = 0): number {
  send(sim, { type: 'debugGiveItem', itemId: 'base:gas-can' });
  sim.step();
  const st = sim.world.items!;
  const def = st.content.itemIndex.get('base:gas-can');
  const can = [...st.items.values()].filter((i) => i.def === def).pop()!;
  if (litres > 0) can.fuelL = litres;
  return can.id;
}
const canL = (sim: Sim, id: number) => sim.world.items!.items.get(id)!.fuelL ?? 0;

describe('fuel', () => {
  it('a gas can shows its level in the inventory view', () => {
    const sim = gameSim();
    const id = giveCan(sim, 4);
    sim.world.items!.version++;
    const inv = sim.getInventory()!;
    const item = inv.containers!.flatMap((c) => c.items).find((i) => i.id === id)!;
    expect(item).toMatchObject({ fuelL: 4, fuelMaxL: 10 });
  });

  it('fills a can at a powered pump at 1.5 l/s; the pump reserve goes down', () => {
    const sim = gameSim({}, { x: PUMP.x - 0.5, y: PUMP.y + 0.5 });
    const id = giveCan(sim);
    send(sim, { type: 'fillFuelCan', item: id, ...PUMP });
    const ev = run(sim, 400, done);
    const start = eventsOf(ev, 'actionStarted')[0]!;
    expect(start.endTick - start.tick).toBe(Math.ceil((10 / 1.5) * 20));
    expect(eventsOf(ev, 'refueled')[0]).toMatchObject({ kind: 'fill', litres: 10, canL: 10 });
    expect(canL(sim, id)).toBe(10);
    const left = [...sim.world.items!.pumps.values()][0]!;
    expect(left).toBeGreaterThanOrEqual(190);
    expect(left).toBeLessThanOrEqual(990);
  });

  it('without power the pump works by hand, slower', () => {
    const sim = gameSim({}, { x: PUMP.x - 0.5, y: PUMP.y + 0.5 });
    sim.world.items!.powered = false;
    const id = giveCan(sim);
    send(sim, { type: 'fillFuelCan', item: id, ...PUMP });
    const start = eventsOf(run(sim, 1), 'actionStarted')[0]!;
    expect(start.endTick - start.tick).toBe(Math.ceil((10 / 0.3) * 20));
  });

  it('no pump on that tile: `no-station`; far away: `out-of-range`', () => {
    const sim = gameSim({}, { x: PUMP.x - 0.5, y: PUMP.y + 0.5 });
    const id = giveCan(sim);
    send(sim, { type: 'fillFuelCan', item: id, x: PUMP.x + 1, y: PUMP.y });
    expect(rejected(run(sim, 1))).toEqual(['no-station']);
    const far = gameSim();
    const id2 = giveCan(far);
    send(far, { type: 'fillFuelCan', item: id2, ...PUMP });
    expect(rejected(run(far, 1))).toEqual(['out-of-range']);
  });

  it('pours a can into the tank at 1 l/s', () => {
    const sim = gameSim({ fuel: 20 });
    const id = giveCan(sim, 10);
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), item: id });
    const ev = run(sim, 400, done);
    const start = eventsOf(ev, 'actionStarted')[0]!;
    expect(start.endTick - start.tick).toBe(200);
    expect(eventsOf(ev, 'refueled')[0]).toMatchObject({
      kind: 'refuel',
      vehicleId: vid(sim),
      litres: 10,
      canL: 0,
      fuel: 30,
    });
    expect(info(sim).fuel).toBeCloseTo(30, 4);
    expect(canL(sim, id)).toBe(0);
  });

  it('an interrupted pour moves what it managed', () => {
    const sim = gameSim({ fuel: 20 });
    const id = giveCan(sim, 10);
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), item: id });
    run(sim, 100);
    send(sim, { type: 'move', dx: 0, dy: -1 });
    const ev = run(sim, 2);
    const r = eventsOf(ev, 'refueled')[0]!;
    expect(r.litres).toBeGreaterThan(4.5);
    expect(r.litres).toBeLessThan(5.5);
    expect(info(sim).fuel + canL(sim, id)).toBeCloseTo(30, 3);
  });

  it('empty can `no-fuel`, full tank `no-space`, far `out-of-range`', () => {
    const sim = gameSim({ fuel: 20 });
    const empty = giveCan(sim);
    send(sim, { type: 'refuelVehicle', vehicleId: vid(sim), item: empty });
    expect(rejected(run(sim, 1))).toEqual(['no-fuel']);
    const full = gameSim();
    const can = giveCan(full, 5);
    send(full, { type: 'refuelVehicle', vehicleId: vid(full), item: can });
    expect(rejected(run(full, 1))).toEqual(['no-space']);
    const far = gameSim({ fuel: 20 }, { x: 40, y: 40 });
    const c3 = giveCan(far, 5);
    send(far, { type: 'refuelVehicle', vehicleId: vid(far), item: c3 });
    expect(rejected(run(far, 1))).toEqual(['out-of-range']);
  });

  it('siphoning needs a hose; then the tank goes into the can at 0.25 l/s', () => {
    const sim = gameSim({ fuel: 30 });
    const id = giveCan(sim);
    send(sim, { type: 'siphonFuel', vehicleId: vid(sim), item: id });
    expect(rejected(run(sim, 1))).toEqual(['missing-tool']);
    send(sim, { type: 'debugGiveItem', itemId: 'base:rubber-hose' });
    sim.step();
    send(sim, { type: 'siphonFuel', vehicleId: vid(sim), item: id });
    const ev = run(sim, 1000, done);
    expect(eventsOf(ev, 'refueled')[0]).toMatchObject({ kind: 'siphon', litres: 10, canL: 10 });
    expect(info(sim).fuel).toBeCloseTo(20, 4);
  });

  it('can levels and pump reserves survive a save', () => {
    const sim = gameSim({}, { x: PUMP.x - 0.5, y: PUMP.y + 0.5 });
    const id = giveCan(sim);
    send(sim, { type: 'fillFuelCan', item: id, ...PUMP });
    run(sim, 400, done);
    const back = createSim({
      seed: 7,
      map: buildMap({ width: 64, height: 64, objects: [{ contentId: 'base:fuel-pump', ...PUMP }] }),
      content,
      dev: true,
      load: sim.save(),
    });
    expect(back.hash()).toBe(sim.hash());
    expect(canL(back, id)).toBe(10);
    expect([...back.world.items!.pumps.values()]).toEqual([...sim.world.items!.pumps.values()]);
  });
});

describe('repairs', () => {
  it('tyre: needs a wrench and a tyre; replaced to 100, part used up', () => {
    const sim = gameSim();
    sim.setPartHp(vid(sim), 'tireFL', 0);
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'tireFL' });
    expect(rejected(run(sim, 1))).toEqual(['missing-tool']);
    send(sim, { type: 'debugGiveItem', itemId: 'base:tire-iron' });
    sim.step();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'tireFL' });
    expect(rejected(run(sim, 1))).toEqual(['missing-parts']);
    send(sim, { type: 'debugGiveItem', itemId: 'base:car-tire' });
    sim.step();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'tireFL' });
    const ev = run(sim, 400, done);
    expect(sim.getAction()).toBeFalsy();
    expect(eventsOf(ev, 'partRepaired')[0]).toMatchObject({ part: 'tireFL', hp: 100 });
    expect(sim.getPartHp(vid(sim), 'tireFL')).toBe(100);
    const st = sim.world.items!;
    const tire = st.content.itemIndex.get('base:car-tire');
    expect([...st.items.values()].some((i) => i.def === tire)).toBe(false);
  });

  it('engine: Mechanics 2 needed; hp gained grows with the level', () => {
    const sim = gameSim();
    sim.setPartHp(vid(sim), 'engine', 0);
    send(sim, { type: 'debugGiveItem', itemId: 'base:pipe-wrench' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:engine-parts' });
    sim.step();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'engine' });
    expect(rejected(run(sim, 1))).toEqual(['skill-too-low']);
    send(sim, { type: 'debugSkill', skill: 'base:mechanics', level: 3 });
    sim.step();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'engine' });
    const ev = run(sim, 600, done);
    const r = eventsOf(ev, 'partRepaired')[0]!;
    expect(r.hp).toBeCloseTo(20 + 3 * 8, 4);
    // Nobody sits inside: a repaired engine does not start by itself.
    expect(info(sim).engineOn).toBe(false);
  });

  it('a whole part: `invalid-target`; repair shows in the action view', () => {
    const sim = gameSim();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'windowLeft' });
    expect(rejected(run(sim, 1))).toEqual(['invalid-target']);
    sim.setPartHp(vid(sim), 'windowLeft', 0);
    send(sim, { type: 'debugSkill', skill: 'base:mechanics', level: 1 });
    send(sim, { type: 'debugGiveItem', itemId: 'base:car-window' });
    sim.step();
    send(sim, { type: 'repairVehicle', vehicleId: vid(sim), part: 'windowLeft' });
    run(sim, 2);
    expect(sim.getAction()?.vehicle).toEqual({ vehicleId: vid(sim), part: 'windowLeft' });
  });
});

/** Map with parked cars in chunk (0, 0). */
function carMap(cars: readonly SimChunkVehicle[]): SimMap {
  const base = buildMap({ width: 64, height: 64 });
  return {
    ...base,
    getChunk: (cx, cy, z) => {
      const c = base.getChunk(cx, cy, z);
      return c && cx === 0 && cy === 0 && z === 0 ? { ...c, vehicles: cars } : c;
    },
  };
}

describe('cars from chunk data', () => {
  const many: SimChunkVehicle[] = Array.from({ length: 24 }, (_, i) => ({
    x: 3 + (i % 4) * 7,
    y: 2 + Math.floor(i / 4) * 5,
    heading: 0,
  }));

  it('spawned at init with seeded lock / key / fuel rolls (same seed = same cars)', () => {
    const make = () =>
      createSim({ seed: 3, map: carMap(many), content, dev: true, spawn: { x: 50, y: 50 } });
    const sim = make();
    const cars = sim.getVehicles();
    expect(cars).toHaveLength(24);
    expect(cars[0]).toMatchObject({ x: 3, y: 2, type: 'base:sedan' });
    expect(cars.some((c) => c.locked)).toBe(true);
    expect(cars.some((c) => !c.locked)).toBe(true);
    for (const c of cars) {
      expect(c.fuel).toBeGreaterThanOrEqual(0);
      expect(c.fuel).toBeLessThanOrEqual(0.6 * 50 + 1e-3);
    }
    const st = sim.world.items!;
    const keyed = new Set([...st.items.values()].flatMap((i) => (i.vehicle ? [i.vehicle] : [])));
    const vs = [...sim.world.physics.vehicles.values()];
    expect(vs.some((v) => v.keyIn)).toBe(true);
    expect(vs.some((v) => keyed.has(v.id))).toBe(true);
    expect(vs.some((v) => v.keyZombie)).toBe(true);
    expect(vs.some((v) => !v.keyIn && !keyed.has(v.id) && !v.keyZombie)).toBe(true);
    expect(make().hash()).toBe(sim.hash());
  });

  it('a key waiting for a zombie goes into the corpse of the next zombie killed nearby', () => {
    const sim = createSim({
      seed: 3,
      map: carMap(many),
      content,
      dev: true,
      spawn: { x: 50, y: 50 },
    });
    const v = [...sim.world.physics.vehicles.values()].find((u) => u.keyZombie)!;
    const corpse = createCorpse(sim.world, 999_999, v.x + 3, v.y, 0, undefined)!;
    const key = corpse.items.map((id) => sim.world.items!.items.get(id)!);
    expect(key.map((i) => i.vehicle)).toContain(v.id);
    expect(v.keyZombie).toBe(false);
  });

  it('LOD: a pristine car leaves with its chunk and comes back the same; a changed one stays', () => {
    const grid = gridWorld({ w: 40, h: 12 });
    const world: WorldSource = {
      ...grid,
      getChunk: (cx, cy, z) => {
        const c = grid.getChunk(cx, cy, z);
        return c && z === 0 && cy === 4 && (cx === 4 || cx === 6)
          ? { ...c, vehicles: [{ x: 20, y: 24, heading: 0, type: 'fixture:sedan' }] }
          : c;
      },
    };
    const sim = lodSim(
      world,
      6,
      6,
      { walkSpeedTilesPerSecond: 16, lod: { defaultZombiesPerChunk: 0 } },
      vehicleContent(),
    );
    sim.step();
    const lod = sim.world.lod!;
    const idx = (cx: number, cy: number): number => cy * lod.wChunks + cx;
    const carIn = (cx: number) =>
      sim
        .getVehicles()
        .filter((c) => Math.floor(c.x / CHUNK_SIZE) === cx && Math.floor(c.y / CHUNK_SIZE) === 4);
    expect(carIn(4)).toHaveLength(1);
    expect(carIn(6)).toHaveLength(1);
    const before = carIn(4)[0]!;
    // Change the car in chunk (6, 4): it and its chunk stay.
    sim.world.physics.vehicles.get(carIn(6)[0]!.stableId)!.fuel = 1;
    walk(sim, 1, 0, 20 * 20 + 20);
    expect(carIn(4)).toHaveLength(0);
    expect(lod.chunkLoot[idx(4, 4)]).toBe(ChunkLoot.none);
    expect(carIn(6)).toHaveLength(1);
    expect(lod.chunkLoot[idx(6, 4)]).toBe(ChunkLoot.dirty);
    walk(sim, -1, 0, 20 * 20 + 20);
    const again = carIn(4);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({
      x: before.x,
      y: before.y,
      locked: before.locked,
      fuel: before.fuel,
    });
    expect(carIn(6)).toHaveLength(1);
  });
});
