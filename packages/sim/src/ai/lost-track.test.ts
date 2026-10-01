import { describe, expect, it } from 'vitest';
import { send, fixtureContent } from '../test/content-fixtures.js';
import { aiSim, runTicks, zombie } from '../test/ai-fixtures.js';
import { sortedQuery } from '../core/world.js';
import type { Sim } from '../sim.js';
import { ZombieState } from './state.js';
import { secToTicks } from './zombies.js';

/** Closed room x/y ∈ [20, 30) without any opening: the zombie outside can neither see nor enter. */
const closedRoom = {
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
};

/** Player in the closed room, zombie 12.5 tiles west of it, already chasing (as if it had seen). */
function setup(worldSettings: object = {}): Sim {
  const sim = aiSim({
    spawn: { x: 25.5, y: 25.5 },
    zombies: [{ x: 13, y: 25.5 }],
    map: closedRoom,
    content: fixtureContent(worldSettings),
  });
  const w = sim.world;
  const zid = sortedQuery(w, 'zombies', [w.c.Zombie])[0]!;
  const pid = w.players.get(0)!;
  const Z = w.c.Zombie;
  Z.state[zid] = ZombieState.chase;
  Z.targetId[zid] = w.c.StableId.value[pid] ?? 0;
  Z.tx[zid] = Math.fround(25.5);
  Z.ty[zid] = Math.fround(25.5);
  Z.tz[zid] = 0;
  Z.memoryUntil[zid] = w.tick + secToTicks(w.ai!.cfg.ai.lostTrackSec);
  return sim;
}

/** Ticks until the zombie's state is not `chase` any more (−1 = still chasing after `limit`). */
function ticksUntilLost(sim: Sim, limit: number, each?: (t: number) => void): number {
  for (let t = 0; t < limit; t++) {
    each?.(t);
    sim.step();
    if (zombie(sim).state !== 'chase') return t + 1;
  }
  return -1;
}

describe('ai: losing the track (worldSettings.ai)', () => {
  it('data: lostTrackSec / lostTrackDistM from worldSettings.ai (defaults 10 s, 25 m)', () => {
    expect(setup().world.ai!.cfg.ai).toMatchObject({ lostTrackSec: 10, lostTrackDistTiles: 25 });
    const custom = setup({ ai: { lostTrackSec: 4, lostTrackDistM: 7 } });
    expect(custom.world.ai!.cfg.ai).toMatchObject({ lostTrackSec: 4, lostTrackDistTiles: 7 });
  });

  it('closer than lostTrackDistM the zombie keeps the track although it neither sees nor hears', () => {
    const sim = setup();
    // 12.5 tiles away behind walls, silent (standing still), for 30 s.
    expect(ticksUntilLost(sim, 600)).toBe(-1);
    expect(zombie(sim).targetId).toBe(sim.world.c.StableId.value[sim.world.players.get(0)!]);
  });

  it('farther than lostTrackDistM: lost after lostTrackSec without sight or sound', () => {
    const sim = setup({ ai: { lostTrackDistM: 5 } });
    const t = ticksUntilLost(sim, 600);
    // 10 s = 200 ticks (+ up to one think interval).
    expect(t).toBeGreaterThanOrEqual(200);
    expect(t).toBeLessThanOrEqual(206);
    expect(zombie(sim)).toMatchObject({ state: 'search', targetId: 0 });
  });

  it('hearing the player (noise at its position) keeps the track fresh', () => {
    const sim = setup({ ai: { lostTrackDistM: 5 } });
    // A noise at the player every second for 20 s: never lost meanwhile.
    const noisy = (t: number) => {
      if (t % 20 === 0) send(sim, { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 });
    };
    expect(ticksUntilLost(sim, 400, noisy)).toBe(-1);
    // Silence: lost 10 s after the last noise.
    const t = ticksUntilLost(sim, 600);
    expect(t).toBeGreaterThan(180);
    expect(t).toBeLessThanOrEqual(206);
  });

  it('a noise far from the player does not count as hearing the player', () => {
    const sim = setup({ ai: { lostTrackDistM: 5 } });
    const elsewhere = (t: number) => {
      if (t % 20 === 0) send(sim, { type: 'debugNoise', x: 10.5, y: 10.5, radiusTiles: 40 });
    };
    // The chase is lost on time; the zombie then follows the louder noise elsewhere.
    const t = ticksUntilLost(sim, 600, elsewhere);
    expect(t).toBeGreaterThanOrEqual(200);
    expect(t).toBeLessThanOrEqual(206);
  });

  it('after losing it walks to the last known spot, looks around, then wanders again', () => {
    const sim = setup({ ai: { lostTrackDistM: 5 } });
    expect(ticksUntilLost(sim, 600)).toBeGreaterThan(0);
    const w = sim.world;
    const zid = sortedQuery(w, 'zombies', [w.c.Zombie])[0]!;
    expect(w.c.Zombie.tx[zid]).toBeCloseTo(25.5);
    expect(w.c.Zombie.stateTick[zid]).toBe(0); // still walking there
    const states = new Set<string>();
    for (let i = 0; i < 1200 && !['idle', 'wander'].includes(zombie(sim).state); i++) {
      sim.step();
      states.add(zombie(sim).state);
    }
    expect(states.has('search')).toBe(true);
    expect(['idle', 'wander']).toContain(zombie(sim).state);
  });

  it('is deterministic', () => {
    const run = () => {
      const sim = setup({ ai: { lostTrackDistM: 5 } });
      runTicks(sim, 500);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
