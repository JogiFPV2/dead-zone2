import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { aiSim, eventsOf, runTicks, runUntil, zombie } from '../test/ai-fixtures.js';
import { fixtureContent, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { rejectedReasons } from '../test/item-fixtures.js';
import { TileGrid } from '../world/grid.js';
import { edgesBetween, lineOfSight } from '../world/los.js';
import {
  createOpeningsWorld,
  DEFAULT_OPENINGS_CONFIG,
  EF,
  openingKey,
  OpeningKind,
  OS,
  setOpening,
} from './state.js';

/**
 * Room x/y ∈ [20, 30): west wall with a door at (20, 25) (edge id 2) and a window at (20, 22)
 * (edge id 3).
 */
const roomSpec = {
  wallW: (x: number, y: number) => (x === 20 || x === 30) && y >= 20 && y < 30,
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) => (x === 20 && y === 25 ? 2 : x === 20 && y === 22 ? 3 : 1),
  edgeKinds: [null, 'wall', 'door', 'window'] as const,
};
const DOOR = { tx: 20, ty: 25, side: 'w' } as const;
const WINDOW = { tx: 20, ty: 22, side: 'w' } as const;
const inside = (x: number, y: number) => x > 20 && x < 30 && y > 20 && y < 30;

describe('openings: edge flags', () => {
  const map = buildMap(roomSpec);
  const o = createOpeningsWorld(map, DEFAULT_OPENINGS_CONFIG);
  const grid = new TileGrid(map, o);
  const door = openingKey(1, 20, 25, 0);
  const win = openingKey(1, 20, 22, 0);

  it('closed door: blocks movement, sight and muffles sound; open: nothing', () => {
    expect(grid.flagsW(20, 25, 0) & (EF.blocksMove | EF.blocksSight | EF.muffles)).toBe(
      EF.blocksMove | EF.blocksSight | EF.muffles,
    );
    expect(lineOfSight(grid, 0, 18.5, 25.5, 22.5, 25.5)).toBe(false);
    expect(edgesBetween(grid, 0, 18.5, 25.5, 22.5, 25.5, 4)).toBe(1);
    setOpening(o, door, OpeningKind.door, OS.open);
    expect(grid.hasWallW(20, 25, 0)).toBe(false);
    expect(lineOfSight(grid, 0, 18.5, 25.5, 22.5, 25.5)).toBe(true);
    expect(edgesBetween(grid, 0, 18.5, 25.5, 22.5, 25.5, 4)).toBe(0);
    setOpening(o, door, OpeningKind.door, OS.closed);
    expect(o.states.size).toBe(0);
  });

  it('window: closed blocks movement not sight; broken passes slowly; planks block sight', () => {
    expect(grid.hasWallW(20, 22, 0)).toBe(true);
    expect(lineOfSight(grid, 0, 18.5, 22.5, 22.5, 22.5)).toBe(true);
    setOpening(o, win, OpeningKind.window, OS.broken);
    expect(grid.flagsW(20, 22, 0) & (EF.blocksMove | EF.slow)).toBe(EF.slow);
    setOpening(o, win, OpeningKind.window, OS.broken, 0, { planks: 2, bhp: 80 });
    expect(lineOfSight(grid, 0, 18.5, 22.5, 22.5, 22.5)).toBe(false);
    expect(grid.hasWallW(20, 22, 0)).toBe(true);
  });
});

describe('openings: player commands', () => {
  it('toggleDoor opens / closes in reach; lock blocks opening; walls and far edges rejected', () => {
    const sim = aiSim({ map: roomSpec, spawn: { x: 21, y: 25.5 } });
    send(sim, { type: 'toggleDoor', ...DOOR });
    sim.step();
    const ev = sim.drainEvents();
    expect(eventsOf(ev, 'openingChanged')).toEqual([
      {
        type: 'openingChanged',
        tick: 0,
        ...DOOR,
        z: 0,
        kind: 'door',
        state: 'open',
        hp: DEFAULT_OPENINGS_CONFIG.doorHp,
        maxHp: DEFAULT_OPENINGS_CONFIG.doorHp,
        barricade: 0,
        glass: false,
        by: 'player',
      },
    ]);
    expect(sim.drainView()?.openings).toMatchObject([{ ...DOOR, state: 'open' }]);
    // Walks out through the open door.
    send(sim, { type: 'move', dx: -1, dy: 0 });
    expect(runUntil(sim, () => sim.getPlayer()!.x < 19.5, 200)).toBeGreaterThan(0);
    send(sim, { type: 'move', dx: 0, dy: 0 });
    send(sim, { type: 'toggleDoor', ...DOOR });
    send(sim, { type: 'toggleDoor', ...DOOR, lock: true });
    send(sim, { type: 'toggleDoor', ...DOOR });
    send(sim, { type: 'toggleDoor', ...WINDOW, lock: true });
    send(sim, { type: 'toggleDoor', tx: 20, ty: 27, side: 'w' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['locked', 'out-of-range', 'invalid-target']);
    send(sim, { type: 'toggleDoor', tx: 19, ty: 25, side: 'n' });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-target']);
    // Locked: the player cannot walk back in.
    send(sim, { type: 'move', dx: 1, dy: 0 });
    runTicks(sim, 60);
    expect(sim.getPlayer()!.x).toBeLessThan(20);
  });

  it('breakWindow (= timed smashWindow): loud break noise, broken window is passable but slow', () => {
    const sim = aiSim({ map: roomSpec, spawn: { x: 21, y: 22.5 } });
    send(sim, { type: 'breakWindow', ...WINDOW });
    const ev = [];
    for (let i = 0; i < 22; i++) {
      sim.step();
      ev.push(...sim.drainEvents());
    }
    expect(eventsOf(ev, 'openingChanged')[0]).toMatchObject({ state: 'broken', kind: 'window' });
    expect(eventsOf(ev, 'noise')[0]).toMatchObject({
      source: 'break',
      radiusTiles: DEFAULT_OPENINGS_CONFIG.breakNoise.radiusTiles,
    });
    send(sim, { type: 'breakWindow', ...WINDOW });
    sim.step();
    expect(rejectedReasons(sim)).toEqual(['invalid-state']);
    send(sim, { type: 'move', dx: -1, dy: 0 });
    const viaWindow = runUntil(sim, () => sim.getPlayer()!.x < 19, 400);

    const door = aiSim({ map: roomSpec, spawn: { x: 21, y: 25.5 } });
    send(door, { type: 'toggleDoor', ...DOOR });
    door.step();
    send(door, { type: 'move', dx: -1, dy: 0 });
    const viaDoor = runUntil(door, () => door.getPlayer()!.x < 19, 400);
    expect(viaWindow).toBeGreaterThan(0);
    expect(viaDoor).toBeGreaterThan(0);
    // Braking into the window and accelerating out of it soften the slowdown a bit.
    expect(viaWindow).toBeGreaterThan(viaDoor * 1.2);
  });
});

describe('openings: zombies', () => {
  it('a zombie drawn by noise bashes a closed door until it breaks, then walks in', () => {
    const sim = aiSim({
      map: roomSpec,
      spawn: { x: 27.5, y: 27.5 },
      zombies: [{ x: 12.5, y: 25.5 }],
      content: fixtureContent({ openings: { doorHp: 8 } }),
    });
    let hits = 0;
    let broken = -1;
    for (let i = 0; i < 2000 && !inside(zombie(sim).x, zombie(sim).y); i++) {
      if (i % 100 === 0) send(sim, { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 });
      sim.step();
      for (const e of eventsOf(sim.drainEvents(), 'openingChanged')) {
        expect(e).toMatchObject({ ...DOOR, kind: 'door', by: 'zombie' });
        hits++;
        if (e.state === 'broken') broken = i;
      }
      if (broken < 0) expect(inside(zombie(sim).x, zombie(sim).y)).toBe(false);
    }
    expect(hits).toBeGreaterThan(2);
    expect(broken).toBeGreaterThan(0);
    expect(inside(zombie(sim).x, zombie(sim).y)).toBe(true);
  });
});

describe('openings: save', () => {
  it('door state and bashing survive save / load (same hash)', () => {
    const opts = {
      seed: 5,
      map: buildMap(roomSpec),
      spawn: { x: 27.5, y: 27.5 },
      content: fixtureContent({ openings: { doorHp: 30 } }),
      dev: true,
      spawnZombies: [{ x: 12.5, y: 25.5 }],
    };
    const a = createSim(opts);
    send(a, { type: 'debugOpening', ...WINDOW, state: 'barricaded' });
    for (let i = 0; i < 400; i++) {
      if (i % 100 === 0) send(a, { type: 'debugNoise', x: 25.5, y: 25.5, radiusTiles: 40 });
      a.step();
    }
    expect(a.world.openings.states.size).toBeGreaterThan(1);
    const b = createSim({ ...opts, load: a.save() });
    expect(b.hash()).toBe(a.hash());
    expect(b.drainView()?.openings?.length).toBe(a.world.openings.states.size);
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
  });
});

describe('openings: edge kinds', () => {
  it('one list of edge kinds: content EDGE_TYPES = protocol SIM_EDGE_KINDS (gate included)', async () => {
    const { EDGE_TYPES } = await import('@deadzone/content');
    const { SIM_EDGE_KINDS } = await import('@deadzone/protocol');
    expect([...EDGE_TYPES]).toEqual([...SIM_EDGE_KINDS]);
    expect(SIM_EDGE_KINDS).toContain('gate');
  });
});
