import { describe, expect, it } from 'vitest';
import { fixtureContent, runMinutes, send } from '../test/content-fixtures.js';
import { findItem, itemsSim, mainItems, rejectedReasons } from '../test/item-fixtures.js';

describe('inventory: weight, hands, bags, carry-load', () => {
  it('starts empty with the carry capacity from worldSettings.carry', () => {
    const sim = itemsSim();
    const inv = sim.getInventory()!;
    const carry = fixtureContent().worldSettings.carry;
    expect(inv).toMatchObject({
      loadKg: 0,
      capacityKg: carry.baseCapacityKg,
      hardLimitKg: carry.baseCapacityKg * carry.hardLimitMultiplier,
      carryLoad: 0,
      equipped: {},
    });
    expect(mainItems(sim)).toEqual([]);
  });

  it('stacks by maxStack and sums weight × count', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 13 });
    sim.step();
    expect(mainItems(sim).map((i) => i.count)).toEqual([10, 3]);
    expect(sim.getInventory()!.loadKg).toBe(26);
    // 26 kg / 12 kg capacity → carry-load 216.7 %, moodle `fixture:carry` on.
    expect(sim.getInventory()!.carryLoad).toBeCloseTo(216.7, 1);
    expect(sim.getSurvival()!.moodles['fixture:carry']).toBe(1);
  });

  it('drop and pick up move stacks via the ground pile; count splits a stack', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 5 });
    sim.step();
    const brick = mainItems(sim)[0]!;
    send(sim, { type: 'drop', item: brick.id, count: 2 });
    sim.step();
    expect(mainItems(sim)[0]!.count).toBe(3);
    const pile = sim.drainView()!.nearby!.find((c) => c.kind === 'ground')!;
    const ground = sim.getContainer(pile.id)!;
    expect(ground.items).toEqual([expect.objectContaining({ def: 'fixture:brick', count: 2 })]);
    send(sim, { type: 'pickUp', item: ground.items[0]!.id });
    sim.step();
    // Merged back into the existing stack; the empty pile is gone.
    expect(mainItems(sim)).toEqual([expect.objectContaining({ id: brick.id, count: 5 })]);
    expect(sim.getContainer(pile.id)).toBeUndefined();
  });

  it('carry hard limit: nothing heavier can be picked up; overload slows movement (moodle)', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 12 });
    sim.step();
    const stack = mainItems(sim).find((i) => i.count === 2)!;
    send(sim, { type: 'drop', item: stack.id });
    sim.step();
    const pile = sim.getInventory()!;
    expect(pile.loadKg).toBe(20);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 2 });
    sim.step();
    const ground = sim.drainView()!.nearby!.find((c) => c.kind === 'ground')!;
    // 24 kg carried = hard limit (12 × 2); one more brick does not fit.
    const onGround = sim.getContainer(ground.id)!.items[0]!;
    send(sim, { type: 'pickUp', item: onGround.id, count: 1 });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['no-space']);

    const light = itemsSim();
    const heavy = itemsSim();
    send(heavy, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 7 });
    for (const s of [light, heavy]) send(s, { type: 'move', dx: 1, dy: 0 });
    runMinutes(light, 0.2);
    runMinutes(heavy, 0.2);
    expect(heavy.getPlayer()!.x).toBeLessThan(light.getPlayer()!.x);
  });

  it('a worn bag reduces the weight of its contents (weightReductionPct), a held one does not', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:backpack' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 4 });
    sim.step();
    const pack = findItem(sim, 'fixture:backpack')!;
    const bricks = findItem(sim, 'fixture:brick')!;
    send(sim, { type: 'moveItem', item: bricks.id, to: pack.container! });
    sim.step();
    expect(sim.getInventory()!.loadKg).toBe(9); // 1 kg bag + 8 kg bricks, not worn
    send(sim, { type: 'equip', item: pack.id, slot: 'back' });
    sim.step();
    expect(sim.getInventory()!.loadKg).toBe(5); // 1 + 8 × (1 − 0.5)
    expect(sim.getInventory()!.equipped).toEqual({ back: pack.id });
    expect(findItem(sim, 'fixture:backpack')!.equipped).toEqual(['back']);
    // Capacity 10 kg: a 5th and 6th brick (12 kg) do not fit.
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 2 });
    sim.step();
    const more = mainItems(sim).find((i) => i.def === 'fixture:brick')!;
    send(sim, { type: 'moveItem', item: more.id, to: pack.container! });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['no-space']);
    // Backpacks only go on the back (bag.slots).
    send(sim, { type: 'equip', item: pack.id, slot: 'hand_primary' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
  });

  it('a full worn bag slows movement by bag.movementPenalty', () => {
    const empty = itemsSim();
    const full = itemsSim();
    for (const sim of [empty, full]) {
      send(sim, { type: 'debugGiveItem', itemId: 'fixture:backpack' });
      sim.step();
      const pack = findItem(sim, 'fixture:backpack')!;
      send(sim, { type: 'equip', item: pack.id, slot: 'back' });
      if (sim === full) {
        send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick', count: 5 });
        sim.step();
        send(sim, {
          type: 'moveItem',
          item: findItem(sim, 'fixture:brick')!.id,
          to: pack.container!,
        });
      }
      sim.step();
    }
    // Both 6 kg or less carried (below capacity): only the bag penalty differs.
    expect(full.getInventory()!.loadKg).toBe(6);
    const x0 = full.getPlayer()!.x;
    for (const sim of [empty, full]) send(sim, { type: 'move', dx: 1, dy: 0 });
    runMinutes(empty, 0.2);
    runMinutes(full, 0.2);
    const dEmpty = empty.getPlayer()!.x - x0;
    const dFull = full.getPlayer()!.x - x0;
    // Bag penalty × 0.8; the 6 kg also add a little inertia (slower start, physics).
    expect(dFull / dEmpty).toBeLessThanOrEqual(0.8);
    expect(dFull / dEmpty).toBeGreaterThan(0.77);
  });

  it('bag tags (acceptsTags) and no bag inside itself', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:ammo-pouch' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:ammo-9', count: 20 });
    sim.step();
    const pouch = findItem(sim, 'fixture:ammo-pouch')!;
    send(sim, { type: 'moveItem', item: findItem(sim, 'fixture:brick')!.id, to: pouch.container! });
    send(sim, { type: 'moveItem', item: pouch.id, to: pouch.container! });
    send(sim, {
      type: 'moveItem',
      item: findItem(sim, 'fixture:ammo-9')!.id,
      to: pouch.container!,
    });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['no-space', 'invalid-target']);
    expect(sim.getContainer(pouch.container!)!.items).toEqual([
      expect.objectContaining({ def: 'fixture:ammo-9', count: 20 }),
    ]);
  });

  it('long and two-handed weapons fit on the back alongside a bag, but short weapons do not', async () => {
    const { baseContent } = await import('../test/content-fixtures.js');
    const sim = itemsSim(await baseContent());
    send(sim, { type: 'debugGiveItem', itemId: 'base:school-backpack' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:pump-shotgun' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:kitchen-knife' });
    sim.step();
    const bag = findItem(sim, 'base:school-backpack')!;
    const shotgun = findItem(sim, 'base:pump-shotgun')!;
    const knife = findItem(sim, 'base:kitchen-knife')!;

    send(sim, { type: 'equip', item: bag.id, slot: 'back' });
    send(sim, { type: 'equip', item: shotgun.id, slot: 'back' });
    sim.step();
    expect(sim.getInventory()!.equipped.back).toBe(shotgun.id);
    expect(findItem(sim, 'base:school-backpack')!.equipped).toEqual(['back']);
    expect(findItem(sim, 'base:pump-shotgun')!.equipped).toEqual(['back']);
    expect(sim.drainView()!.characters![0]!.equippedBack).toBe('base:pump-shotgun');

    send(sim, { type: 'equip', item: knife.id, slot: 'back' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
    expect(sim.getInventory()!.equipped.back).toBe(shotgun.id);
  });

  it('two-handed items take both hands; equipping displaces; unequip and drop clear slots', async () => {
    const { baseContent } = await import('../test/content-fixtures.js');
    const sim = itemsSim(await baseContent());
    send(sim, { type: 'debugGiveItem', itemId: 'base:kitchen-knife' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:pump-shotgun' });
    sim.step();
    const knife = findItem(sim, 'base:kitchen-knife')!;
    const gun = findItem(sim, 'base:pump-shotgun')!;
    send(sim, { type: 'equip', item: knife.id, slot: 'hand_secondary' });
    sim.step();
    expect(sim.getInventory()!.equipped).toEqual({ hand_secondary: knife.id });
    send(sim, { type: 'equip', item: gun.id, slot: 'hand_primary' });
    sim.step();
    expect(sim.getInventory()!.equipped).toEqual({ hand_primary: gun.id, hand_secondary: gun.id });
    send(sim, { type: 'equip', item: knife.id, slot: 'hand_primary' });
    sim.step();
    // The gun needs both hands, so it leaves both.
    expect(sim.getInventory()!.equipped).toEqual({ hand_primary: knife.id });
    send(sim, { type: 'drop', item: knife.id });
    send(sim, { type: 'unequip', slot: 'back' });
    sim.step();
    expect(sim.getInventory()!.equipped).toEqual({});
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
  });

  it('only items within reach (1.5 tiles) can be taken', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick' });
    sim.step();
    const brick = findItem(sim, 'fixture:brick')!;
    send(sim, { type: 'drop', item: brick.id });
    send(sim, { type: 'move', dx: 1, dy: 0 });
    runMinutes(sim, 0.5);
    send(sim, { type: 'move', dx: 0, dy: 0 });
    send(sim, { type: 'pickUp', item: brick.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['out-of-range']);
    send(sim, { type: 'pickUp', item: 99_999 });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['no-item']);
  });
});
