import {
  SNAPSHOT_ENTITY_STRIDE,
  SnapshotAnim,
  SnapshotField,
  type SimEvent,
} from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { aiSim, eventsOf, runTicks, zombie } from '../test/ai-fixtures.js';
import { send } from '../test/content-fixtures.js';
import type { Sim } from '../sim.js';

/** Zombies that never move on their own (senses off), so fights are placed by hand. */
const DEAF = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

function aimAt(sim: Sim, x: number, y: number): void {
  send(sim, { type: 'aim', x, y });
}

function attackUntil(sim: Sim, pred: () => boolean, limit = 400): void {
  for (let i = 0; i < limit && !pred(); i++) {
    send(sim, { type: 'attack' });
    sim.step();
  }
}

describe('combat: player melee', () => {
  it('bare hands hit a zombie in front until it dies; corpse stays in the snapshot', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    aimAt(sim, 12, 10.5);
    sim.step();
    const sid = zombie(sim).stableId;
    const all: SimEvent[] = [];
    let n = 0;
    while (sim.getZombies().length > 0 && n++ < 3000) {
      send(sim, { type: 'attack' });
      sim.step();
      all.push(...sim.drainEvents());
    }
    expect(sim.getZombies()).toEqual([]);
    const hits = eventsOf(all, 'hit').filter((h) => h.source === 'melee');
    expect(hits.length).toBeGreaterThan(5);
    expect(hits.every((h) => h.target === sid && h.damage >= 1 && h.damage <= 3)).toBe(true);
    expect(eventsOf(all, 'zombieKilled')).toEqual([expect.objectContaining({ zombie: sid })]);
    // Cooldown: attacks are rejected as busy between swings.
    expect(eventsOf(all, 'commandRejected').some((e) => e.reason === 'busy')).toBe(true);
    const snap = new Float32Array(sim.snapshot());
    const o = SNAPSHOT_ENTITY_STRIDE;
    expect(snap[o + SnapshotField.stableId]).toBe(sid);
    expect(snap[o + SnapshotField.anim]).toBe(SnapshotAnim.dead);
    expect(sim.drainView()?.combat?.zombiesKilled).toBe(1);
  });

  it('a weapon from data: damage, knockback, wear until it breaks', () => {
    const sim = aiSim({ zombies: [{ x: 11.4, y: 10.5 }], aiConfig: DEAF });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:bat' });
    sim.step();
    const item = sim.getInventory()!.containers![0]!.items[0]!.id;
    send(sim, { type: 'equip', item, slot: 'hand_primary' });
    aimAt(sim, 12, 10.5);
    sim.step();
    const x0 = zombie(sim).x;
    send(sim, { type: 'attack' });
    sim.step();
    const ev = sim.drainEvents();
    expect(eventsOf(ev, 'hit')[0]).toMatchObject({ source: 'melee', damage: 30, killed: false });
    expect(zombie(sim).hp).toBe(20);
    expect(zombie(sim).x).toBeGreaterThan(x0 + 0.3);
    // Stamina spent.
    expect(sim.getSurvival()!.stats.endurance).toBeLessThan(100);
    // Durability 2, loss chance 1: the second hit (a kill) breaks it.
    const all: SimEvent[] = [];
    attackUntil(sim, () => {
      all.push(...sim.drainEvents());
      return sim.getZombies().length === 0;
    });
    expect(eventsOf(all, 'zombieKilled')).toHaveLength(1);
    expect(eventsOf(all, 'weaponBroke')).toEqual([
      expect.objectContaining({ itemId: 'fixture:bat' }),
    ]);
    expect(sim.drainView()?.combat).toMatchObject({ zombiesKilled: 1, weapon: null });
  });

  it('shove pushes and staggers without damage', () => {
    const sim = aiSim({ zombies: [{ x: 11.2, y: 10.5 }], aiConfig: DEAF });
    aimAt(sim, 12, 10.5);
    sim.step();
    const x0 = zombie(sim).x;
    send(sim, { type: 'shove' });
    sim.step();
    const hits = eventsOf(sim.drainEvents(), 'hit');
    expect(hits).toEqual([expect.objectContaining({ source: 'shove', damage: 0 })]);
    expect(zombie(sim).x).toBeGreaterThan(x0 + 0.5);
    expect(zombie(sim).hp).toBe(50);
  });

  it('swings miss zombies behind the player', () => {
    const sim = aiSim({
      zombies: [{ x: 9.7, y: 10.5 }],
      aiConfig: DEAF,
    });
    aimAt(sim, 12, 10.5);
    sim.step();
    send(sim, { type: 'attack' });
    sim.step();
    expect(eventsOf(sim.drainEvents(), 'hit').filter((h) => h.source === 'melee')).toEqual([]);
  });
});

describe('combat: zombie attacks', () => {
  it('a zombie in reach wounds the player; death by zombie reports days survived and kills', () => {
    const sim = aiSim({ zombies: [{ x: 11.2, y: 10.5 }], clock: { day: 3, hour: 12, minute: 0 } });
    runTicks(sim, 5);
    send(sim, { type: 'debugStat', stat: 'health', value: 30 });
    const all: SimEvent[] = [];
    for (let i = 0; i < 2000 && sim.getSurvival()!.alive; i++) {
      sim.step();
      all.push(...sim.drainEvents());
    }
    expect(sim.getSurvival()!.alive).toBe(false);
    const zh = eventsOf(all, 'hit').filter((h) => h.source === 'zombie');
    expect(zh.length).toBeGreaterThan(0);
    expect(eventsOf(all, 'wounded').length).toBe(zh.length);
    const died = eventsOf(all, 'died')[0]!;
    expect(died).toMatchObject({ cause: 'zombie', daysSurvived: 0, zombiesKilled: 0 });
    let death;
    for (let v = sim.drainView(); v; v = sim.drainView()) death ??= v.death;
    expect(death).toMatchObject({ cause: 'zombie', day: 3, daysSurvived: 0 });
  });

  it('is deterministic (same seed → same hash; the fight changes the hash)', () => {
    const run = (attack: boolean) => {
      const sim = aiSim({
        zombies: [
          { x: 12.5, y: 10.5 },
          { x: 8.5, y: 11.5 },
        ],
        seed: 5,
      });
      // Own seq per sim: the queued commands (with seq) are part of the hash.
      let seq = 0;
      const cmd = (
        c: { type: 'attack' } | { type: 'shove' } | { type: 'aim'; x: number; y: number },
      ) => sim.enqueue({ ...c, tick: sim.tick, playerId: 0, seq: seq++ });
      for (let t = 0; t < 600; t++) {
        if (t % 7 === 0) cmd({ type: 'aim', x: 12, y: 10.5 + (t % 3) - 1 });
        if (attack && t % 5 === 0) cmd({ type: t % 35 === 0 ? 'shove' : 'attack' });
        sim.step();
      }
      return sim.hash();
    };
    expect(run(true)).toBe(run(true));
    expect(run(true)).not.toBe(run(false));
  });
});
