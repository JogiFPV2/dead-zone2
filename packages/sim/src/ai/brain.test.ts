import { describe, expect, it } from 'vitest';
import { send } from '../test/content-fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';
import { aiSim, eventsOf, runTicks, runUntil, zombie } from '../test/ai-fixtures.js';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from './config.js';

const WIDE: Stage4Config = {
  ...DEFAULT_STAGE4_CONFIG,
  vision: { ...DEFAULT_STAGE4_CONFIG.vision, fovHalfAngleDeg: 180 },
};

/** Closed room x/y ∈ [20, 30) with an opening in the west wall at y = 25. */
const room = (door: boolean) => ({
  wallW: (x: number, y: number) =>
    (x === 20 || x === 30) && y >= 20 && y < 30 && !(door && x === 20 && y === 25),
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
});
const inside = (x: number, y: number) => x > 20 && x < 30 && y > 20 && y < 30;

describe('ai: chase and losing the target', () => {
  it('chases, loses the running player, searches, then idles', () => {
    const sim = aiSim({ zombies: [{ x: 16.5, y: 10.5 }], aiConfig: WIDE });
    runTicks(sim, 8);
    expect(zombie(sim).state).toBe('chase');
    // Run away west then south, out of the 16-tile sight range (run 4.8 > chase 2 tiles/s).
    send(sim, { type: 'move', dx: -0.2, dy: 1, gait: 'run' });
    const states = new Set<string>();
    for (let i = 0; i < 600; i++) {
      sim.step();
      states.add(zombie(sim).state);
    }
    expect(states.has('search')).toBe(true);
    expect(
      runUntil(sim, () => ['idle', 'wander'].includes(zombie(sim).state), 400),
    ).toBeGreaterThanOrEqual(0);
    expect(zombie(sim).targetId).toBe(0);
  });

  it('stops at reach and faces the player (no attacks before combat)', () => {
    const sim = aiSim({ zombies: [{ x: 14.5, y: 10.5 }], aiConfig: WIDE });
    runTicks(sim, 100);
    const z = zombie(sim);
    const p = sim.getPlayer()!;
    const d = Math.sqrt((z.x - p.x) ** 2 + (z.y - p.y) ** 2);
    expect(z.state).toBe('chase');
    expect(d).toBeLessThan(DEFAULT_STAGE4_CONFIG.ai.reachTiles + 0.35);
    expect(d).toBeGreaterThan(0.5);
    expect(sim.getSurvival()!.stats.health).toBe(100);
  });
});

describe('ai: walls and paths', () => {
  it('zombies never pass walls: a player in a closed room is safe (seen through a window)', () => {
    const sim = aiSim({
      spawn: { x: 25.5, y: 25.5 },
      zombies: [
        { x: 12.5, y: 25.5 },
        { x: 25.5, y: 12.5 },
      ],
      aiConfig: WIDE,
      map: {
        ...room(false),
        edgeId: (x, y) => (x === 20 && y === 25 ? 2 : 1),
        edgeKinds: [null, 'wall', 'window'],
      },
    });
    let chased = false;
    for (let i = 0; i < 1200; i++) {
      sim.step();
      for (const z of sim.getZombies()) {
        expect(inside(z.x, z.y)).toBe(false);
        chased ||= z.state === 'chase';
      }
    }
    expect(chased).toBe(true);
  });

  it('A* / flow field lead through the opening into the room', () => {
    const sim = aiSim({
      spawn: { x: 25.5, y: 25.5 },
      zombies: [{ x: 35.5, y: 25.5 }],
      map: room(true),
    });
    send(sim, { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 });
    const t = runUntil(sim, () => inside(zombie(sim).x, zombie(sim).y), 1500);
    expect(t).toBeGreaterThan(0);
  });
});

describe('ai: threat', () => {
  it('a chasing zombie blocks speed-up and sleep, interrupts actions and shows in the view', () => {
    const sim = aiSim({ zombies: [{ x: 20.5, y: 10.5 }], aiConfig: WIDE });
    expect(sim.fastForwardBlocked()).toBe(false);
    sim.drainView();
    send(sim, { type: 'debugStat', stat: 'hunger', value: 50 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    runTicks(sim, 8);
    expect(zombie(sim).state).toBe('chase');
    expect(sim.fastForwardBlocked()).toBe(true);
    expect(sim.threatLevel()).toBe(25);
    expect(sim.drainView()).toMatchObject({ threat: 25, clock: { fastForwardBlocked: true } });
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 80 });
    send(sim, { type: 'sleep' });
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:apple')!.id });
    runTicks(sim, 2);
    const ev = sim.drainEvents();
    expect(eventsOf(ev, 'commandRejected').map((e) => e.reason)).toEqual(['invalid-state']);
    expect(eventsOf(ev, 'actionInterrupted').map((e) => e.reason)).toEqual(['threat']);
  });

  it('a zombie wandering into the radius wakes a sleeper; so does a loud noise', () => {
    const sim = aiSim({ zombies: [{ x: 50.5, y: 50.5 }] });
    send(sim, { type: 'debugStat', stat: 'fatigue', value: 80 });
    send(sim, { type: 'sleep' });
    runTicks(sim, 2);
    expect(sim.getSurvival()!.sleeping).toBe(true);
    send(sim, { type: 'debugNoise', x: 12.5, y: 10.5, radiusTiles: 5, volume: 0.1 });
    runTicks(sim, 2);
    expect(sim.getSurvival()!.sleeping).toBe(true);
    send(sim, { type: 'debugNoise', x: 12.5, y: 10.5, radiusTiles: 5, volume: 0.9 });
    runTicks(sim, 2);
    expect(sim.getSurvival()!.sleeping).toBe(false);
    expect(eventsOf(sim.drainEvents(), 'wokeUp').map((e) => e.reason)).toEqual(['noise']);
    send(sim, { type: 'sleep' });
    send(sim, { type: 'debugSpawnZombie', x: 14.5, y: 10.5 });
    runTicks(sim, 2);
    expect(eventsOf(sim.drainEvents(), 'wokeUp').map((e) => e.reason)).toEqual(['zombie']);
    expect(rejectedReasons(sim)).toEqual([]);
  });
});
