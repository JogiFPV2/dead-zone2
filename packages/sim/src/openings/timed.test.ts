import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import type { SimEdgeKind, SimEvent } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_COMBAT_CONFIG } from '../combat/config.js';
import { DEFAULT_PHYSICS_CONFIG } from '../physics/constants.js';
import { progressOf } from '../progress/skills.js';
import { createSim, type Sim, type SimOptions } from '../sim.js';
import { eventsOf, NOON } from '../test/ai-fixtures.js';
import { fixturePack } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { TileGrid } from '../world/grid.js';
import { edgesBetween, lineOfSight } from '../world/los.js';
import { openingKey, OpeningKind, OS, setOpening } from './state.js';

/**
 * Room x/y ∈ [20, 30): west wall with a door at (20, 25) (edge id 2) and a window at (20, 22)
 * (edge id 3). Column x = 40: a low fence (id 4) for y ∈ [20, 30) with a gate (id 5) at y = 25.
 */
const roomSpec = {
  wallW: (x: number, y: number) =>
    ((x === 20 || x === 30) && y >= 20 && y < 30) || (x === 40 && y >= 20 && y < 30),
  wallN: (x: number, y: number) => (y === 20 || y === 30) && x >= 20 && x < 30,
  edgeId: (x: number, y: number) =>
    x === 20 && y === 25 ? 2 : x === 20 && y === 22 ? 3 : x === 40 ? (y === 25 ? 5 : 4) : 1,
  edgeKinds: [null, 'wall', 'door', 'window', 'fence', 'gate'] as (SimEdgeKind | null)[],
};
const DOOR = { tx: 20, ty: 25, side: 'w' } as const;
const WINDOW = { tx: 20, ty: 22, side: 'w' } as const;
const GATE = { tx: 40, ty: 25, side: 'w' } as const;
const FENCE = { tx: 40, ty: 23, side: 'w' } as const;
const inside = (x: number, y: number) => x > 20 && x < 30 && y > 20 && y < 30;

/** Fixture pack + carpentry items / skills; `openings` overrides `worldSettings.openings`. */
function content(openings: Record<string, unknown> = {}): ContentBundle {
  const o = openings as { barricade?: object; force?: object };
  const pack = fixturePack({
    openings: {
      ...openings,
      barricade: {
        plankItem: 'fixture:plank',
        nailsItem: 'fixture:nails',
        skill: 'fixture:carpentry',
        ...o.barricade,
      },
      force: { strengthSkill: 'fixture:strength', ...o.force },
    },
  });
  const xp = [50, 110, 190, 300, 440, 610, 820, 1070, 1360, 1700];
  return buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files,
        {
          path: 'items/carpentry.json',
          json: [
            {
              id: 'fixture:plank',
              name: 'item.fixture.plank',
              kind: 'material',
              weightKg: 1.8,
              maxStack: 10,
            },
            {
              id: 'fixture:nails',
              name: 'item.fixture.nails',
              kind: 'material',
              weightKg: 0.005,
              maxStack: 100,
            },
            {
              id: 'fixture:hammer',
              name: 'item.fixture.hammer',
              kind: 'material',
              weightKg: 0.7,
              tags: ['base:tool-hammer'],
            },
            {
              id: 'fixture:crowbar',
              name: 'item.fixture.crowbar',
              kind: 'material',
              weightKg: 1.6,
              tags: ['base:tool-pry'],
            },
          ],
        },
        {
          path: 'skills/carpentry.json',
          json: [
            { id: 'fixture:carpentry', name: 'skill.c', group: 'crafting', xpPerLevel: xp },
            { id: 'fixture:strength', name: 'skill.s', group: 'movement', xpPerLevel: xp },
          ],
        },
      ],
    },
  ]);
}

const harmless = {
  ...DEFAULT_COMBAT_CONFIG,
  zombie: { ...DEFAULT_COMBAT_CONFIG.zombie, hitChance: 0 },
};

function sim(
  spawn: { x: number; y: number },
  opts: {
    openings?: Record<string, unknown>;
    zombies?: { x: number; y: number }[];
  } & Partial<SimOptions> = {},
): Sim {
  const { openings, zombies, ...rest } = opts;
  return createSim({
    seed: 9,
    map: buildMap(roomSpec),
    spawn,
    content: content(openings),
    dev: true,
    clockStart: NOON,
    combatConfig: harmless,
    ...(zombies ? { spawnZombies: zombies } : {}),
    ...rest,
  });
}

/** Per-sim `seq` (hash-comparable runs); `cmd` enqueues for the current tick. */
function driver(s: Sim) {
  let seq = 0;
  const cmd = (c: Record<string, unknown>) => {
    const r = s.enqueue({ ...c, tick: s.tick, playerId: 0, seq: seq++ } as never);
    if (!r.ok) throw new Error(`rejected ${r.reason}`);
  };
  const events: SimEvent[] = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      s.step();
      events.push(...s.drainEvents());
    }
  };
  const take = () => events.splice(0);
  const give = (itemId: string, count = 1) => cmd({ type: 'debugGiveItem', itemId, count });
  const tools = (planks = 4, nails = 8) => {
    give('fixture:hammer');
    give('fixture:plank', planks);
    give('fixture:nails', nails);
    step();
    take();
  };
  return { cmd, step, take, give, tools };
}

const rejected = (ev: readonly SimEvent[]) => eventsOf(ev, 'commandRejected').map((e) => e.reason);
const view = (s: Sim, e: { tx: number; ty: number; side: string }) =>
  s.world.openings.states.get(openingKey(e.side === 'n' ? 0 : 1, e.tx, e.ty, 0));
const countOf = (s: Sim, def: string) =>
  [...s.world.items!.items.values()]
    .filter((i) => s.world.items!.content.items[i.def]!.id === def)
    .reduce((n, i) => n + i.count, 0);
const SMASH_TICKS = 20;
const BARRICADE_TICKS = 80;

describe('openings timed: smashWindow', () => {
  it('takes ~1 s, then broken + windowSmashed + loud noise; a bare hand may be cut', () => {
    const s = sim({ x: 21, y: 22.5 }, { openings: { window: { handCutChance: 1 } } });
    const d = driver(s);
    d.cmd({ type: 'smashWindow', ...WINDOW });
    d.step();
    expect(s.drainView()?.action).toMatchObject({
      kind: 'smashWindow',
      progress: 0.05,
      edge: { ...WINDOW, z: 0 },
    });
    d.step(SMASH_TICKS - 2);
    expect(eventsOf(d.take(), 'windowSmashed')).toEqual([]);
    d.step(2);
    const ev = d.take();
    expect(eventsOf(ev, 'windowSmashed')).toEqual([
      expect.objectContaining({ ...WINDOW, z: 0, by: 'player', playerId: 0, withHand: true }),
    ]);
    expect(eventsOf(ev, 'openingChanged')[0]).toMatchObject({
      state: 'broken',
      glass: true,
      barricade: 0,
    });
    expect(eventsOf(ev, 'noise')).toContainEqual(
      expect.objectContaining({ source: 'break', radiusTiles: 20 }),
    );
    expect(eventsOf(ev, 'wounded')).toEqual([
      expect.objectContaining({ part: 'hand_r', wound: 'laceration' }),
    ]);
    expect(eventsOf(ev, 'actionCompleted')).toMatchObject([{ action: 'smashWindow' }]);
    // `breakWindow` is the same action now; a broken window cannot be smashed again.
    d.cmd({ type: 'breakWindow', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state']);
  });

  it('with a weapon in hand: no cut; moving interrupts (window stays closed)', () => {
    const s = sim({ x: 21, y: 22.5 }, { openings: { window: { handCutChance: 1 } } });
    const d = driver(s);
    d.give('fixture:bat');
    d.step();
    const bat = [...s.world.items!.items.values()].find(
      (i) => s.world.items!.content.items[i.def]!.id === 'fixture:bat',
    )!;
    d.cmd({ type: 'equip', item: bat.id, slot: 'hand_primary' });
    d.cmd({ type: 'smashWindow', ...WINDOW });
    d.step(5);
    d.cmd({ type: 'move', dx: 1, dy: 0 });
    d.step();
    d.cmd({ type: 'move', dx: 0, dy: 0 });
    d.step();
    expect(eventsOf(d.take(), 'actionInterrupted')).toMatchObject([
      { action: 'smashWindow', reason: 'moved' },
    ]);
    expect(view(s, WINDOW)).toBeUndefined();
    d.cmd({ type: 'move', dx: -1, dy: 0 });
    d.step(4);
    d.cmd({ type: 'move', dx: 0, dy: 0 });
    d.cmd({ type: 'smashWindow', ...WINDOW });
    d.step(SMASH_TICKS + 2);
    const ev = d.take();
    expect(eventsOf(ev, 'windowSmashed')[0]).toMatchObject({ withHand: false });
    expect(eventsOf(ev, 'wounded')).toEqual([]);
  });

  it('rejects doors, fences and windows out of reach', () => {
    const s = sim({ x: 21, y: 25.5 });
    const d = driver(s);
    d.cmd({ type: 'smashWindow', ...DOOR });
    d.cmd({ type: 'smashWindow', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-target', 'out-of-range']);
  });
});

describe('openings timed: climbThrough and removeGlass', () => {
  const glassy = {
    physicsConfig: {
      ...DEFAULT_PHYSICS_CONFIG,
      vault: { ...DEFAULT_PHYSICS_CONFIG.vault, glassChance: 1, tripWindow: 0 },
    },
  };
  const climbTicks = DEFAULT_PHYSICS_CONFIG.vault.windowTicks;

  it('climbs through a broken window in 1.5 s (action + vault); shards cut', () => {
    const s = sim({ x: 20.7, y: 22.5 }, glassy);
    const d = driver(s);
    d.cmd({ type: 'climbThrough', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state']);
    d.cmd({ type: 'debugOpening', ...WINDOW, state: 'broken' });
    d.cmd({ type: 'climbThrough', ...WINDOW });
    d.step();
    const started = eventsOf(d.take(), 'actionStarted');
    expect(started).toMatchObject([{ action: 'climbThrough', endTick: s.tick - 1 + climbTicks }]);
    // Holding a direction does not interrupt the climb.
    d.cmd({ type: 'move', dx: 1, dy: 0 });
    d.step(climbTicks + 2);
    const ev = d.take();
    expect(eventsOf(ev, 'actionCompleted')).toMatchObject([{ action: 'climbThrough' }]);
    expect(eventsOf(ev, 'actionInterrupted')).toEqual([]);
    expect(s.getPlayer()!.x).toBeLessThan(20);
    expect(eventsOf(ev, 'wounded')).toHaveLength(1);
    expect(['scratch', 'laceration']).toContain(eventsOf(ev, 'wounded')[0]!.wound);
  });

  it('removeGlass clears the frame (glass: false, shards to the inventory): safe climb', () => {
    const s = sim(
      { x: 20.7, y: 22.5 },
      { ...glassy, openings: { window: { glassItem: 'fixture:nails', glassPieces: 3 } } },
    );
    const d = driver(s);
    d.cmd({ type: 'debugOpening', ...WINDOW, state: 'broken' });
    d.cmd({ type: 'removeGlass', ...WINDOW });
    d.step(60 + 2);
    let ev = d.take();
    expect(eventsOf(ev, 'actionCompleted')).toMatchObject([{ action: 'removeGlass' }]);
    expect(eventsOf(ev, 'openingChanged').at(-1)).toMatchObject({ state: 'broken', glass: false });
    expect(countOf(s, 'fixture:nails')).toBe(3);
    expect(s.drainView()?.openings).toContainEqual(
      expect.objectContaining({ ...WINDOW, glass: false }),
    );
    d.cmd({ type: 'removeGlass', ...WINDOW });
    d.cmd({ type: 'climbThrough', ...WINDOW });
    d.step(climbTicks + 2);
    ev = d.take();
    expect(rejected(ev)).toEqual(['invalid-state']);
    expect(s.getPlayer()!.x).toBeLessThan(20);
    expect(eventsOf(ev, 'wounded')).toEqual([]);
  });

  it('a zombie climbs through an open window slower than through an open door', () => {
    const through = (edge: typeof DOOR | typeof WINDOW) => {
      const s = sim({ x: 27.5, y: edge.ty + 0.5 }, { zombies: [{ x: 14.5, y: edge.ty + 0.5 }] });
      const d = driver(s);
      d.cmd({ type: 'debugOpening', ...edge, state: 'open' });
      // The other opening stays locked shut.
      if (edge === WINDOW) d.cmd({ type: 'debugOpening', ...DOOR, state: 'locked' });
      for (let i = 0; i < 1500; i++) {
        if (i % 50 === 0) d.cmd({ type: 'debugNoise', x: 25.5, y: edge.ty + 0.5, radiusTiles: 40 });
        d.step();
        const z = s.getZombies()[0]!;
        if (z.x > 21) return i;
      }
      return -1;
    };
    const door = through(DOOR);
    const win = through(WINDOW);
    expect(door).toBeGreaterThan(0);
    expect(win).toBeGreaterThan(door);
  });
});

describe('openings timed: barricade', () => {
  it('needs a hammer, a plank and 2 nails; up to 4 planks, each adds hp; carpentry XP', () => {
    const s = sim({ x: 21, y: 22.5 });
    const d = driver(s);
    d.cmd({ type: 'barricade', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['missing-tool']);
    d.give('fixture:hammer');
    d.give('fixture:plank', 5);
    d.give('fixture:nails', 1);
    d.step();
    d.cmd({ type: 'barricade', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['missing-parts']);
    d.give('fixture:nails', 9);
    d.step();
    for (let i = 0; i < 4; i++) d.cmd({ type: 'barricade', ...WINDOW });
    d.step();
    // Hammering is loud at the start of each plank.
    const hammer = d.take();
    expect(eventsOf(hammer, 'noise')).toContainEqual(expect.objectContaining({ radiusTiles: 15 }));
    expect(eventsOf(hammer, 'playerNoise')).toContainEqual(
      expect.objectContaining({ kind: 'board', radius: 15, playerId: 0 }),
    );
    d.step(BARRICADE_TICKS - 2);
    expect(view(s, WINDOW)).toBeUndefined();
    d.step(2);
    expect(view(s, WINDOW)).toMatchObject({ planks: 1, state: OS.closed, bhp: 40 });
    d.step(BARRICADE_TICKS * 3 + 5);
    const ev = d.take();
    expect(eventsOf(ev, 'openingChanged').map((e) => e.barricade)).toEqual([1, 2, 3, 4]);
    // Streaming: each plank re-renders the edge's chunk.
    expect(eventsOf(ev, 'chunkChanged')).toContainEqual(
      expect.objectContaining({ cx: 0, cy: 0, z: 0, reason: 'opening' }),
    );
    expect(eventsOf(ev, 'openingChanged').at(-1)).toMatchObject({ hp: 6 + 160, maxHp: 6 + 160 });
    expect(countOf(s, 'fixture:plank')).toBe(1);
    expect(countOf(s, 'fixture:nails')).toBe(2);
    const sk = s.world.items!.content.skillIndex.get('fixture:carpentry')!;
    expect(progressOf(s.world, s.world.players.get(0)!)!.xp[sk]).toBe(12);
    d.cmd({ type: 'barricade', ...WINDOW });
    d.cmd({ type: 'toggleDoor', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state', 'invalid-state']);
    expect(s.drainView()?.openings).toContainEqual(
      expect.objectContaining({ ...WINDOW, barricade: 4, glass: true, state: 'closed' }),
    );
  });

  it('doors only when closed or locked; higher Carpentry is faster', () => {
    const s = sim({ x: 21, y: 25.5 });
    const d = driver(s);
    d.tools();
    d.cmd({ type: 'toggleDoor', ...DOOR });
    d.cmd({ type: 'barricade', ...DOOR });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state']);
    d.cmd({ type: 'toggleDoor', ...DOOR });
    d.cmd({ type: 'debugSkill', skill: 'fixture:carpentry', level: 5 });
    d.cmd({ type: 'barricade', ...DOOR });
    d.step();
    const st = eventsOf(d.take(), 'actionStarted')[0]!;
    expect(st.endTick - st.tick).toBe(Math.round(BARRICADE_TICKS * (1 - 5 * 0.06)));
  });

  it('planks block movement and sight (from sightBlockPlanks = 2) and muffle sound', () => {
    const s = sim({ x: 21, y: 22.5 });
    const d = driver(s);
    const grid = new TileGrid(s.world.map, s.world.openings);
    const key = openingKey(1, 20, 22, 0);
    const o = s.world.openings;
    d.cmd({ type: 'debugOpening', ...WINDOW, state: 'open' });
    d.step();
    expect(lineOfSight(grid, 0, 18.5, 22.5, 22.5, 22.5)).toBe(true);
    expect(edgesBetween(grid, 0, 18.5, 22.5, 22.5, 22.5, 4)).toBe(0);
    expect(grid.hasWallW(20, 22, 0)).toBe(false);
    setOpening(o, key, OpeningKind.window, OS.open, undefined, { planks: 1, bhp: 40 });
    expect(grid.hasWallW(20, 22, 0)).toBe(true);
    expect(lineOfSight(grid, 0, 18.5, 22.5, 22.5, 22.5)).toBe(true);
    expect(edgesBetween(grid, 0, 18.5, 22.5, 22.5, 22.5, 4)).toBe(1);
    setOpening(o, key, OpeningKind.window, OS.open, undefined, { planks: 2, bhp: 80 });
    expect(lineOfSight(grid, 0, 18.5, 22.5, 22.5, 22.5)).toBe(false);
    // The player cannot walk or vault out through the planks.
    d.cmd({ type: 'climbThrough', ...WINDOW });
    d.cmd({ type: 'vault' });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state', 'invalid-target']);
    d.cmd({ type: 'move', dx: -1, dy: 0 });
    d.step(60);
    expect(s.getPlayer()!.x).toBeGreaterThan(20);
  });

  it('removeBarricade: hammer or crowbar, the plank back, nails by chance', () => {
    const s = sim({ x: 21, y: 22.5 }, { openings: { barricade: { nailReturnChance: 1 } } });
    const d = driver(s);
    d.cmd({ type: 'debugOpening', ...WINDOW, state: 'barricaded' });
    d.cmd({ type: 'removeBarricade', ...WINDOW });
    d.step();
    expect(rejected(d.take())).toEqual(['missing-tool']);
    expect(view(s, WINDOW)).toMatchObject({ planks: 4, bhp: 160 });
    d.give('fixture:crowbar');
    d.step();
    d.cmd({ type: 'removeBarricade', ...WINDOW });
    d.cmd({ type: 'removeBarricade', ...WINDOW });
    d.step(60 * 2 + 4);
    const ev = d.take();
    expect(eventsOf(ev, 'actionCompleted')).toHaveLength(2);
    expect(eventsOf(ev, 'openingChanged').map((e) => e.barricade)).toEqual([3, 2]);
    expect(view(s, WINDOW)).toMatchObject({ planks: 2, bhp: 80 });
    expect(countOf(s, 'fixture:plank')).toBe(2);
    expect(countOf(s, 'fixture:nails')).toBe(4);
  });
});

describe('openings timed: zombies vs planks', () => {
  it('blows knock the planks off one by one, then the window breaks and they climb in', () => {
    const s = sim(
      { x: 27.5, y: 27.5 },
      {
        zombies: [{ x: 14.5, y: 22.5 }],
        openings: { barricade: { plankHp: 12 } },
      },
    );
    const d = driver(s);
    d.cmd({ type: 'debugOpening', ...DOOR, state: 'locked' });
    d.cmd({ type: 'debugOpening', ...WINDOW, state: 'barricaded' });
    const planks: number[] = [];
    let broke = -1;
    for (let i = 0; i < 4000 && !inside(s.getZombies()[0]!.x, s.getZombies()[0]!.y); i++) {
      if (i % 100 === 0) d.cmd({ type: 'debugNoise', x: 25.5, y: 22.5, radiusTiles: 40 });
      d.step();
      for (const e of d.take()) {
        if (e.type === 'openingChanged' && e.tx === 20 && e.ty === 22 && e.by === 'zombie') {
          if (planks.at(-1) !== e.barricade) planks.push(e.barricade);
        }
        if (e.type === 'windowSmashed') broke = i;
      }
    }
    expect(planks).toEqual([4, 3, 2, 1, 0]);
    expect(broke).toBeGreaterThan(0);
    expect(inside(s.getZombies()[0]!.x, s.getZombies()[0]!.y)).toBe(true);
  });
});

describe('openings timed: forceDoor (locked)', () => {
  it('kick (no crowbar): noise and a chance; success → broken', () => {
    const s = sim({ x: 19, y: 25.5 }, { openings: { force: { kickChance: 1 } } });
    const d = driver(s);
    d.cmd({ type: 'forceDoor', ...DOOR });
    d.step();
    expect(rejected(d.take())).toEqual(['invalid-state']);
    d.cmd({ type: 'debugOpening', ...DOOR, state: 'locked' });
    d.cmd({ type: 'forceDoor', ...DOOR });
    d.step(24 + 2);
    const ev = d.take();
    expect(eventsOf(ev, 'doorForced')).toEqual([
      expect.objectContaining({ ...DOOR, method: 'kick', success: true }),
    ]);
    expect(eventsOf(ev, 'noise')).toContainEqual(expect.objectContaining({ radiusTiles: 16 }));
    expect(eventsOf(ev, 'playerNoise')).toContainEqual(
      expect.objectContaining({ kind: 'kick', radius: 16 }),
    );
    expect(view(s, DOOR)).toMatchObject({ state: OS.broken });
  });

  it('crowbar: a failed try only damages the door', () => {
    const s = sim({ x: 19, y: 25.5 }, { openings: { force: { pryChance: 0 } } });
    const d = driver(s);
    d.give('fixture:crowbar');
    d.cmd({ type: 'debugOpening', ...DOOR, state: 'locked' });
    d.cmd({ type: 'forceDoor', ...DOOR });
    d.step(60 + 3);
    const ev = d.take();
    expect(eventsOf(ev, 'doorForced')).toEqual([
      expect.objectContaining({ method: 'pry', success: false }),
    ]);
    expect(eventsOf(ev, 'playerNoise')).toContainEqual(
      expect.objectContaining({ kind: 'pry', radius: 10 }),
    );
    expect(view(s, DOOR)).toMatchObject({ state: OS.locked, hp: 60 - 8 });
  });
});

describe('openings: gate in a fence', () => {
  it('opens, closes and locks like a door; closed blocks movement, not sight or sound', () => {
    const s = sim({ x: 41, y: 25.5 });
    const d = driver(s);
    const grid = new TileGrid(s.world.map, s.world.openings);
    expect(grid.hasWallW(40, 25, 0)).toBe(true);
    expect(lineOfSight(grid, 0, 38.5, 25.5, 42.5, 25.5)).toBe(true);
    expect(edgesBetween(grid, 0, 38.5, 25.5, 42.5, 25.5, 4)).toBe(0);
    d.cmd({ type: 'toggleDoor', ...GATE });
    d.step();
    expect(eventsOf(d.take(), 'openingChanged')).toMatchObject([
      { ...GATE, kind: 'gate', state: 'open', hp: 80, maxHp: 80, barricade: 0, glass: false },
    ]);
    expect(grid.hasWallW(40, 25, 0)).toBe(false);
    d.cmd({ type: 'toggleDoor', ...GATE });
    d.cmd({ type: 'toggleDoor', ...GATE, lock: true });
    d.cmd({ type: 'toggleDoor', ...GATE });
    d.cmd({ type: 'toggleDoor', ...FENCE });
    d.step();
    expect(rejected(d.take())).toEqual(['locked', 'invalid-target']);
  });

  it('a gate takes planks (blocks sight from 2), a fence does not', () => {
    const s = sim({ x: 41, y: 24.5 });
    const d = driver(s);
    d.tools();
    d.cmd({ type: 'barricade', ...FENCE });
    d.cmd({ type: 'barricade', ...GATE });
    d.cmd({ type: 'barricade', ...GATE });
    d.step(BARRICADE_TICKS * 2 + 4);
    const ev = d.take();
    expect(rejected(ev)).toEqual(['invalid-target']);
    expect(eventsOf(ev, 'openingChanged').at(-1)).toMatchObject({ kind: 'gate', barricade: 2 });
    const grid = new TileGrid(s.world.map, s.world.openings);
    expect(lineOfSight(grid, 0, 38.5, 25.5, 42.5, 25.5)).toBe(false);
  });

  it('zombies bash a closed gate (crowd pressure too) until it breaks', () => {
    const zs = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 36.5, y: 23.5 + i * 0.6 }));
    const s = sim({ x: 46.5, y: 25.5 }, { zombies: zs, openings: { gateHp: 200 } });
    const d = driver(s);
    const levels: number[] = [];
    let broken = false;
    for (let i = 0; i < 3000 && !broken; i++) {
      if (i % 100 === 0) d.cmd({ type: 'debugNoise', x: 44.5, y: 25.5, radiusTiles: 40 });
      d.step();
      for (const e of d.take()) {
        if (e.type === 'openingPressure' && e.kind === 'gate') levels.push(e.level);
        if (e.type === 'openingChanged' && e.kind === 'gate' && e.state === 'broken') broken = true;
      }
    }
    expect(Math.max(...levels)).toBeGreaterThan(0);
    expect(broken).toBe(true);
  });
});

describe('openings timed: determinism and save', () => {
  const script = (s: Sim, upTo: number, from = 0) => {
    const d = driver(s);
    const hashes: number[] = [];
    for (let i = from; i < upTo; i++) {
      if (i === 0) d.tools(4, 8);
      if (i === 2) d.cmd({ type: 'barricade', ...WINDOW });
      if (i === 3) d.cmd({ type: 'barricade', ...WINDOW });
      if (i === 200) d.cmd({ type: 'debugOpening', ...DOOR, state: 'broken' });
      if (i % 50 === 0) d.cmd({ type: 'debugNoise', x: 25.5, y: 22.5, radiusTiles: 40 });
      d.step();
      hashes.push(s.hash());
    }
    return hashes;
  };
  const opts = { zombies: [{ x: 12.5, y: 22.5 }], openings: { barricade: { plankHp: 6 } } };

  it('same commands → same hashes; save mid-barricade / with planks → same hash on load', () => {
    const a = sim({ x: 21, y: 22.5 }, opts);
    const b = sim({ x: 21, y: 22.5 }, opts);
    expect(script(a, 400)).toEqual(script(b, 400));

    const c = sim({ x: 21, y: 22.5 }, opts);
    script(c, 40);
    expect(s0(c).current).toBeDefined();
    const c2 = createSim({ ...simOpts(opts), load: c.save() });
    expect(c2.hash()).toBe(c.hash());
    for (let i = 0; i < 300; i++) {
      c.step();
      c2.step();
    }
    expect(c2.hash()).toBe(c.hash());
    expect(c.world.openings.states.size).toBeGreaterThan(0);
  });

  it('cleared glass and planks survive save / load', () => {
    const s = sim({ x: 21, y: 22.5 });
    const d = driver(s);
    d.cmd({ type: 'debugOpening', ...WINDOW, state: 'broken' });
    d.cmd({ type: 'removeGlass', ...WINDOW });
    d.step(70);
    d.tools();
    d.cmd({ type: 'barricade', ...WINDOW });
    d.step(BARRICADE_TICKS + 2);
    expect(view(s, WINDOW)).toMatchObject({ state: OS.broken, planks: 1, cleared: 1 });
    const l = createSim({ ...simOpts({}), spawn: { x: 21, y: 22.5 }, load: s.save() });
    expect(l.hash()).toBe(s.hash());
    expect(view(l, WINDOW)).toEqual(view(s, WINDOW));
    expect(l.drainView()?.openings).toContainEqual(
      expect.objectContaining({ ...WINDOW, barricade: 1, glass: false, state: 'broken' }),
    );
  });
});

const s0 = (s: Sim) =>
  s.world.items!.players.get(s.world.c.StableId.value[s.world.players.get(0)!]!)!;

function simOpts(o: { openings?: Record<string, unknown>; zombies?: { x: number; y: number }[] }) {
  return {
    seed: 9,
    map: buildMap(roomSpec),
    spawn: { x: 21, y: 22.5 },
    content: content(o.openings),
    dev: true,
    clockStart: NOON,
    combatConfig: harmless,
    ...(o.zombies ? { spawnZombies: o.zombies } : {}),
  };
}
