import { describe, expect, it } from 'vitest';
import { sortedQuery } from '../core/world.js';
import type { Sim } from '../sim.js';
import { refreshTrack } from './brain.js';
import { ZombieState } from './state.js';
import { aiSim, zombie } from '../test/ai-fixtures.js';
import { fixtureContent, send } from '../test/content-fixtures.js';

/**
 * Escape scenarios (Paweł: zombies chased for too long). Fixture walker: sight 16, hearing 30,
 * chase 2 tiles/s; the player runs at 3.75 m/s. Data defaults: lost after 12 s ± 20 % without
 * sight or sound (× 0.6 out of line of sight / in cover), then 2–5 s of looking around.
 */
type Leg = { x: number; y: number; gait: 'run' | 'walk' | 'sneak' };

interface Trace {
  /** Tick the chase started / ended (−1 = never). */
  chased: number;
  lost: number;
  /** Tick the zombie was back to idle / wander after the chase (−1 = never). */
  calm: number;
  minDist: number;
}

function drive(sim: Sim, legs: Leg[], ticks: number): Trace {
  let leg = 0;
  let sentLeg = -1;
  const tr: Trace = { chased: -1, lost: -1, calm: -1, minDist: Infinity };
  for (let t = 0; t < ticks; t++) {
    const p = sim.getPlayer()!;
    const l = legs[leg];
    if (l && Math.sqrt((l.x - p.x) ** 2 + (l.y - p.y) ** 2) < 0.4) leg++;
    const cur = legs[leg];
    if (!cur) {
      if (sentLeg !== legs.length) send(sim, { type: 'move', dx: 0, dy: 0 });
      sentLeg = legs.length;
    } else if (t % 5 === 0 || sentLeg !== leg) {
      const dx = cur.x - p.x;
      const dy = cur.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      send(sim, { type: 'move', dx: dx / d, dy: dy / d, gait: cur.gait });
      sentLeg = leg;
    }
    // Endless endurance: the test is about senses, not stamina.
    if (t % 20 === 0) send(sim, { type: 'debugStat', stat: 'endurance', value: 100 });
    sim.step();
    const z = zombie(sim);
    const q = sim.getPlayer()!;
    tr.minDist = Math.min(tr.minDist, Math.sqrt((z.x - q.x) ** 2 + (z.y - q.y) ** 2));
    if (z.state === 'chase' && tr.chased < 0) tr.chased = t;
    if (tr.chased >= 0 && tr.lost < 0 && z.state !== 'chase') tr.lost = t;
    if (tr.lost >= 0 && tr.calm < 0 && (z.state === 'idle' || z.state === 'wander')) tr.calm = t;
  }
  return tr;
}

describe('ai: escaping a chasing zombie', () => {
  it('open field: out of sight range and earshot → lost, back to wandering', () => {
    const sim = aiSim({
      map: { width: 320, height: 64 },
      spawn: { x: 30.5, y: 32.5 },
      zombies: [{ x: 22.5, y: 32.5 }],
    });
    const tr = drive(sim, [{ x: 300.5, y: 32.5, gait: 'run' }], 20 * 70);
    expect(tr.chased).toBeGreaterThanOrEqual(0);
    expect(tr.lost).toBeGreaterThan(tr.chased);
    // Out of sight (16 tiles) after ~5 s of running; at most 12 s × 1.2 more (+ think intervals).
    expect(tr.lost - tr.chased).toBeLessThan(20 * 25);
    expect(tr.calm).toBeGreaterThan(tr.lost);
    expect(tr.calm - tr.lost).toBeLessThan(20 * 20);
    expect(zombie(sim).state).not.toBe('chase');
  });

  it('around a corner: the zombie does not follow the player behind the wall', () => {
    // Wall along x = 50 for y < 30: the player runs past its south end, north behind it, then east.
    const map = {
      width: 128,
      height: 64,
      wallW: (x: number, y: number) => x === 50 && y < 30,
    };
    const legs: Leg[] = [
      { x: 52.5, y: 33.5, gait: 'run' },
      { x: 53.5, y: 6.5, gait: 'run' },
      { x: 120.5, y: 6.5, gait: 'run' },
    ];
    const run = (coverMul: number) => {
      const sim = aiSim({
        map,
        spawn: { x: 44.5, y: 33.5 },
        zombies: [{ x: 36.5, y: 33.5 }],
        content: fixtureContent({ ai: { lostTrackCoverMul: coverMul, lostTrackSpread: 0 } }),
      });
      const tr = drive(sim, legs, 20 * 60);
      const z = zombie(sim);
      const p = sim.getPlayer()!;
      return { tr, end: Math.sqrt((z.x - p.x) ** 2 + (z.y - p.y) ** 2), state: z.state };
    };
    const cover = run(0.6);
    expect(cover.tr.chased).toBeGreaterThanOrEqual(0);
    expect(cover.tr.lost).toBeGreaterThan(cover.tr.chased);
    expect(cover.tr.calm).toBeGreaterThan(cover.tr.lost);
    expect(['idle', 'wander', 'search', 'investigate']).toContain(cover.state);
    // It never caught up and ends well away from the hidden player.
    expect(cover.tr.minDist).toBeGreaterThan(1.5);
    expect(cover.end).toBeGreaterThan(8);
    // Out of line of sight shortens the memory: lost no later than without the cover rule.
    const plain = run(1);
    expect(cover.tr.lost).toBeLessThanOrEqual(plain.tr.lost);
  });

  it('dense bushes (zone `bushes`): lost faster than in the open', () => {
    const lostAfter = (zones: boolean) => {
      // Player stands still 20 tiles away in the zombie's line of sight at night (sight 16 × 0.4).
      const sim = aiSim({
        map: {
          width: 128,
          height: 64,
          ...(zones
            ? {
                zones: [
                  { id: 'b1', role: 'bushes', z: 0, rects: [{ x: 40, y: 20, w: 20, h: 20 }] },
                ],
              }
            : {}),
        },
        spawn: { x: 50.5, y: 30.5 },
        zombies: [{ x: 30.5, y: 30.5 }],
        content: fixtureContent({ ai: { lostTrackSpread: 0 } }),
        clock: { day: 1, hour: 0, minute: 0 },
      });
      const w = sim.world;
      const zid = sortedQuery(w, 'zombies', [w.c.Zombie])[0]!;
      w.c.Zombie.state[zid] = ZombieState.chase;
      w.c.Zombie.targetId[zid] = w.c.StableId.value[w.players.get(0)!] ?? 0;
      // Last seen walking west (away from the bushes): it heads there, the player stays put.
      refreshTrack(w, zid, 10.5, 30.5, 0);
      return drive(sim, [], 20 * 30).lost;
    };
    const open = lostAfter(false);
    const bush = lostAfter(true);
    expect(bush).toBeGreaterThan(0);
    expect(bush).toBeLessThan(open);
  });
});
