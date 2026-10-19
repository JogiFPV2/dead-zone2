/* eslint-disable no-restricted-globals -- the DZ_SHOTS env switch of the debug picture, not sim state. */
import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import type { SimEvent, SimZombieSpawn } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { NOON, eventsOf } from '../test/ai-fixtures.js';
import { baseContent, fixturePack } from '../test/content-fixtures.js';
import { buildMap, type MapSpec } from '../test/fixtures.js';
import { createSim, type Sim } from '../sim.js';
import { furnitureActionsView, objectFurnitureId } from '../furniture/menu.js';
import { send } from '../test/content-fixtures.js';
import { FURNITURE_REASONS_PL } from '@deadzone/content';
import { FURNITURE_REASONS } from '@deadzone/protocol';
import { TileGrid } from '../world/grid.js';
import { FF } from '../world/furniture.js';
import { tileKey } from '../items/store.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';
import { openingKey, OS } from '../openings/state.js';

/**
 * Pushing / pulling / rotating furniture (docs 9.61, `physics/furniture.ts`). Fixture pieces:
 * - crate 1×1 storage (no content weight: 1 tile × `kgPerTile` 35 kg)
 * - sofa 2×1 placeable 60 kg (push 70 kg at strength 0 → ok; pull × 0.7 = 49 → too heavy)
 * - safe 1×1 placeable 200 kg (too heavy)
 * - dresser 1×2 placeable 150 kg (door tests, with a stronger character)
 * - bath 2×1 placeable 60 kg and shower 1×1 (no footprint): fixtures (`furnitureFixed`)
 * - table 2×1 placeable 20 kg with a surface, TV 12 kg `onSurface` (carried with the table)
 * The fixture pack has no strength skill (level 0): push 70 kg, pull 49 kg. With the base pack
 * an average character (strength 5) pushes 105 kg and pulls 73.5 kg (see 'pull limit').
 */
function content(): ContentBundle {
  const pack = fixturePack({
    furnitureFootprint: true,
    furnitureFixed: ['fixture:mv-bath', 'fixture:mv-shower'],
  });
  return buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files,
        {
          path: 'containers/furniture.json',
          json: [
            {
              id: 'fixture:mv-crate',
              name: 'container.fixture.mvcrate',
              category: 'other',
              capacityKg: 20,
            },
          ],
        },
        {
          path: 'items/furniture.json',
          json: [
            {
              id: 'fixture:mv-sofa',
              name: 'item.fixture.mvsofa',
              kind: 'placeable',
              weightKg: 60,
              placeable: { sleepSurface: 'sofa', footprint: { w: 2, h: 1 } },
            },
            {
              id: 'fixture:safe',
              name: 'item.fixture.safe',
              kind: 'placeable',
              weightKg: 200,
              placeable: { footprint: { w: 1, h: 1 } },
            },
            {
              id: 'fixture:dresser',
              name: 'item.fixture.dresser',
              kind: 'placeable',
              weightKg: 150,
              placeable: { footprint: { w: 1, h: 2 } },
            },
            {
              id: 'fixture:mv-bath',
              name: 'item.fixture.mvbath',
              kind: 'placeable',
              weightKg: 60,
              placeable: { footprint: { w: 2, h: 1 } },
            },
            {
              id: 'fixture:mv-shower',
              name: 'item.fixture.mvshower',
              kind: 'placeable',
              weightKg: 40,
              placeable: {},
            },
            {
              id: 'fixture:mv-table',
              name: 'item.fixture.mvtable',
              kind: 'placeable',
              weightKg: 20,
              placeable: { footprint: { w: 2, h: 1 }, surfaceHeightM: 0.75 },
            },
            {
              id: 'fixture:mv-tv',
              name: 'item.fixture.mvtv',
              kind: 'placeable',
              weightKg: 12,
              placeable: { onSurface: true },
            },
          ],
        },
      ],
    },
  ]);
}

const CONTENT = content();

function sim(
  objects: MapSpec['objects'],
  spawn: { x: number; y: number },
  extra: Partial<MapSpec> = {},
  opts: { physicsConfig?: PhysicsConfig; zombies?: SimZombieSpawn[]; seed?: number } = {},
): Sim {
  return createSim({
    seed: opts.seed ?? 5,
    map: buildMap({ width: 64, height: 64, ...(objects ? { objects } : {}), ...extra }),
    spawn,
    content: CONTENT,
    dev: true,
    clockStart: NOON,
    ...(opts.physicsConfig ? { physicsConfig: opts.physicsConfig } : {}),
    ...(opts.zombies ? { spawnZombies: opts.zombies } : {}),
  });
}

const id = (x: number, y: number, n = 0) => objectFurnitureId(x, y, 0, n);
const blocks = (s: Sim, x: number, y: number) =>
  ((s.world.furniture?.flags(x, y, 0) ?? 0) & FF.blocks) !== 0;

/** Runs until the current action is done (max `limit` ticks); returns the events. */
function finish(s: Sim, limit = 400): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let i = 0; i < limit; i++) {
    s.step();
    ev.push(...s.drainEvents());
    if (!s.getAction()) break;
  }
  return ev;
}

describe('furniture: push / pull one tile', () => {
  it('push moves a crate one tile away from the player (timed, event, footprint, storage)', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    const st = s.world.items!;
    const before = st.worldByTile.get(tileKey(10, 10, 0));
    expect(before?.length).toBe(1);
    const c = s.canMoveFurniture(id(10, 10), 'push');
    expect(c).toMatchObject({ ok: true, weightKg: 35, dx: 1, dy: 0 });
    expect(c.strengthKg).toBeCloseTo(70);
    expect(s.pushFurniture(id(10, 10))).toBeUndefined();
    expect(s.getAction()?.kind).toBe('moveFurniture');
    const ev = finish(s);
    const moved = eventsOf(ev, 'furnitureMoved');
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      cause: 'push',
      playerId: 0,
      contentId: 'fixture:mv-crate',
      fromId: id(10, 10),
      toId: id(11, 10),
      fromX: 10,
      x: 11,
      y: 10,
      w: 1,
      h: 1,
    });
    expect(eventsOf(ev, 'chunkChanged').some((e) => e.reason === 'object')).toBe(true);
    expect([blocks(s, 10, 10), blocks(s, 11, 10)]).toEqual([false, true]);
    // The storage went with it (same container, new tile).
    expect(st.worldByTile.get(tileKey(10, 10, 0))).toBeUndefined();
    expect(st.worldByTile.get(tileKey(11, 10, 0))).toEqual(before);
    expect(st.containers.get(before![0]!)).toMatchObject({ x: 11, y: 10 });
    // Takes time: the duration grows with weight / strength (1 s × (1 + 1.5 × 0.5)).
    expect(c.ticks).toBe(35);
    // Endurance cost, a scrape noise.
    expect(s.getSurvival()!.stats.endurance).toBeLessThan(100);
  });

  it('pull moves the piece towards the player, who steps back one tile', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 11.5, y: 10.5 });
    expect(s.canMoveFurniture(id(10, 10), 'pull')).toMatchObject({ ok: true, dx: 1, dy: 0 });
    expect(s.pullFurniture(id(10, 10))).toBeUndefined();
    const ev = finish(s);
    expect(eventsOf(ev, 'furnitureMoved')[0]).toMatchObject({ cause: 'pull', x: 11, y: 10 });
    expect(s.getPlayer()!.x).toBeCloseTo(12.5, 3);
    expect(blocks(s, 11, 10)).toBe(true);
  });

  it('pull is weaker than push: a 60 kg sofa pushes, does not pull; a 200 kg safe never moves', () => {
    const s = sim(
      [
        { contentId: 'fixture:mv-sofa', x: 10, y: 10 },
        { contentId: 'fixture:safe', x: 10, y: 14 },
      ],
      { x: 9.5, y: 10.5 },
    );
    expect(s.canMoveFurniture(id(10, 10), 'push')).toMatchObject({ ok: true, weightKg: 60 });
    const pull = s.canMoveFurniture(id(10, 10), 'pull');
    expect(pull).toMatchObject({ ok: false, reason: 'too-heavy', weightKg: 60 });
    expect(pull.strengthKg).toBeCloseTo(49);
    expect(s.pullFurniture(id(10, 10))).toBe('too-heavy');
    expect(s.getAction()).toBeNull();
    const t = sim([{ contentId: 'fixture:safe', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    expect(t.pushFurniture(id(10, 10))).toBe('too-heavy');
    // Stronger (strength level 5 → × 1.5) still not 200 kg; a much stronger config does it.
    const cfg = { ...DEFAULT_PHYSICS_CONFIG.furniture, basePushKg: 250 };
    const u = sim(
      [{ contentId: 'fixture:safe', x: 10, y: 10 }],
      { x: 9.5, y: 10.5 },
      {},
      {
        physicsConfig: { ...DEFAULT_PHYSICS_CONFIG, furniture: cfg },
      },
    );
    expect(u.pushFurniture(id(10, 10))).toBeUndefined();
  });

  it('tired / wounded / loaded characters are weaker', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    const fresh = s.canMoveFurniture(id(10, 10), 'push').strengthKg;
    const eid = s.world.players.get(0)!;
    s.world.survival!.vitals.fatigue[eid] = 100;
    const tired = s.canMoveFurniture(id(10, 10), 'push').strengthKg;
    expect(tired).toBeCloseTo(fresh * 0.6);
  });

  it('out of reach, no piece, flag off', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 5.5, y: 10.5 });
    expect(s.pushFurniture(id(10, 10))).toBe('out-of-range');
    expect(s.pushFurniture(id(20, 20))).toBe('invalid-target');
    expect(s.pushFurniture(12345)).toBe('invalid-target');
  });
});

describe('furniture: collisions (every occupied tile after the move / rotation)', () => {
  // Wall column on the west edge of x = 50 (y 0..63), wall on the north edge of (40, 21).
  const walls: Partial<MapSpec> = {
    wallW: (x) => x === 50,
    wallN: (x, y) => x === 40 && y === 21,
  };

  it('a 2×1 sofa pushed into a wall stops: the leading tile cannot cross it', () => {
    const s = sim([{ contentId: 'fixture:mv-sofa', x: 47, y: 30 }], { x: 46.5, y: 30.5 }, walls);
    expect(s.pushFurniture(id(47, 30))).toBeUndefined();
    finish(s);
    expect([blocks(s, 48, 30), blocks(s, 49, 30)]).toEqual([true, true]);
    // Walk up to it again and push: (49, 30)–(50, 30) would cross the wall at x = 50.
    s.world.c.Position.x[s.world.players.get(0)!] = 47.5;
    expect(s.canMoveFurniture(id(48, 30), 'push')).toMatchObject({ ok: false, reason: 'wall' });
    expect(s.pushFurniture(id(48, 30))).toBe('wall');
  });

  it('rotation: 2×1 → 1×2 about the north-west tile; blocked by a wall edge or a piece', () => {
    const s = sim([{ contentId: 'fixture:mv-sofa', x: 20, y: 20 }], { x: 19.5, y: 20.5 }, walls);
    expect(s.rotateFurniture(id(20, 20))).toBeUndefined();
    const ev = finish(s);
    expect(eventsOf(ev, 'furnitureMoved')[0]).toMatchObject({
      cause: 'rotate',
      x: 20,
      y: 20,
      rot: 1,
      w: 1,
      h: 2,
    });
    expect([blocks(s, 20, 20), blocks(s, 21, 20), blocks(s, 20, 21)]).toEqual([true, false, true]);
    // A sofa at (40, 20): rotated it would straddle the wall on the north edge of (40, 21).
    const t = sim([{ contentId: 'fixture:mv-sofa', x: 40, y: 20 }], { x: 39.5, y: 20.5 }, walls);
    expect(t.rotateFurniture(id(40, 20))).toBe('wall');
    // A crate on (30, 21) blocks the rotation of a sofa at (30, 20).
    const u = sim(
      [
        { contentId: 'fixture:mv-sofa', x: 30, y: 20 },
        { contentId: 'fixture:mv-crate', x: 30, y: 21 },
      ],
      { x: 29.5, y: 20.5 },
    );
    expect(u.rotateFurniture(id(30, 20))).toBe('no-space');
  });

  it('pushing into another piece or a zombie: no-space; no room behind a puller: no-space', () => {
    const s = sim(
      [
        { contentId: 'fixture:mv-sofa', x: 10, y: 10 },
        { contentId: 'fixture:mv-crate', x: 12, y: 10 },
      ],
      { x: 9.5, y: 10.5 },
    );
    expect(s.pushFurniture(id(10, 10))).toBe('no-space');
    const z = sim(
      [{ contentId: 'fixture:mv-crate', x: 10, y: 10 }],
      { x: 9.5, y: 10.5 },
      {},
      {
        zombies: [{ x: 11.5, y: 10.5 }],
      },
    );
    expect(z.pushFurniture(id(10, 10))).toBe('no-space');
    // Pull with a wall behind the player: the player cannot step back.
    const p = sim([{ contentId: 'fixture:mv-crate', x: 47, y: 10 }], { x: 49.5, y: 10.5 }, walls);
    p.world.c.Position.x[p.world.players.get(0)!] = 48.5;
    expect(p.canMoveFurniture(id(47, 10), 'pull').ok).toBe(true);
    const q = sim([{ contentId: 'fixture:mv-crate', x: 48, y: 10 }], { x: 49.5, y: 10.5 }, walls);
    expect(q.canMoveFurniture(id(48, 10), 'pull')).toMatchObject({ ok: false, reason: 'no-space' });
  });
});

describe('furniture: save / load, determinism', () => {
  const run = (moves: boolean) => {
    const s = sim([{ contentId: 'fixture:mv-sofa', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    if (moves) {
      s.pushFurniture(id(10, 10));
      finish(s);
      s.world.c.Position.x[s.world.players.get(0)!] = 10.5;
      s.rotateFurniture(id(11, 10));
      finish(s);
    }
    for (let i = 0; i < 40; i++) s.step();
    return s;
  };

  it('same moves → same hashes; a move changes the hash', () => {
    expect(run(true).hash()).toBe(run(true).hash());
    expect(run(true).hash()).not.toBe(run(false).hash());
  });

  it('the moved placement survives save / load (map overridden, same hash afterwards)', () => {
    const a = run(true);
    expect([...a.world.physics.furnitureMoves.values()]).toEqual([
      { contentId: 'fixture:mv-sofa', x: 11, y: 10, z: 0, rot: 1 },
    ]);
    const b = createSim({
      seed: 5,
      map: buildMap({
        width: 64,
        height: 64,
        objects: [{ contentId: 'fixture:mv-sofa', x: 10, y: 10 }],
      }),
      spawn: { x: 9.5, y: 10.5 },
      content: CONTENT,
      dev: true,
      clockStart: NOON,
      load: a.save(),
    });
    expect(b.hash()).toBe(a.hash());
    expect([blocks(b, 10, 10), blocks(b, 11, 10), blocks(b, 11, 11)]).toEqual([false, true, true]);
    for (let i = 0; i < 40; i++) {
      a.step();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
    // Moving it back home removes the override (state as never moved).
    expect(b.world.physics.furnitureMoves.size).toBe(1);
  });

  it('moving back to the original placement drops the override', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    s.pushFurniture(id(10, 10));
    finish(s);
    expect(s.world.physics.furnitureMoves.size).toBe(1);
    // Player now east of it at 12.5: pull it back west? Push from the east instead.
    s.world.c.Position.x[s.world.players.get(0)!] = 12.5;
    expect(s.pushFurniture(id(11, 10))).toBeUndefined();
    finish(s);
    expect(s.world.physics.furnitureMoves.size).toBe(0);
    expect(blocks(s, 10, 10)).toBe(true);
  });
});

describe('furniture against a door vs the crowd (#66 / #129)', () => {
  /** Room x/y ∈ [20, 30) with a door in the west wall at (20, 25) (edge id 2). */
  const room: Partial<MapSpec> = {
    wallW: (x, y) => (x === 20 || x === 30) && y >= 20 && y < 30,
    wallN: (x, y) => (y === 20 || y === 30) && x >= 20 && x < 30,
    edgeId: (x, y) => (x === 20 && y === 25 ? 2 : 1),
    edgeKinds: [null, 'wall', 'door'],
  };
  const strong: PhysicsConfig = {
    ...DEFAULT_PHYSICS_CONFIG,
    furniture: { ...DEFAULT_PHYSICS_CONFIG.furniture, basePushKg: 200 },
  };
  const crowd = (n: number): SimZombieSpawn[] =>
    Array.from({ length: n }, (_, i) => ({ x: 13.5 - (i % 2), y: 25.5 + ((i >> 1) % 4) - 1.5 }));
  const KEY = openingKey(1, 20, 25, 0);

  /** Ticks until the door breaks (−1 = not within `limit`), crowd drawn by noise in the room. */
  function siege(block: boolean, n: number, limit = 3000) {
    const s = sim([{ contentId: 'fixture:dresser', x: 21, y: 25 }], { x: 22.5, y: 25.5 }, room, {
      physicsConfig: strong,
      zombies: crowd(n),
      seed: 3,
    });
    if (block) {
      expect(s.pushFurniture(id(21, 25))).toBeUndefined();
      finish(s);
      expect(blocks(s, 20, 25)).toBe(true);
    }
    // Out of the holding reach (only the furniture holds the door).
    s.world.c.Position.x[s.world.players.get(0)!] = 27.5;
    let seq = 0;
    let broken = -1;
    let pushedBack = 0;
    let maxResist = 0;
    for (let i = 0; i < limit && broken < 0; i++) {
      // Own `seq` per sim (the hash covers it), so two runs are comparable.
      if (i % 60 === 0)
        s.enqueue({
          type: 'debugNoise',
          x: 25.5,
          y: 25.5,
          radiusTiles: 40,
          tick: s.tick,
          playerId: 0,
          seq: seq++,
        });
      s.step();
      const ev = s.drainEvents();
      for (const e of eventsOf(ev, 'furnitureMoved')) if (e.cause === 'crowd') pushedBack++;
      for (const e of eventsOf(ev, 'openingChanged')) if (e.state === 'broken') broken = i;
      maxResist = Math.max(maxResist, s.world.physics.pressure.get(KEY) ?? 0);
    }
    return { broken, pushedBack, hash: s.hash(), state: s.world.openings.states.get(KEY)?.state };
  }

  it('a door blocked by a heavy dresser holds longer than an unblocked one', () => {
    const open = siege(false, 4);
    const held = siege(true, 4);
    expect(open.broken).toBeGreaterThan(0);
    // 4 walkers: ~340 ticks without, ~720 with the 150 kg dresser behind the door.
    expect(held.broken < 0 || held.broken > 1.5 * open.broken).toBe(true);
    expect(open.state).toBe(OS.broken);
  });

  it('a big crowd shoves the dresser back into the room (cause crowd), deterministically', () => {
    const a = siege(true, 10);
    expect(a.pushedBack).toBeGreaterThan(0);
    expect(siege(true, 10).hash).toBe(a.hash);
  });
});

describe('furniture: fixtures never move (reason fixed)', () => {
  it('a fixture (content furnitureFixed) is fixed for push / pull / rotate and the command', () => {
    const s = sim(
      [
        { contentId: 'fixture:mv-bath', x: 10, y: 10 },
        { contentId: 'fixture:mv-shower', x: 10, y: 12 },
      ],
      { x: 9.5, y: 10.5 },
    );
    for (const mode of ['push', 'pull', 'rotate'] as const)
      expect(s.canMoveFurniture(id(10, 10), mode)).toMatchObject({ ok: false, reason: 'fixed' });
    expect(s.pushFurniture(id(10, 10))).toBe('fixed');
    expect(s.pullFurniture(id(10, 10))).toBe('fixed');
    expect(s.rotateFurniture(id(10, 10))).toBe('fixed');
    // Also a fixture without a footprint (shower): `fixed`, not `invalid-target`.
    expect(s.canMoveFurniture(id(10, 12), 'push').reason).toBe('fixed');
    expect(s.getAction()).toBeNull();
  });

  it('base pack: toilet, bath, shower, bathroom sink and kitchen sink are fixed', async () => {
    const content = await baseContent();
    const ids = [
      'base:toilet',
      'base:bathtub',
      'base:shower',
      'base:bathroom-sink',
      'base:kitchen-sink',
    ];
    expect(content.worldSettings.furnitureFixed).toEqual(ids);
    for (const contentId of ids) {
      const s = createSim({
        seed: 1,
        map: buildMap({ width: 32, height: 32, objects: [{ contentId, x: 10, y: 10 }] }),
        spawn: { x: 9.5, y: 10.5 },
        content,
        dev: true,
        clockStart: NOON,
      });
      expect(s.canMoveFurniture(id(10, 10), 'push').reason, contentId).toBe('fixed');
      expect(s.pullFurniture(id(10, 10)), contentId).toBe('fixed');
    }
  });
});

describe('furniture: specific reasons (wrong-side, no-space, wall)', () => {
  it('push / pull need the player beside an edge: corner or overlap = wrong-side, rotate ok', () => {
    // Sofa 2×1 on (10, 10)–(11, 10).
    const at = (x: number, y: number) =>
      sim([{ contentId: 'fixture:mv-sofa', x: 10, y: 10 }], { x, y });
    // Beside the long south edge, anywhere along it: push north / pull south.
    for (const x of [10.2, 11, 11.8]) {
      expect(at(x, 11.4).canMoveFurniture(id(10, 10), 'push')).toMatchObject({
        ok: true,
        dx: 0,
        dy: -1,
      });
    }
    expect(at(12.4, 10.5).canMoveFurniture(id(10, 10), 'push')).toMatchObject({ dx: -1, dy: 0 });
    // At a corner (diagonal): no direction.
    const corner = at(9.6, 9.6);
    expect(corner.canMoveFurniture(id(10, 10), 'push')).toMatchObject({
      ok: false,
      reason: 'wrong-side',
    });
    // Too heavy wins over the side (60 kg sofa, pull 49 kg); a light crate at a corner.
    expect(corner.pullFurniture(id(10, 10))).toBe('too-heavy');
    const crate = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.6, y: 9.6 });
    expect(crate.pullFurniture(id(10, 10))).toBe('wrong-side');
    expect(corner.canMoveFurniture(id(10, 10), 'rotate').ok).toBe(true);
    // Overlapping the footprint (e.g. spawned into it).
    expect(at(10.5, 10.5).canMoveFurniture(id(10, 10), 'push').reason).toBe('wrong-side');
  });

  it('base pack metal shelf: push at its side moves it; reasons are specific', async () => {
    const content = await baseContent();
    // Shelf rot 1 = 1×2 on (10, 10)–(10, 11). Average character (strength 5).
    const at = (x: number, y: number, extra: Partial<MapSpec> = {}) =>
      createSim({
        seed: 1,
        map: buildMap({
          width: 32,
          height: 32,
          objects: [{ contentId: 'base:metal-shelf', x: 10, y: 10, rot: 1 }],
          ...extra,
        }),
        spawn: { x, y },
        content,
        dev: true,
        clockStart: NOON,
      });
    // Long east side: push west, both halves.
    for (const y of [10.5, 11.5])
      expect(at(11.4, y).canMoveFurniture(id(10, 10), 'push')).toMatchObject({
        ok: true,
        dx: -1,
        dy: 0,
      });
    // Short south end: push north.
    expect(at(10.5, 12.4).canMoveFurniture(id(10, 10), 'push')).toMatchObject({ ok: true, dy: -1 });
    // A wall on the west edge of x = 10: pushing west from the east side.
    const wall = at(11.4, 10.5, { wallW: (x) => x === 10 });
    expect(wall.canMoveFurniture(id(10, 10), 'push').reason).toBe('wall');
    // Another piece west of it: no space.
    const crowded = createSim({
      seed: 1,
      map: buildMap({
        width: 32,
        height: 32,
        objects: [
          { contentId: 'base:metal-shelf', x: 10, y: 10, rot: 1 },
          { contentId: 'base:dresser', x: 9, y: 11 },
        ],
      }),
      spawn: { x: 11.4, y: 10.5 },
      content,
      dev: true,
      clockStart: NOON,
    });
    expect(crowded.canMoveFurniture(id(10, 10), 'push').reason).toBe('no-space');
    // Never a generic invalid-state from the usual places around it.
    for (const [x, y] of [
      [11.4, 10.5],
      [11.4, 11.5],
      [9.6, 10.5],
      [10.5, 9.6],
      [10.5, 12.4],
      [9.4, 9.4],
      [11.6, 12.6],
    ] as const)
      for (const mode of ['push', 'pull', 'rotate'] as const)
        expect(at(x, y).canMoveFurniture(id(10, 10), mode).reason).not.toBe('invalid-state');
  });
});

describe('furniture: pull limit (docs 9.61)', () => {
  it('average character (base pack, strength 5): push 105, pull 73.5, rotate 94.5 kg', async () => {
    const content = await baseContent();
    const s = createSim({
      seed: 1,
      map: buildMap({
        width: 32,
        height: 32,
        objects: [
          { contentId: 'base:metal-shelf', x: 10, y: 10 },
          { contentId: 'base:dresser', x: 10, y: 14 },
        ],
      }),
      spawn: { x: 10.5, y: 11.4 },
      content,
      dev: true,
      clockStart: NOON,
    });
    const f = DEFAULT_PHYSICS_CONFIG.furniture;
    const avg = f.basePushKg * (1 + f.perStrengthLevel * 5);
    const push = s.canMoveFurniture(id(10, 10), 'push');
    const pull = s.canMoveFurniture(id(10, 10), 'pull');
    expect(push.strengthKg).toBeCloseTo(avg, 3);
    expect(push.strengthKg).toBeCloseTo(105, 3);
    expect(pull.strengthKg).toBeCloseTo(avg * f.pullMul, 3);
    expect(pull.strengthKg).toBeCloseTo(73.5, 3);
    expect(s.canMoveFurniture(id(10, 10), 'rotate').strengthKg).toBeCloseTo(94.5, 3);
    // Metal shelf: tall 2×1 = 2 × 45 = 90 kg empty, up to 90 + 40 kg (capacity) full. The
    // average character pushes the empty frame, never pulls it, full or empty.
    expect(push.weightKg).toBeGreaterThanOrEqual(90);
    expect(pull).toMatchObject({ ok: false, reason: 'too-heavy' });
    const full = 90 + content.containers['base:metal-shelf']!.capacityKg;
    expect(full).toBe(130);
    expect(full).toBeGreaterThan(push.strengthKg);
    // A dresser (1 × 35 kg + contents ≤ 30 kg) is light enough to pull.
    expect(35 + content.containers['base:dresser']!.capacityKg).toBeLessThan(pull.strengthKg);
  });
});

describe('furniture: objects on the surface move with it (carried)', () => {
  // Table 2×1 on (10, 10)–(11, 10), TV on its east tile.
  const objs = [
    { contentId: 'fixture:mv-table', x: 10, y: 10 },
    { contentId: 'fixture:mv-tv', x: 11, y: 10 },
  ];

  it('push: the TV moves one tile with the table; the event lists it (fromId → toId)', () => {
    const s = sim(objs, { x: 10.5, y: 11.4 });
    expect(s.pushFurniture(id(10, 10))).toBeUndefined();
    const ev = eventsOf(finish(s), 'furnitureMoved');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      x: 10,
      y: 9,
      carried: [{ fromId: id(11, 10), toId: id(11, 9) }],
    });
    const moves = [...s.world.physics.furnitureMoves.values()];
    expect(moves).toContainEqual({ contentId: 'fixture:mv-tv', x: 11, y: 9, z: 0, rot: 0 });
    // The overlay map shows the TV on its new tile.
    const objects = s.world.map.getChunk(0, 0, 0)?.objects ?? [];
    expect(objects.filter((o) => o.contentId === 'fixture:mv-tv')).toEqual([
      { contentId: 'fixture:mv-tv', x: 11, y: 9 },
    ]);
  });

  it('rotate: the TV turns with the table (east tile → south tile, rot + 1)', () => {
    const s = sim(objs, { x: 9.5, y: 10.5 });
    expect(s.rotateFurniture(id(10, 10))).toBeUndefined();
    const ev = eventsOf(finish(s), 'furnitureMoved');
    expect(ev[0]).toMatchObject({ rot: 1, w: 1, h: 2, carried: [{ toId: id(10, 11) }] });
    expect([...s.world.physics.furnitureMoves.values()]).toContainEqual({
      contentId: 'fixture:mv-tv',
      x: 10,
      y: 11,
      z: 0,
      rot: 1,
    });
  });

  it('nothing on it: carried is empty; a TV elsewhere stays', () => {
    const s = sim(
      [
        { contentId: 'fixture:mv-table', x: 10, y: 10 },
        { contentId: 'fixture:mv-tv', x: 14, y: 10 },
      ],
      { x: 10.5, y: 11.4 },
    );
    s.pushFurniture(id(10, 10));
    expect(eventsOf(finish(s), 'furnitureMoved')[0]?.carried).toEqual([]);
    expect(s.world.physics.furnitureMoves.size).toBe(1);
  });
});

describe('furniture: action view and the furnitureMoves view (client, protocol 38)', () => {
  it('ActionView of moveFurniture carries the piece, the mode and the direction', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    s.drainView();
    expect(s.pushFurniture(id(10, 10))).toBeUndefined();
    s.step();
    expect(s.drainView()?.action?.furniture).toEqual({
      furnitureId: id(10, 10),
      mode: 'push',
      dirX: 1,
      dirY: 0,
    });
    finish(s);
    const t = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 10.5, y: 11.4 });
    t.pullFurniture(id(10, 10));
    t.step();
    expect(t.drainView()?.action?.furniture).toMatchObject({ mode: 'pull', dirX: 0, dirY: 1 });
    const r = sim([{ contentId: 'fixture:mv-sofa', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    r.rotateFurniture(id(10, 10));
    r.step();
    expect(r.drainView()?.action?.furniture).toMatchObject({ mode: 'rotate', dirX: 0, dirY: 0 });
  });

  it('first view after a load lists the moved furniture (and carried objects); then on change', () => {
    const map = () =>
      buildMap({
        width: 64,
        height: 64,
        objects: [
          { contentId: 'fixture:mv-table', x: 10, y: 10 },
          { contentId: 'fixture:mv-tv', x: 11, y: 10 },
        ],
      });
    const a = createSim({
      seed: 5,
      map: map(),
      spawn: { x: 10.5, y: 11.4 },
      content: CONTENT,
      dev: true,
      clockStart: NOON,
    });
    // No moves: no field in the first view.
    expect(a.drainView()?.furnitureMoves).toBeUndefined();
    a.pushFurniture(id(10, 10));
    let live: unknown;
    for (let i = 0; i < 200 && a.getAction(); i++) {
      a.step();
      live = a.drainView()?.furnitureMoves ?? live;
    }
    const expected = [
      {
        contentId: 'fixture:mv-table',
        fromX: 10,
        fromY: 10,
        fromRot: 0,
        x: 10,
        y: 9,
        z: 0,
        rot: 0,
        w: 2,
        h: 1,
        id: id(10, 9),
      },
      {
        contentId: 'fixture:mv-tv',
        fromX: 11,
        fromY: 10,
        fromRot: 0,
        x: 11,
        y: 9,
        z: 0,
        rot: 0,
        w: 1,
        h: 1,
        id: id(11, 9),
      },
    ];
    expect(live).toEqual(expected);
    const b = createSim({
      seed: 5,
      map: map(),
      spawn: { x: 10.5, y: 11.4 },
      content: CONTENT,
      dev: true,
      clockStart: NOON,
      load: a.save(),
    });
    expect(b.drainView()?.furnitureMoves).toEqual(expected);
    expect(b.hash()).toBe(a.hash());
    b.step();
    expect(b.drainView()?.furnitureMoves).toBeUndefined();
  });
});

describe('furniture debug picture (DZ_SHOTS → fiz-furniture.png)', () => {
  // Same room as the crowd tests: door in the west wall at (20, 25).
  const room: Partial<MapSpec> = {
    wallW: (x, y) => (x === 20 || x === 30) && y >= 20 && y < 30,
    wallN: (x, y) => (y === 20 || y === 30) && x >= 20 && x < 30,
    edgeId: (x, y) => (x === 20 && y === 25 ? 2 : 1),
    edgeKinds: [null, 'wall', 'door'],
  };
  const strong: PhysicsConfig = {
    ...DEFAULT_PHYSICS_CONFIG,
    furniture: { ...DEFAULT_PHYSICS_CONFIG.furniture, basePushKg: 200 },
  };

  it('dresser pushed against the door holds a crowd; sofa pushed and rotated', async () => {
    const zs = Array.from({ length: 4 }, (_, i) => ({
      x: 14.5 - (i % 2),
      y: 25.5 + ((i >> 1) % 3) - 1,
    }));
    const s = sim(
      [
        { contentId: 'fixture:dresser', x: 21, y: 25 },
        { contentId: 'fixture:mv-sofa', x: 24, y: 22 },
      ],
      { x: 22.5, y: 25.5 },
      room,
      { physicsConfig: strong, zombies: zs, seed: 3 },
    );
    expect(s.pushFurniture(id(21, 25))).toBeUndefined();
    finish(s);
    const eid = s.world.players.get(0)!;
    s.world.c.Position.x[eid] = 23.5;
    s.world.c.Position.y[eid] = 22.5;
    expect(s.pushFurniture(id(24, 22))).toBeUndefined();
    finish(s);
    s.world.c.Position.x[eid] = 24.5;
    expect(s.rotateFurniture(id(25, 22))).toBeUndefined();
    finish(s);
    s.world.c.Position.x[eid] = 27.5;
    s.world.c.Position.y[eid] = 27.5;
    let seq = 0;
    let level = 0;
    for (let i = 0; i < 160; i++) {
      if (i % 60 === 0)
        s.enqueue({
          type: 'debugNoise',
          x: 25.5,
          y: 25.5,
          radiusTiles: 40,
          tick: s.tick,
          playerId: 0,
          seq: seq++,
        });
      s.step();
      s.drainEvents();
      level = Math.max(level, s.world.physics.pressure.get(openingKey(1, 20, 25, 0)) ?? 0);
    }
    expect(blocks(s, 20, 25)).toBe(true);
    const { Canvas, nodeDeflate, writeFileIfNode } = await import('../test/topdown.js');
    const S = 40;
    const X0 = 10;
    const Y0 = 18;
    const cv = new Canvas(22 * S, 14 * S + 60);
    const P = (x: number, y: number): [number, number] => [(x - X0) * S, (y - Y0) * S + 60];
    for (let y = Y0; y < Y0 + 14; y++)
      for (let x = X0; x < X0 + 22; x++) {
        const [a, b] = P(x, y);
        const inside = x >= 20 && x < 30 && y >= 20 && y < 30;
        cv.rect(a + 1, b + 1, S - 2, S - 2, inside ? [44, 46, 52] : [32, 34, 38]);
        if (blocks(s, x, y)) cv.rect(a + 3, b + 3, S - 6, S - 6, [150, 110, 60]);
      }
    const g = s.world.openings;
    for (let y = 20; y <= 30; y++)
      for (let x = 20; x <= 30; x++) {
        const door = x === 20 && y === 25;
        if ((x === 20 || x === 30) && y < 30) {
          const [a, b] = P(x, y);
          cv.line(a, b, a, b + S, door ? [240, 210, 70] : [200, 200, 205], door ? 5 : 3);
        }
        if ((y === 20 || y === 30) && x < 30) {
          const [a, b] = P(x, y);
          cv.line(a, b, a + S, b, [200, 200, 205], 3);
        }
      }
    // Original places (ghosts) and moves.
    const ghost = (x: number, y: number, w: number, h: number) => {
      const [a, b] = P(x, y);
      cv.poly(
        [
          [a + 2, b + 2],
          [a + w * S - 2, b + 2],
          [a + w * S - 2, b + h * S - 2],
          [a + 2, b + h * S - 2],
        ],
        [120, 124, 130],
      );
    };
    ghost(21, 25, 1, 2);
    ghost(24, 22, 2, 1);
    cv.arrow(...P(21.5, 26), ...P(20.6, 26), [90, 220, 230], 3);
    cv.arrow(...P(25, 22.5), ...P(25.6, 22.5), [90, 220, 230], 3);
    for (const z of s.getZombies()) cv.disc(...P(z.x, z.y), S * 0.3, [230, 60, 60]);
    const p = s.getPlayer()!;
    cv.disc(...P(p.x, p.y), S * 0.3, [80, 150, 240]);
    const st = g.states.get(openingKey(1, 20, 25, 0));
    cv.text(10, 10, 'FURNITURE PUSH PULL ROTATE', [235, 235, 235], 3);
    cv.text(
      10,
      34,
      `DRESSER 150KG HOLDS DOOR  PRESSURE ${level}  DOOR HP ${Math.round(st?.hp ?? 0)}`,
      [240, 210, 70],
      2,
    );
    const png = cv.png(await nodeDeflate());
    expect(png.length).toBeGreaterThan(1000);
    const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } })
      .process?.env;
    if (env?.DZ_SHOTS) await writeFileIfNode(`${env.DZ_SHOTS}/fiz-furniture.png`, png);
  });
});

describe('furniture menu: push / pull / rotate (furnitureActions, useFurniture)', () => {
  const menu = (s: Sim, fid: number) =>
    furnitureActionsView(
      s.world,
      new TileGrid(s.world.openings.map, s.world.openings),
      s.world.players.get(0)!,
    ).find((f) => f.furnitureId === fid);
  const act = (s: Sim, fid: number, a: string) => menu(s, fid)?.actions.find((x) => x.id === a);

  it('lists push, pull and rotate with Polish labels and durations from canMoveFurniture', () => {
    const s = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    const m = menu(s, id(10, 10))!;
    const ids = m.actions.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['push', 'pull', 'rotate']));
    const push = act(s, id(10, 10), 'push')!;
    expect(push).toMatchObject({ labelPl: 'Pchnij', enabled: true });
    expect(push.durationSec).toBeGreaterThan(0);
    expect(act(s, id(10, 10), 'pull')!.labelPl).toBe('Ciągnij');
    expect(act(s, id(10, 10), 'rotate')!.labelPl).toBe('Obróć');
  });

  it('greys out with the reason of canMoveFurniture (too-heavy, no-space, out-of-range)', () => {
    const s = sim(
      [
        { contentId: 'fixture:safe', x: 10, y: 10 },
        { contentId: 'fixture:mv-sofa', x: 10, y: 14 },
        { contentId: 'fixture:mv-crate', x: 12, y: 14 },
      ],
      { x: 9.5, y: 10.5 },
    );
    const heavy = act(s, id(10, 10), 'push')!;
    expect(s.canMoveFurniture(id(10, 10), 'push').reason).toBe('too-heavy');
    expect(heavy).toMatchObject({ enabled: false, reason: 'too-heavy' });
    expect(heavy.reasonPl).toBe('Za ciężki — potrzeba 2 osób');
    // Out of reach: the move entries come back greyed out only in reach; the menu skips far pieces,
    // so check the reason through canMoveFurniture and the command path.
    expect(s.canMoveFurniture(id(10, 14), 'push').reason).toBe('out-of-range');
    // The sofa (2×1 at 10..11, 14) pushed east runs into the crate at (12, 14): no space.
    const t = sim(
      [
        { contentId: 'fixture:mv-sofa', x: 10, y: 14 },
        { contentId: 'fixture:mv-crate', x: 12, y: 14 },
      ],
      { x: 9.5, y: 14.5 },
    );
    expect(t.canMoveFurniture(id(10, 14), 'push').reason).toBe('no-space');
    expect(act(t, id(10, 14), 'push')).toMatchObject({
      enabled: false,
      reason: 'no-space',
      reasonPl: 'Brak miejsca',
    });
  });

  it('useFurniture push runs sim.pushFurniture (same result, same hash as the API)', () => {
    const objects = [{ contentId: 'fixture:mv-crate', x: 10, y: 10 }];
    const a = sim(objects, { x: 9.5, y: 10.5 });
    const b = sim(objects, { x: 9.5, y: 10.5 });
    send(a, { type: 'useFurniture', furnitureId: id(10, 10), actionId: 'push' });
    a.step();
    expect(a.getAction()?.kind).toBe('moveFurniture');
    const ev = finish(a);
    expect(eventsOf(ev, 'furnitureMoved')[0]).toMatchObject({ cause: 'push', x: 11, y: 10 });
    expect(blocks(a, 11, 10)).toBe(true);
    expect(b.pushFurniture(id(10, 10))).toBeUndefined();
    finish(b);
    expect(blocks(b, 11, 10)).toBe(true);
    // A greyed-out entry is rejected with its reason.
    const c = sim([{ contentId: 'fixture:safe', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    send(c, { type: 'useFurniture', furnitureId: id(10, 10), actionId: 'push' });
    c.step();
    expect(c.getAction()).toBeNull();
  });

  it('every reason canMoveFurniture returns is a menu reason with a Polish text', () => {
    // Reasons of `checkFurnitureMove` (physics/furniture.ts) plus `busy` of a full queue;
    // `invalid-target` (not a piece) shows no move entries at all.
    const found = [
      'fixed',
      'too-heavy',
      'wrong-side',
      'no-space',
      'wall',
      'out-of-range',
      'busy',
      'invalid-state',
    ];
    for (const r of found) {
      expect(FURNITURE_REASONS as readonly string[]).toContain(r);
      expect((FURNITURE_REASONS_PL as Record<string, string>)[r]).toBeTruthy();
    }
  });

  it('greyed entries keep fixed, wrong-side and wall (never invalid-state)', () => {
    const fixed = sim([{ contentId: 'fixture:mv-bath', x: 10, y: 10 }], { x: 9.5, y: 10.5 });
    for (const mode of ['push', 'pull', 'rotate'])
      expect(act(fixed, id(10, 10), mode)).toMatchObject({
        enabled: false,
        reason: 'fixed',
        reasonPl: 'Przymocowane',
      });
    // Diagonal to the crate: no push / pull direction.
    const diag = sim([{ contentId: 'fixture:mv-crate', x: 10, y: 10 }], { x: 9.6, y: 9.6 });
    expect(diag.canMoveFurniture(id(10, 10), 'push').reason).toBe('wrong-side');
    expect(act(diag, id(10, 10), 'push')).toMatchObject({ enabled: false, reason: 'wrong-side' });
    // A crate next to the wall at x = 50, pushed east.
    const wall = sim(
      [{ contentId: 'fixture:mv-crate', x: 49, y: 30 }],
      { x: 48.5, y: 30.5 },
      {
        wallW: (x) => x === 50,
      },
    );
    expect(wall.canMoveFurniture(id(49, 30), 'push').reason).toBe('wall');
    expect(act(wall, id(49, 30), 'push')).toMatchObject({
      enabled: false,
      reason: 'wall',
      reasonPl: 'Ściana na drodze',
    });
    // No move entry ever falls back to invalid-state in these cases.
    for (const s of [fixed, diag, wall])
      for (const f of furnitureActionsView(
        s.world,
        new TileGrid(s.world.openings.map, s.world.openings),
        s.world.players.get(0)!,
      ))
        for (const a of f.actions)
          if (['push', 'pull', 'rotate'].includes(a.id)) expect(a.reason).not.toBe('invalid-state');
  });

  it('no move entries when the physics flag is off', () => {
    const s = sim(
      [{ contentId: 'fixture:mv-crate', x: 10, y: 10 }],
      { x: 9.5, y: 10.5 },
      {},
      {
        physicsConfig: {
          ...DEFAULT_PHYSICS_CONFIG,
          furniture: { ...DEFAULT_PHYSICS_CONFIG.furniture, enabled: false },
        },
      },
    );
    const ids = menu(s, id(10, 10))?.actions.map((x) => x.id) ?? [];
    expect(ids).not.toContain('push');
  });
});
