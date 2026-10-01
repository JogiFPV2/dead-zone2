import { describe, expect, it } from 'vitest';
import { baseContent, runMinutes, send } from '../test/content-fixtures.js';
import { findItem, itemsSim, mainItems, rejectedReasons } from '../test/item-fixtures.js';

describe('using items: eat, drink, bandage, unpack (timed actions)', () => {
  it('eating needs the openWith tool, takes a portion per action and leaves emptyInto', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugStat', stat: 'hunger', value: 50 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:beans' });
    sim.step();
    const beans = findItem(sim, 'fixture:beans')!;
    expect(beans.uses).toBe(2);
    send(sim, { type: 'useItem', item: beans.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['missing-tool']);
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:opener' });
    send(sim, { type: 'useItem', item: beans.id });
    send(sim, { type: 'useItem', item: beans.id });
    sim.step();
    expect(sim.getAction()).toMatchObject({ kind: 'eat', item: beans.id, queued: 1 });
    runMinutes(sim, 1);
    // One portion: hunger −40 / 2 portions.
    expect(sim.getSurvival()!.stats.hunger).toBeCloseTo(30, 1);
    expect(findItem(sim, 'fixture:beans')!.uses).toBe(1);
    runMinutes(sim, 1);
    expect(findItem(sim, 'fixture:beans')).toBeUndefined();
    expect(findItem(sim, 'fixture:can')).toBeDefined();
    expect(sim.getSurvival()!.stats.hunger).toBeCloseTo(10, 1);
    const used = sim.drainEvents().filter((e) => e.type === 'itemUsed');
    expect(used).toEqual([
      expect.objectContaining({ action: 'eat', itemId: 'fixture:beans', freshness: 'fresh' }),
      expect.objectContaining({ action: 'eat', itemId: 'fixture:beans', freshness: 'fresh' }),
    ]);
  });

  it('eating when not hungry turns the rest into satiety', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugStat', stat: 'hunger', value: 5 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    sim.step();
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:apple')!.id });
    runMinutes(sim, 1.1);
    const s = sim.getSurvival()!;
    expect(s.stats.hunger).toBe(0);
    expect(s.stats.satiety).toBeGreaterThan(0);
  });

  it('drinking uses one sip per action; the empty bottle stays', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugStat', stat: 'thirst', value: 60 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:water' });
    sim.step();
    const water = findItem(sim, 'fixture:water')!;
    send(sim, { type: 'useItem', item: water.id });
    send(sim, { type: 'useItem', item: water.id });
    send(sim, { type: 'useItem', item: water.id });
    runMinutes(sim, 1.6);
    expect(sim.getSurvival()!.stats.thirst).toBeCloseTo(20, 0);
    expect(mainItems(sim).map((i) => i.def)).toEqual(['fixture:bottle']);
    // The third drink found no water when it came up in the queue.
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'actionInterrupted',
        action: 'drink',
        reason: 'target-lost',
      }),
    );
  });

  it('bandage via useItem needs a part; the item is consumed at the end', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugWound', part: 'shin_l', wound: 'laceration' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:quick-bandage', count: 3 });
    sim.step();
    const b = findItem(sim, 'fixture:quick-bandage')!;
    send(sim, { type: 'useItem', item: b.id });
    send(sim, { type: 'useItem', item: b.id, part: 'shin_l' });
    runMinutes(sim, 0.1);
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
    expect(sim.getSurvival()!.wounds[0]!.bandaged).toBe(true);
    expect(findItem(sim, 'fixture:quick-bandage')!.count).toBe(2);
  });

  it('unpacking an ammo box yields ammoBox.count rounds, stacked by maxStack', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:ammo-box', count: 2 });
    sim.step();
    const box = findItem(sim, 'fixture:ammo-box')!;
    send(sim, { type: 'useItem', item: box.id });
    send(sim, { type: 'useItem', item: box.id });
    runMinutes(sim, 1.1);
    expect(mainItems(sim).map((i) => `${i.def}×${i.count}`)).toEqual([
      'fixture:ammo-9×50',
      'fixture:ammo-9×10',
    ]);
  });

  it('non-usable items are rejected; sleeping interrupts; dead players cannot act', () => {
    const sim = itemsSim();
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:brick' });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    sim.step();
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:brick')!.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['no-item']);
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:apple')!.id });
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 90 });
    send(sim, { type: 'sleep' });
    sim.step();
    expect(sim.getAction()).toBeNull();
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'actionInterrupted', reason: 'asleep' }),
    );
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:apple')!.id });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-state']);
  });

  it('base pack: canned beans open with a kitchen knife; a bandage takes medical.durationMin', async () => {
    const sim = itemsSim(await baseContent());
    send(sim, { type: 'debugStat', stat: 'hunger', value: 50 });
    send(sim, { type: 'debugGiveItem', itemId: 'base:canned-beans' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:kitchen-knife' });
    send(sim, { type: 'debugGiveItem', itemId: 'base:bandage' });
    send(sim, { type: 'debugWound', part: 'hand_l', wound: 'scratch' });
    sim.step();
    send(sim, { type: 'useItem', item: findItem(sim, 'base:canned-beans')!.id });
    send(sim, { type: 'bandage', part: 'hand_l' });
    sim.step();
    expect(sim.getAction()).toMatchObject({ kind: 'eat', queued: 1 });
    runMinutes(sim, 1.1);
    expect(sim.getSurvival()!.stats.hunger).toBeCloseTo(35, 0);
    expect(sim.getAction()).toMatchObject({ kind: 'bandage', part: 'hand_l' });
    // 3 min, slower with the hand scratch (woundPenalties.actionSpeed).
    runMinutes(sim, 3.5);
    expect(sim.getSurvival()!.wounds[0]!.bandaged).toBe(true);
    expect(findItem(sim, 'base:bandage')).toBeUndefined();
  });
});
