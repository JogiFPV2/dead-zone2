import type { SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { aiSim, eventsOf, runTicks } from '../test/ai-fixtures.js';
import { send } from '../test/content-fixtures.js';
import { progressOf } from '../progress/skills.js';
import { twoHanded } from '../items/inventory.js';
import type { Sim } from '../sim.js';

const DEAF = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

function hold(sim: Sim, itemId: string, count?: number): number {
  send(sim, { type: 'debugGiveItem', itemId, ...(count ? { count } : {}) });
  sim.step();
  const item = sim.getInventory()!.containers![0]!.items.find((i) => i.def === itemId)!.id;
  send(sim, { type: 'equip', item, slot: 'hand_primary' });
  send(sim, { type: 'aim', x: 12, y: 10.5 });
  sim.step();
  return item;
}

function lastCombat(sim: Sim) {
  let c;
  for (let v = sim.drainView(); v; v = sim.drainView()) c = v.combat ?? c;
  return c;
}

function xpOf(sim: Sim, skill: string): number {
  const w = sim.world;
  const i = w.items!.content.skillIndex.get(skill)!;
  return progressOf(w, w.players.get(0)!)!.xp[i] ?? 0;
}

describe('combat: improvised melee (any item in hand)', () => {
  it('a brick hits with weak default stats from its weight and shows them in the view', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    hold(sim, 'fixture:brick');
    const c = lastCombat(sim);
    expect(c).toMatchObject({
      weapon: 'fixture:brick',
      condition: 10,
      maxCondition: 10,
      melee: {
        source: 'default',
        damage: { min: 2, max: 4 },
        rangeTiles: 0.6,
        twoHanded: false,
        skill: 'base:blunt',
        breakChancePct: 30,
        conditionPct: 100,
      },
    });
    send(sim, { type: 'attack' });
    sim.step();
    const hits = eventsOf(sim.drainEvents(), 'hit').filter((h) => h.source === 'melee');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.damage).toBeGreaterThanOrEqual(2);
    expect(hits[0]!.damage).toBeLessThanOrEqual(4.5);
    expect(sim.getSurvival()!.stats.endurance).toBeLessThan(100);
  });

  it('wears with hits; a stack loses one piece, a single item disappears', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    const id = hold(sim, 'fixture:brick', 2);
    const st = sim.world.items!;
    const all: SimEvent[] = [];
    const swingUntil = (pred: () => boolean) => {
      for (let i = 0; i < 400 && !pred(); i++) {
        send(sim, { type: 'debugStat', stat: 'health', value: 100 });
        // Zombie hits push the player back: stay in reach.
        const pe = sim.world.players.get(0)!;
        if (sim.getZombies().length === 0) {
          send(sim, { type: 'debugSpawnZombie', x: 11.2, y: 10.5 });
          sim.step();
        }
        const zx = sim.getZombies()[0]!.x;
        sim.world.c.Position.x[pe] = zx - 0.6;
        send(sim, { type: 'aim', x: zx + 1, y: 10.5 });
        send(sim, { type: 'attack' });
        sim.step();
        all.push(...sim.drainEvents());
      }
    };
    // Normal wear: some hits cost a point (30 % chance), visible in the view.
    swingUntil(() => (st.items.get(id)!.wear ?? 0) > 0);
    expect(st.items.get(id)!.wear).toBe(1);
    expect(lastCombat(sim)).toMatchObject({ condition: 9, melee: { conditionPct: 90 } });
    // Last point of a stack of 2: one brick goes, the other stays in hand, fresh.
    st.items.get(id)!.wear = 9;
    swingUntil(() => st.items.get(id)!.count === 1);
    expect(st.items.get(id)).toMatchObject({ count: 1 });
    expect(st.items.get(id)!.wear).toBeUndefined();
    expect(eventsOf(all, 'weaponBroke')).toEqual([
      expect.objectContaining({ itemId: 'fixture:brick' }),
    ]);
    // Last point of a single item: it disappears.
    st.items.get(id)!.wear = 9;
    swingUntil(() => !st.items.has(id));
    expect(st.items.has(id)).toBe(false);
    expect(eventsOf(all, 'weaponBroke')).toHaveLength(2);
    expect(lastCombat(sim)).toMatchObject({ weapon: null, melee: { source: 'unarmed' } });
  });

  it('the target card shows the improvised weapon condition', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    const id = hold(sim, 'fixture:brick');
    sim.world.items!.items.get(id)!.wear = 5;
    send(sim, { type: 'aim', x: 11.3, y: 10.5 });
    sim.step();
    let target;
    for (let v = sim.drainView(); v; v = sim.drainView()) target = v.target ?? target;
    expect(target).toMatchObject({ weapon: { id: 'fixture:brick', conditionPct: 50 } });
  });

  it('melee hits give XP to the weapon skill', () => {
    const sim = aiSim({ zombies: [{ x: 11.4, y: 10.5 }], aiConfig: DEAF });
    hold(sim, 'fixture:bat');
    expect(xpOf(sim, 'fixture:blunt')).toBe(0);
    send(sim, { type: 'attack' });
    sim.step();
    expect(xpOf(sim, 'fixture:blunt')).toBeGreaterThan(0);
  });

  it('heavy items (≥ 5 kg) are held with both hands', () => {
    const sim = aiSim({ aiConfig: DEAF });
    const id = hold(sim, 'fixture:brick');
    const st = sim.world.items!;
    const item = st.items.get(id)!;
    expect(twoHanded(st, item)).toBe(false);
    expect(lastCombat(sim)?.melee?.twoHanded).toBe(false);
    const def = st.content.items[item.def]!;
    const heavy = {
      ...st,
      content: {
        ...st.content,
        items: st.content.items.map((d) => (d === def ? { ...d, weightKg: 6 } : d)),
      },
    };
    expect(twoHanded(heavy as typeof st, item)).toBe(true);
  });

  it('wear survives save/load and is part of the hash', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    const id = hold(sim, 'fixture:brick');
    const st = sim.world.items!;
    const h0 = sim.hash();
    st.items.get(id)!.wear = 3;
    st.version++;
    const h1 = sim.hash();
    expect(h1).not.toBe(h0);
    runTicks(sim, 1);
    const sim2 = aiSim({ aiConfig: DEAF, load: sim.save() });
    expect(sim2.world.items!.items.get(id)?.wear).toBe(3);
    expect(sim2.hash()).toBe(sim.hash());
  });
});
