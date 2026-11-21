import { PLAYER_NOISE_MIN_TICKS, type SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { SPRINT_NOISE_MUL } from '../physics/constants.js';
import { DEFAULT_OPENINGS_CONFIG } from '../openings/state.js';
import { createSim, type Sim } from '../sim.js';
import { aiSim, eventsOf, zombie } from '../test/ai-fixtures.js';
import { baseContent, fixtureContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { findItem } from '../test/item-fixtures.js';
import { seatedSim } from '../test/vehicle-fixtures.js';
import { DEFAULT_STAGE4_CONFIG } from './config.js';

/** Room x/y ∈ [20, 30): west wall with a door at (20, 25) and a window at (20, 22). */
const roomSpec = {
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) => (x === 20 && y === 25 ? 2 : x === 20 && y === 22 ? 3 : 1),
  edgeKinds: [null, 'wall', 'door', 'window'] as const,
};
const DOOR = { tx: 20, ty: 25, side: 'w' } as const;
const WINDOW = { tx: 20, ty: 22, side: 'w' } as const;
const inside = (x: number, y: number) => x > 20 && x < 30 && y > 20 && y < 30;
const F = DEFAULT_STAGE4_CONFIG.noise.footsteps;

function collect(sim: Sim, ticks: number, each?: (i: number) => void): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    each?.(i);
    sim.step();
    ev.push(...sim.drainEvents());
  }
  return ev;
}

function walk(sim: Sim, gait: 'sneak' | 'walk' | 'run' | 'sprint', ticks: number): SimEvent[] {
  send(sim, { type: 'move', dx: 0, dy: 1, gait });
  return collect(sim, ticks);
}

describe('playerNoise: footsteps', () => {
  it.each([
    ['sneak', 'sneak', F.sneak.radiusTiles, F.sneak.volume],
    ['walk', 'step', F.walk.radiusTiles, F.walk.volume],
    ['run', 'run', F.run.radiusTiles, F.run.volume],
    ['sprint', 'sprint', F.run.radiusTiles * SPRINT_NOISE_MUL, F.run.volume],
  ] as const)('%s → kind %s with the radius the AI hears', (gait, kind, radius, loudness) => {
    const sim = aiSim();
    const ev = walk(sim, gait, 60);
    const pn = eventsOf(ev, 'playerNoise');
    expect(pn.length).toBeGreaterThanOrEqual(4);
    expect(pn.every((e) => e.kind === kind && e.playerId === 0 && e.z === 0)).toBe(true);
    expect(pn[pn.length - 1]!.radius).toBeCloseTo(radius, 4);
    expect(pn[pn.length - 1]!.loudness).toBeCloseTo(loudness, 6);
    // Same values as the AI noise (dev `noise` event) of the same tick: one source of truth.
    const ai = eventsOf(ev, 'noise').filter((n) => n.source === 'footstep');
    expect(pn.map((e) => [e.tick, e.x, e.y, e.z, e.radius, e.loudness])).toEqual(
      ai.map((n) => [n.tick, n.x, n.y, n.z, n.radiusTiles, n.volume]),
    );
  });

  it('production builds (dev off) get playerNoise, not the dev-only noise', () => {
    const sim = aiSim({ dev: false });
    const ev = walk(sim, 'walk', 40);
    expect(eventsOf(ev, 'playerNoise').length).toBeGreaterThan(0);
    expect(eventsOf(ev, 'noise')).toEqual([]);
  });

  it('standing still makes no footstep noise', () => {
    const sim = aiSim();
    expect(eventsOf(collect(sim, 40), 'playerNoise')).toEqual([]);
  });

  it(`throttle: continuous kinds at most once per ${PLAYER_NOISE_MIN_TICKS} ticks per kind`, () => {
    // Footsteps every tick in the AI: the AI still hears all of them, the client gets 1 / 10.
    const cfg = { ...DEFAULT_STAGE4_CONFIG, noise: { ...DEFAULT_STAGE4_CONFIG.noise } };
    cfg.noise.footstepEveryTicks = 1;
    const sim = aiSim({ aiConfig: cfg });
    const ev = walk(sim, 'walk', 60);
    const ai = eventsOf(ev, 'noise').filter((n) => n.source === 'footstep');
    const pn = eventsOf(ev, 'playerNoise');
    expect(ai.length).toBeGreaterThan(40);
    expect(pn.length).toBeGreaterThan(3);
    expect(pn.length).toBeLessThanOrEqual(Math.ceil(60 / PLAYER_NOISE_MIN_TICKS));
    for (let i = 1; i < pn.length; i++)
      expect(pn[i]!.tick - pn[i - 1]!.tick).toBeGreaterThanOrEqual(PLAYER_NOISE_MIN_TICKS);
    // A different kind (walk → run) is not held back by the walk throttle.
    send(sim, { type: 'move', dx: 0, dy: 1, gait: 'run' });
    sim.step();
    expect(eventsOf(sim.drainEvents(), 'playerNoise').map((e) => e.kind)).toEqual(['run']);
  });

  it('determinism: same run → same playerNoise stream and hash', () => {
    // Fixed command seqs (the shared `send` counter is part of the hashed command state).
    const go = () => {
      const sim = aiSim({ zombies: [{ x: 30.5, y: 30.5 }] });
      const mv = (gait: 'run' | 'walk', seq: number) =>
        sim.enqueue({ type: 'move', dx: 0, dy: 1, gait, tick: sim.tick, playerId: 0, seq });
      mv('run', 1);
      const ev = collect(sim, 50);
      mv('walk', 2);
      ev.push(...collect(sim, 50));
      return { pn: eventsOf(ev, 'playerNoise'), hash: sim.hash() };
    };
    const a = go();
    expect(a.pn.length).toBeGreaterThan(5);
    expect(go()).toEqual(a);
  });
});

describe('playerNoise: openings', () => {
  it('toggleDoor → kind door (toggleNoise at the edge centre)', () => {
    const sim = aiSim({ map: roomSpec, spawn: { x: 21, y: 25.5 } });
    send(sim, { type: 'toggleDoor', ...DOOR });
    sim.step();
    const n = DEFAULT_OPENINGS_CONFIG.toggleNoise;
    expect(eventsOf(sim.drainEvents(), 'playerNoise')).toEqual([
      {
        type: 'playerNoise',
        tick: 0,
        playerId: 0,
        x: 20,
        y: 25.5,
        z: 0,
        radius: n.radiusTiles,
        loudness: Math.fround(n.volume),
        kind: 'door',
      },
    ]);
  });

  it('smashWindow → kind window (breakNoise)', () => {
    const sim = aiSim({ map: roomSpec, spawn: { x: 21, y: 22.5 } });
    send(sim, { type: 'smashWindow', ...WINDOW });
    const pn = eventsOf(collect(sim, 40), 'playerNoise');
    expect(pn).toMatchObject([
      { kind: 'window', radius: DEFAULT_OPENINGS_CONFIG.breakNoise.radiusTiles, loudness: 1 },
    ]);
  });

  it('zombie bashing a door and debug noises: no playerNoise', () => {
    const sim = aiSim({
      map: roomSpec,
      spawn: { x: 27.5, y: 27.5 },
      zombies: [{ x: 12.5, y: 25.5 }],
      content: fixtureContent({ openings: { doorHp: 8 } }),
    });
    const ev: SimEvent[] = [];
    for (let i = 0; i < 2000 && !inside(zombie(sim).x, zombie(sim).y); i++) {
      if (i % 100 === 0) send(sim, { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 });
      sim.step();
      ev.push(...sim.drainEvents());
    }
    expect(eventsOf(ev, 'openingChanged').some((e) => e.by === 'zombie')).toBe(true);
    expect(eventsOf(ev, 'noise').some((n) => n.source === 'impact')).toBe(true);
    expect(eventsOf(ev, 'noise').some((n) => n.source === 'debug')).toBe(true);
    expect(eventsOf(ev, 'playerNoise')).toEqual([]);
  });
});

describe('playerNoise: combat', () => {
  it('melee swing → kind melee', () => {
    const sim = aiSim();
    send(sim, { type: 'aim', x: 12, y: 10.5 });
    send(sim, { type: 'attack' });
    const pn = eventsOf(collect(sim, 5), 'playerNoise');
    expect(pn).toHaveLength(1);
    expect(pn[0]).toMatchObject({ kind: 'melee', playerId: 0, x: 10.5, y: 10.5 });
  });

  it('pistol shot → kind shot with the weapon shotNoise', async () => {
    const content = await baseContent();
    const def = content.items['base:pistol']!;
    if (def.kind !== 'weapon_ranged') throw new Error('pistol');
    const dev = createSim({
      seed: 3,
      map: buildMap({ width: 64, height: 64 }),
      spawn: { x: 10.5, y: 10.5 },
      content,
      dev: true,
      // Exact noise radii from the data: no rain masking.
      weather: 'off',
      clockStart: { day: 1, hour: 12, minute: 0 },
    });
    send(dev, { type: 'debugGiveItem', itemId: 'base:pistol' });
    send(dev, { type: 'debugGiveItem', itemId: 'base:pistol-magazine' });
    send(dev, { type: 'debugGiveItem', itemId: 'base:ammo-9mm', count: 20 });
    dev.step();
    send(dev, { type: 'equip', item: findItem(dev, 'base:pistol')!.id, slot: 'hand_primary' });
    send(dev, { type: 'aim', x: 20, y: 10.5 });
    send(dev, { type: 'loadMagazine', item: findItem(dev, 'base:pistol-magazine')!.id });
    collect(dev, 200);
    send(dev, { type: 'reload' });
    collect(dev, 200);
    send(dev, { type: 'attack' });
    const pn = eventsOf(collect(dev, 2), 'playerNoise').filter((e) => e.kind !== 'step');
    expect(pn).toHaveLength(1);
    expect(pn[0]).toMatchObject({ kind: 'shot', loudness: def.ranged.shotNoise.volume });
    expect(pn[0]!.radius).toBeCloseTo(def.ranged.shotNoise.radiusTiles, 4);
  });
});

describe('playerNoise: vehicle', () => {
  it('the engine of the car the player drives → kind vehicle, throttled', () => {
    const { sim, ctl } = seatedSim();
    ctl.drive(1);
    const pn = eventsOf(collect(sim, 60), 'playerNoise').filter((e) => e.kind === 'vehicle');
    expect(pn.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < pn.length; i++)
      expect(pn[i]!.tick - pn[i - 1]!.tick).toBeGreaterThanOrEqual(PLAYER_NOISE_MIN_TICKS);
    expect(pn.every((e) => e.playerId === 0 && e.radius >= 10 && e.radius <= 35)).toBe(true);
  });
});
