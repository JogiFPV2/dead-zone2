import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { aiSim, eventsOf } from '../test/ai-fixtures.js';
import { send } from '../test/content-fixtures.js';
import type { Sim } from '../sim.js';

const DEAF = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

function give(sim: Sim, itemId: string): number {
  send(sim, { type: 'debugGiveItem', itemId });
  sim.step();
  return sim.getInventory()!.containers![0]!.items.find((i) => i.def === itemId)!.id;
}

function handOf(sim: Sim) {
  const w = sim.world;
  return w.items!.players.get(w.c.StableId.value[w.players.get(0)!]!)!.activeHand;
}

function lastCombat(sim: Sim) {
  let c;
  for (let v = sim.drainView(); v; v = sim.drainView()) c = v.combat ?? c;
  return c;
}

describe('combat: left and right hand (quick slots 1 and 2)', () => {
  it('attacks with the item in the active hand; the right hand is the default', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    const brick = give(sim, 'fixture:brick');
    send(sim, { type: 'equip', item: brick, slot: 'hand_secondary' });
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    sim.step();
    // Right hand active and empty: bare hands.
    expect(lastCombat(sim)).toMatchObject({ weapon: null, melee: { source: 'unarmed' } });
    expect(sim.getInventory()!.activeHand).toBeUndefined();

    send(sim, { type: 'setActiveHand', hand: 'hand_secondary' });
    sim.step();
    expect(sim.getInventory()!.activeHand).toBe('hand_secondary');
    expect(lastCombat(sim)).toMatchObject({
      weapon: 'fixture:brick',
      melee: { source: 'default' },
    });
    send(sim, { type: 'attack' });
    sim.step();
    const hits = eventsOf(sim.drainEvents(), 'hit').filter((h) => h.source === 'melee');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.damage).toBeGreaterThanOrEqual(2);

    send(sim, { type: 'setActiveHand', hand: 'hand_primary' });
    sim.step();
    expect(sim.getInventory()!.activeHand).toBeUndefined();
    expect(lastCombat(sim)).toMatchObject({ weapon: null });
  });

  it('the active hand is part of the world hash and survives save/load', () => {
    const a = aiSim({ aiConfig: DEAF });
    const b = aiSim({ aiConfig: DEAF });
    send(a, { type: 'setActiveHand', hand: 'hand_secondary' });
    a.step();
    b.step();
    expect(handOf(a)).toBe('hand_secondary');
    expect(a.hash()).not.toBe(b.hash());
    const c = aiSim({ aiConfig: DEAF, load: a.save() });
    expect(handOf(c)).toBe('hand_secondary');
    a.step();
    c.step();
    expect(c.hash()).toBe(a.hash());
  });

  it('a harmless item (tissue) only pushes: no damage, no wear, the zombie turns on the player', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    const tissue = give(sim, 'fixture:tissue');
    send(sim, { type: 'equip', item: tissue, slot: 'hand_primary' });
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    sim.step();
    expect(lastCombat(sim)).toMatchObject({
      weapon: 'fixture:tissue',
      melee: { damage: { min: 0, max: 0 }, breakChancePct: 0 },
    });
    const zid = sim.getZombies()[0]!.stableId;
    const hp = () => {
      const w = sim.world;
      for (const [eid, is] of w.c.Zombie.is.entries())
        if (is === 1 && w.c.StableId.value[eid] === zid) return w.c.Zombie.hp[eid];
      return undefined;
    };
    const before = hp();
    send(sim, { type: 'attack' });
    sim.step();
    const hits = eventsOf(sim.drainEvents(), 'hit').filter((h) => h.source === 'melee');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.damage).toBe(0);
    expect(hp()).toBe(before);
    expect(sim.world.items!.items.get(tissue)!.wear).toBeUndefined();
  });

  it('quick slots 3–5: pin, move, clear; dropped items show as empty', () => {
    const sim = aiSim({ aiConfig: DEAF });
    const brick = give(sim, 'fixture:brick');
    send(sim, { type: 'setQuickSlot', index: 0, item: brick });
    sim.step();
    expect(sim.getInventory()!.quickSlots).toEqual([brick, null, null]);
    send(sim, { type: 'setQuickSlot', index: 2, item: brick });
    sim.step();
    expect(sim.getInventory()!.quickSlots).toEqual([null, null, brick]);
    send(sim, { type: 'drop', item: brick });
    sim.step();
    expect(sim.getInventory()!.quickSlots).toEqual([null, null, null]);
    send(sim, { type: 'setQuickSlot', index: 2 });
    sim.step();
    expect(sim.getInventory()!.quickSlots).toBeUndefined();
  });
});

