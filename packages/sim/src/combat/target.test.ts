import { TARGET_LAST_HIT_SEC, type TargetView } from '@deadzone/protocol';
import { parseCommand } from '@deadzone/protocol/schema';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STAGE4_CONFIG } from '../ai/config.js';
import { aiSim, eventsOf, runTicks, zombie } from '../test/ai-fixtures.js';
import { animal, animalSim } from '../test/animal-fixtures.js';
import { send } from '../test/content-fixtures.js';
import { car, vehicleSim } from '../test/vehicle-fixtures.js';
import type { Sim } from '../sim.js';

const DEAF = {
  ...DEFAULT_STAGE4_CONFIG,
  ai: { ...DEFAULT_STAGE4_CONFIG.ai, wanderRadiusTiles: 0 },
};

/** Last target sent in view patches (undefined = never sent, null = cleared). */
function tracker(sim: Sim) {
  let last: TargetView | null | undefined;
  return (): TargetView | null | undefined => {
    const v = sim.drainView();
    if (v && 'target' in v) last = v.target;
    return last;
  };
}

const aim = (sim: Sim, x: number, y: number) => send(sim, { type: 'aim', x, y });

describe('target card (docs 9.40)', () => {
  it('hover: the zombie under the aim point, null when aiming at nothing', () => {
    const sim = aiSim({ zombies: [{ x: 14.5, y: 10.5 }], aiConfig: DEAF });
    const target = tracker(sim);
    sim.step();
    expect(target()).toBeUndefined();
    aim(sim, 14.7, 10.6);
    sim.step();
    const t = target()!;
    expect(t).toMatchObject({
      id: zombie(sim).stableId,
      kind: 'zombie',
      typeId: 'fixture:walker',
      name: 'walker',
      hpPct: 100,
      distanceM: 4,
      source: 'aim',
      hitChancePct: 0,
    });
    expect(t.state).toBeDefined();
    expect(t.weapon).toBeUndefined();
    aim(sim, 20, 20);
    sim.step();
    expect(target()).toBeNull();
  });

  it('in reach: 100 % with bare hands; the last one hit stays TARGET_LAST_HIT_SEC, dead = 0 hp', () => {
    const sim = aiSim({ zombies: [{ x: 11.3, y: 10.5 }], aiConfig: DEAF });
    const target = tracker(sim);
    aim(sim, 12, 10.5);
    sim.step();
    expect(target()).toMatchObject({ kind: 'zombie', hitChancePct: 100, source: 'aim' });
    // Hit once, then aim at nothing: the card stays on the last hit.
    for (let i = 0; i < 100; i++) {
      send(sim, { type: 'attack' });
      sim.step();
      if (eventsOf(sim.drainEvents(), 'hit').length > 0) break;
    }
    aim(sim, 3, 3);
    sim.step();
    const t = target()!;
    expect(t.source).toBe('hit');
    expect(t.hpPct).toBeLessThan(100);
    runTicks(sim, TARGET_LAST_HIT_SEC * 20 + 2);
    expect(target()).toBeNull();
    // Kill it: the body shows as dead with 0 hp while it is the last hit.
    aim(sim, 12, 10.5);
    for (let i = 0; i < 3000 && sim.getZombies().length > 0; i++) {
      send(sim, { type: 'attack' });
      sim.step();
    }
    aim(sim, 3, 3);
    sim.step();
    expect(target()).toMatchObject({ source: 'hit', state: 'dead', hpPct: 0 });
    expect(target()!.hitChancePct).toBeUndefined();
  });

  it('setTarget locks (range, line of sight), null clears; rejects unknown / blocked', () => {
    // Wall on the west edge of column 16 (between the player and the far zombie).
    const sim = aiSim({
      zombies: [
        { x: 14.5, y: 10.5 },
        { x: 20.5, y: 10.5 },
      ],
      map: { wallW: (x, y) => x === 16 && y > 5 && y < 15 },
      aiConfig: DEAF,
    });
    const target = tracker(sim);
    sim.step();
    const [near, far] = sim.getZombies().sort((a, b) => a.x - b.x);
    send(sim, { type: 'setTarget', id: near!.stableId });
    aim(sim, 3, 3);
    sim.step();
    expect(target()).toMatchObject({ id: near!.stableId, source: 'lock' });
    send(sim, { type: 'setTarget', id: far!.stableId });
    send(sim, { type: 'setTarget', id: 99999 });
    send(sim, { type: 'setTarget', id: sim.world.c.StableId.value[sim.world.players.get(0)!]! });
    sim.step();
    expect(
      eventsOf(sim.drainEvents(), 'commandRejected').map((e) => [e.command, e.reason]),
    ).toEqual([
      ['setTarget', 'out-of-range'],
      ['setTarget', 'invalid-target'],
      ['setTarget', 'invalid-target'],
    ]);
    expect(target()).toMatchObject({ id: near!.stableId, source: 'lock' });
    send(sim, { type: 'setTarget', id: null });
    sim.step();
    expect(target()).toBeNull();
  });

  it('animal and vehicle cards', () => {
    const a = animalSim({ animals: [{ x: 14.5, y: 10.5, type: 'fixture:rabbit' }] });
    const ta = tracker(a);
    const r = animal(a);
    aim(a, r.x, r.y);
    a.step();
    expect(ta()).toMatchObject({ kind: 'animal', typeId: 'fixture:rabbit', hpPct: 100 });
    const v = vehicleSim();
    const tv = tracker(v);
    const c = car(v);
    aim(v, c.x + 1.5, c.y + 0.5);
    v.step();
    const t = tv()!;
    expect(t).toMatchObject({
      id: c.stableId,
      kind: 'vehicle',
      typeId: 'fixture:sedan',
      hpPct: 100,
    });
    expect(t.hitChancePct).toBeUndefined();
  });

  it('UI only: the same hash with and without targeting; save / load works', () => {
    const run = (lock: boolean) => {
      const sim = aiSim({ zombies: [{ x: 14.5, y: 10.5 }], aiConfig: DEAF });
      sim.step();
      // Same seq in both runs (seq is state); a lock vs a no-op clear.
      sim.enqueue({
        type: 'setTarget',
        id: lock ? zombie(sim).stableId : null,
        tick: sim.tick,
        playerId: 0,
        seq: 1,
      });
      for (let i = 0; i < 40; i++) {
        sim.step();
        sim.drainView();
      }
      return sim;
    };
    const a = run(true);
    const b = run(false);
    expect(a.hash()).toBe(b.hash());
    const c = aiSim({ load: a.save(), aiConfig: DEAF });
    c.step();
    a.step();
    expect(c.hash()).toBe(a.hash());
  });

  it('schema: setTarget {id: StableId | null}', () => {
    const h = { tick: 1, playerId: 0, seq: 1 };
    expect(parseCommand({ ...h, type: 'setTarget', id: 5 }).ok).toBe(true);
    expect(parseCommand({ ...h, type: 'setTarget', id: null }).ok).toBe(true);
    expect(parseCommand({ ...h, type: 'setTarget', id: -1 }).ok).toBe(false);
    expect(parseCommand({ ...h, type: 'setTarget' }).ok).toBe(false);
  });
});
