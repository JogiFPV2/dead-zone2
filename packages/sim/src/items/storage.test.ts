import { describe, expect, it } from 'vitest';
import { runMinutes, send } from '../test/content-fixtures.js';
import {
  findItem,
  itemsSim,
  mainItems,
  rejectedReasons,
  worldContainer,
} from '../test/item-fixtures.js';
import { ageAt, freshness } from './spoilage.js';

const minutes = (sim: ReturnType<typeof itemsSim>) => sim.gameTime().minute;

describe('spoilage (lazy)', () => {
  it('fresh → stale → rotten by freshMin / rottenMin in game minutes', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    sim.step();
    const st = sim.world.items!;
    const apple = st.items.get(findItem(sim, 'fixture:apple')!.id)!;
    const t0 = minutes(sim);
    expect(freshness(st, apple, t0 + 99)).toBe('fresh');
    expect(freshness(st, apple, t0 + 100)).toBe('stale');
    expect(freshness(st, apple, t0 + 200)).toBe('rotten');
    // No per-tick work: the stored age did not change while time passed.
    runMinutes(sim, 3);
    expect(apple.ageMin).toBe(0);
    expect(findItem(sim, 'fixture:apple')!.freshness).toBe('fresh');
  });

  it('a powered fridge slows spoilage ×0.3; moving re-stamps the age', () => {
    const sim = itemsSim();
    const fridge = worldContainer(sim, 9, 10);
    send(sim, { type: 'openContainer', container: fridge.id });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    runMinutes(sim, 1.1);
    const st = sim.world.items!;
    const id = findItem(sim, 'fixture:apple')!.id;
    send(sim, { type: 'moveItem', item: id, to: fridge.id });
    sim.step();
    const apple = st.items.get(id)!;
    const t = apple.ageStamp;
    const before = apple.ageMin;
    expect(ageAt(st, apple, t + 100)).toBeCloseTo(before + 30, 3);
    st.powered = false;
    expect(ageAt(st, apple, t + 100)).toBeCloseTo(before + 100, 3);
    st.powered = true;
    // Out of the fridge after 100 min: 30 min of age, then ×1 again.
    runMinutes(sim, 100);
    send(sim, { type: 'pickUp', item: id });
    sim.step();
    expect(apple.loc).toBe(sim.getInventory()!.container);
    expect(apple.ageMin).toBeCloseTo(before + 0.3 * (apple.ageStamp - t), 3);
  });

  it('loot food is aged since the world start (clockStart day 3)', () => {
    const sim = itemsSim(undefined, { clockStart: { day: 3, hour: 9, minute: 0 } });
    const st = sim.world.items!;
    const cab = worldContainer(sim, 11, 10);
    send(sim, { type: 'openContainer', container: cab.id });
    runMinutes(sim, 2.1);
    for (const id of st.containers.get(cab.id)!.items) {
      expect(st.items.get(id)!.ageStamp).toBe(sim.world.clock.startMinute);
    }
  });
});

describe('storage: placing and carrying crates', () => {
  it('a storage placeable can be placed in reach, filled, and picked up with its contents', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:crate-item' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 3 });
    sim.step();
    const crate = findItem(sim, 'fixture:crate-item')!;
    expect(crate.container).toBeDefined();
    send(sim, { type: 'placeStorage', item: crate.id, x: 20, y: 20 });
    send(sim, { type: 'placeStorage', item: crate.id, x: 11, y: 11 });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['out-of-range']);
    const nearby = sim.drainView()!.nearby!;
    const pile = nearby.find((c) => c.kind === 'ground' && c.x === 11 && c.y === 11)!;
    expect(sim.getContainer(pile.id)!.items).toEqual([
      expect.objectContaining({ id: crate.id, placed: true, container: crate.container }),
    ]);
    send(sim, { type: 'moveItem', item: findItem(sim, 'fixture:brick')!.id, to: crate.container! });
    sim.step();
    expect(sim.getContainer(crate.container!)!.weightKg).toBe(6);
    expect(sim.getInventory()!.loadKg).toBe(0);
    send(sim, { type: 'pickUp', item: crate.id });
    sim.step();
    // Crate 4 kg + 6 kg inside, no bag reduction.
    expect(sim.getInventory()!.loadKg).toBe(10);
    expect(findItem(sim, 'fixture:crate-item')!.placed).toBeUndefined();
  });

  it('non-storage items cannot be placed; storage capacity is enforced', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 10 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 10 });
    sim.step();
    const cab = worldContainer(sim, 11, 10);
    send(sim, { type: 'placeStorage', item: mainItems(sim)[0]!.id, x: 10, y: 10 });
    send(sim, { type: 'moveItem', item: mainItems(sim)[0]!.id, to: cab.id });
    sim.step();
    // Unsearched storage is not reachable yet.
    expect(rejectedReasons(sim)).toEqual(['invalid-target', 'out-of-range']);
    send(sim, { type: 'openContainer', container: cab.id });
    runMinutes(sim, 2.1);
    const inCab = sim.getContainer(cab.id)!.weightKg;
    for (const it of mainItems(sim)) send(sim, { type: 'moveItem', item: it.id, to: cab.id });
    sim.step();
    // 20 kg cabinet: the first 20 kg stack only fits if the loot left room.
    expect(sim.getContainer(cab.id)!.weightKg).toBeLessThanOrEqual(20);
    expect(sim.getContainer(cab.id)!.weightKg).toBeGreaterThanOrEqual(inCab);
    expect(rejectedReasons(sim)).toContain('no-space');
  });

  it('map storage with pickupItem becomes that item with its contents (after a search)', () => {
    const sim = itemsSim(undefined, { spawn: { x: 10.5, y: 12.5 } });
    const crate = worldContainer(sim, 10, 13);
    send(sim, { type: 'pickUpStorage', container: crate.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['out-of-range']);
    send(sim, { type: 'openContainer', container: crate.id });
    runMinutes(sim, 0.6);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick' });
    sim.step();
    send(sim, { type: 'moveItem', item: findItem(sim, 'fixture:brick')!.id, to: crate.id });
    sim.step();
    send(sim, { type: 'pickUpStorage', container: crate.id });
    sim.step();
    expect(sim.getContainer(crate.id)).toBeUndefined();
    const item = findItem(sim, 'fixture:crate-item')!;
    expect(sim.getContainer(item.container!)!.items).toEqual([
      expect.objectContaining({ def: 'fixture:brick' }),
    ]);
    const fridge = worldContainer(sim, 9, 10);
    send(sim, { type: 'pickUpStorage', container: fridge.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
  });
});
