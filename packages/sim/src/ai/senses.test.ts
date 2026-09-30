import { decodeSnapshot, SnapshotAnim, SnapshotEntityKind } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { send } from '../test/content-fixtures.js';
import { findItem, rejectedReasons } from '../test/item-fixtures.js';
import { MIDNIGHT, aiSim, eventsOf, runTicks, runUntil, zombie } from '../test/ai-fixtures.js';
import { DEFAULT_STAGE4_CONFIG, type Stage4Config } from './config.js';
import { daylight } from './vision.js';

/** All-around sight, so tests do not depend on the random spawn facing. */
const WIDE: Stage4Config = {
  ...DEFAULT_STAGE4_CONFIG,
  vision: { ...DEFAULT_STAGE4_CONFIG.vision, fovHalfAngleDeg: 180 },
};

const holdLantern = (sim: ReturnType<typeof aiSim>): void => {
  send(sim, { type: 'debugGiveItem', itemId: 'fixture:lantern' });
  sim.step();
  send(sim, { type: 'equip', item: findItem(sim, 'fixture:lantern')!.id, slot: 'hand_primary' });
  sim.step();
};

describe('ai: spawn and snapshot', () => {
  it('createSim({ spawnZombies }) and debugSpawnZombie; snapshot kind and anim', () => {
    const sim = aiSim({ zombies: [{ x: 30.5, y: 30.5 }] });
    expect(sim.getZombies()).toMatchObject([
      { type: 'fixture:walker', x: 30.5, y: 30.5, state: 'idle', hp: 50 },
    ]);
    send(sim, { type: 'debugSpawnZombie', x: 40.5, y: 40.5, count: 5 });
    send(sim, { type: 'debugSpawnZombie', x: 40.5, y: 40.5, zombieType: 'fixture:nope' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['unknown-item']);
    const zs = sim.getZombies();
    expect(zs).toHaveLength(6);
    expect(new Set(zs.map((z) => `${z.x},${z.y}`)).size).toBe(6);
    const snap = decodeSnapshot(sim.snapshot());
    expect(snap).toHaveLength(7);
    expect(snap[0]).toMatchObject({ kind: SnapshotEntityKind.player, anim: SnapshotAnim.idle });
    expect(snap.slice(1).every((e) => e.kind === SnapshotEntityKind.zombie)).toBe(true);
    expect(snap.slice(1).map((e) => e.stableId)).toEqual(zs.map((z) => z.stableId));
  });

  it('debug commands need dev mode', () => {
    const sim = aiSim({ dev: false });
    send(sim, { type: 'debugSpawnZombie', x: 5.5, y: 5.5 });
    send(sim, { type: 'debugNoise', x: 5.5, y: 5.5, radiusTiles: 5 });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['dev-only', 'dev-only']);
  });
});

describe('ai: sight', () => {
  it('daylight: 1 by day, nightFactor at night, linear dawn and dusk', () => {
    const v = DEFAULT_STAGE4_CONFIG.vision;
    expect(daylight(v, 12 * 60)).toBe(1);
    expect(daylight(v, 0)).toBe(v.nightFactor);
    expect(daylight(v, 6 * 60)).toBeCloseTo((1 + v.nightFactor) / 2, 6);
    expect(daylight(v, 20 * 60)).toBeCloseTo((1 + v.nightFactor) / 2, 6);
  });

  it('by day a zombie sees the player at 12 tiles and chases', () => {
    const sim = aiSim({ zombies: [{ x: 22.5, y: 10.5 }], aiConfig: WIDE });
    runTicks(sim, 8);
    expect(zombie(sim)).toMatchObject({ state: 'chase', targetId: sim.getPlayer()!.stableId });
    expect(eventsOf(sim.drainEvents(), 'zombieAlerted')).toMatchObject([{ reason: 'sight' }]);
  });

  it('at night the range drops to ~40 %; a lantern in hand gives it back', () => {
    const sim = aiSim({ zombies: [{ x: 22.5, y: 10.5 }], aiConfig: WIDE, clock: MIDNIGHT });
    runTicks(sim, 40);
    expect(zombie(sim).state).not.toBe('chase');
    holdLantern(sim);
    runTicks(sim, 8);
    expect(zombie(sim).state).toBe('chase');
  });

  it('a street lamp lights the player at night', () => {
    const sim = aiSim({
      zombies: [{ x: 22.5, y: 10.5 }],
      aiConfig: WIDE,
      clock: MIDNIGHT,
      map: { objects: [{ contentId: 'fixture:street-lamp', x: 11, y: 11 }] },
    });
    runTicks(sim, 8);
    expect(zombie(sim).state).toBe('chase');
  });

  it('dark zone: invisible up close without light, still heard; a light gives the player away', () => {
    const dark = aiSim({
      zombies: [{ x: 13.5, y: 10.5 }],
      aiConfig: WIDE,
      map: {},
    });
    // Same map with a dark zone around the player.
    const sim = aiSim({
      zombies: [{ x: 13.5, y: 10.5 }],
      aiConfig: WIDE,
      map: { zones: [{ id: 'cellar', role: 'dark', z: 0, rects: [{ x: 5, y: 5, w: 10, h: 10 }] }] },
    });
    runTicks(dark, 8);
    expect(zombie(dark).state).toBe('chase');
    runTicks(sim, 40);
    expect(zombie(sim).state).not.toBe('chase');
    // Heard: walking makes footsteps, the zombie investigates.
    send(sim, { type: 'move', dx: 0, dy: 1 });
    runTicks(sim, 12);
    send(sim, { type: 'move', dx: 0, dy: 0 });
    runTicks(sim, 4);
    expect(zombie(sim).state).toBe('investigate');
    holdLantern(sim);
    runTicks(sim, 8);
    expect(zombie(sim).state).toBe('chase');
  });

  it('walls block sight, windows do not', () => {
    const wall = { wallW: (x: number, y: number) => x === 15 && y < 30 };
    const blocked = aiSim({ zombies: [{ x: 20.5, y: 10.5 }], aiConfig: WIDE, map: wall });
    runTicks(blocked, 40);
    expect(zombie(blocked).state).not.toBe('chase');
    const window = aiSim({
      zombies: [{ x: 20.5, y: 10.5 }],
      aiConfig: WIDE,
      map: { ...wall, edgeId: (_x, y) => (y === 10 ? 2 : 1), edgeKinds: [null, 'wall', 'window'] },
    });
    runTicks(window, 8);
    expect(zombie(window).state).toBe('chase');
  });

  it('beyond nearSenseTiles only inside the facing cone', () => {
    // Walking east to a noise, the zombie never sees the player 10 tiles behind its back.
    const sim = aiSim({ zombies: [{ x: 20.5, y: 10.5 }] });
    send(sim, { type: 'debugNoise', x: 45.5, y: 10.5, radiusTiles: 40 });
    for (let i = 0; i < 100; i++) {
      sim.step();
      expect(zombie(sim).state).not.toBe('chase');
    }
    expect(zombie(sim).x).toBeGreaterThan(25);
  });
});

describe('ai: hearing and noise', () => {
  it('hears a noise within radius × hearing / reference; walls halve it', () => {
    const quiet = aiSim({ zombies: [{ x: 30.5, y: 30.5 }] });
    send(quiet, { type: 'debugNoise', x: 30.5, y: 39.5, radiusTiles: 8 });
    runTicks(quiet, 8);
    expect(zombie(quiet).state).toBe('idle');
    const loud = aiSim({ zombies: [{ x: 30.5, y: 30.5 }] });
    send(loud, { type: 'debugNoise', x: 30.5, y: 39.5, radiusTiles: 10 });
    runTicks(loud, 8);
    expect(zombie(loud)).toMatchObject({ state: 'investigate' });
    expect(eventsOf(loud.drainEvents(), 'zombieAlerted')).toMatchObject([
      { reason: 'noise', x: 30.5, y: 39.5 },
    ]);
    const walled = aiSim({
      zombies: [{ x: 30.5, y: 30.5 }],
      map: { wallN: (_x, y) => y === 35 },
    });
    send(walled, { type: 'debugNoise', x: 30.5, y: 39.5, radiusTiles: 10 });
    runTicks(walled, 8);
    expect(zombie(walled).state).toBe('idle');
    send(walled, { type: 'debugNoise', x: 30.5, y: 39.5, radiusTiles: 18 });
    runTicks(walled, 8);
    expect(zombie(walled).state).toBe('investigate');
  });

  it('an investigating zombie walks to the noise, lingers, then idles again', () => {
    const sim = aiSim({ zombies: [{ x: 30.5, y: 30.5 }] });
    send(sim, { type: 'debugNoise', x: 36.5, y: 30.5, radiusTiles: 20 });
    runTicks(sim, 8);
    expect(runUntil(sim, () => Math.abs(zombie(sim).x - 36.5) < 0.6, 200)).toBeGreaterThan(0);
    expect(runUntil(sim, () => zombie(sim).state === 'idle', 400)).toBeGreaterThan(0);
  });

  it('footsteps: radius by gait (dev noise events), sneak is quiet', () => {
    const radii = (gait: 'sneak' | 'walk' | 'run') => {
      const sim = aiSim();
      send(sim, { type: 'move', dx: 1, dy: 0, gait });
      runTicks(sim, 20);
      return eventsOf(sim.drainEvents(), 'noise').map((e) => [e.source, e.radiusTiles]);
    };
    const f = DEFAULT_STAGE4_CONFIG.noise.footsteps;
    expect(radii('walk')).toEqual([
      ['footstep', f.walk.radiusTiles],
      ['footstep', f.walk.radiusTiles],
    ]);
    expect(radii('run')[0]).toEqual(['footstep', f.run.radiusTiles]);
    expect(radii('sneak')[0]).toEqual(['footstep', f.sneak.radiusTiles]);
  });

  it('gait: run is faster, sneak slower; running needs endurance', () => {
    const dist = (gait: 'sneak' | 'walk' | 'run', endurance?: number) => {
      const sim = aiSim();
      if (endurance !== undefined)
        send(sim, { type: 'debugStat', stat: 'endurance', value: endurance });
      send(sim, { type: 'move', dx: 1, dy: 0, gait });
      runTicks(sim, 20);
      return sim.getPlayer()!.x - 10.5;
    };
    expect(dist('walk')).toBeCloseTo(3, 3);
    expect(dist('run')).toBeCloseTo(3 * DEFAULT_STAGE4_CONFIG.gait.runSpeedMul, 3);
    expect(dist('sneak')).toBeCloseTo(3 * DEFAULT_STAGE4_CONFIG.gait.sneakSpeedMul, 3);
    expect(dist('run', 0)).toBeCloseTo(3, 3);
  });

  it('starting a timed action makes a small noise', () => {
    const sim = aiSim();
    send(sim, { type: 'debugStat', stat: 'hunger', value: 50 });
    send(sim, { type: 'debugGiveItem', itemId: 'fixture:apple' });
    sim.step();
    sim.drainEvents();
    send(sim, { type: 'useItem', item: findItem(sim, 'fixture:apple')!.id });
    sim.step();
    expect(eventsOf(sim.drainEvents(), 'noise').map((e) => e.source)).toEqual(['action']);
  });
});
