import { buildContentBundle, type ContentBundle } from '@deadzone/content';
import { CHUNK_SIZE } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { NOON } from '../test/ai-fixtures.js';
import { fixturePack, send } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { createSim, type Sim } from '../sim.js';
import { TileGrid } from '../world/grid.js';
import { lineOfSight, walkableLine } from '../world/los.js';
import { findPath } from '../nav/astar.js';
import { canStep } from '../nav/grid-nav.js';
import { FF } from '../world/furniture.js';
import { furnitureActionsView, objectFurnitureId } from './menu.js';

/**
 * Furniture footprint (docs 9.49, `worldSettings.furnitureFootprint`). Open floor 64×64:
 * - sofa 2×1 at (10, 10) rot 0 → (10, 10), (11, 10)
 * - sofa 2×1 at (20, 10) rot 1 → (20, 10), (20, 11)
 * - sofa 2×1 at (31, 5) rot 0 → across the chunk border: (31, 5), (32, 5)
 * - wardrobe 1×1 (tall) at (15, 20); a bed 1×2 (placeable, sleepSurface) at (40, 40) rot 1 → 2×1
 * - lamp (placeable light only, not furniture) at (5, 30).
 */
const OBJECTS = [
  { contentId: 'fixture:sofa', x: 10, y: 10 },
  { contentId: 'fixture:sofa', x: 20, y: 10, rot: 1 },
  { contentId: 'fixture:sofa', x: 31, y: 5 },
  { contentId: 'fixture:wardrobe', x: 15, y: 20 },
  { contentId: 'fixture:bed-big', x: 40, y: 40, rot: 1 },
  { contentId: 'fixture:lamp-fp', x: 5, y: 30 },
  { contentId: 'fixture:counter', x: 50, y: 10 },
  { contentId: 'fixture:counter', x: 50, y: 20, rot: 1 },
];

function content(footprint: boolean | undefined): ContentBundle {
  const pack = fixturePack(
    footprint === undefined
      ? {}
      : {
          furnitureFootprint: footprint,
          furnitureTall: ['fixture:wardrobe'],
          furnitureLongSideAccess: ['fixture:counter'],
        },
  );
  return buildContentBundle([
    {
      ...pack,
      files: [
        ...pack.files,
        {
          path: 'containers/furniture.json',
          json: [
            {
              id: 'fixture:sofa',
              name: 'container.fixture.sofa',
              category: 'other',
              capacityKg: 10,
              searchMin: 0.5,
              footprint: { w: 2, h: 1 },
            },
            {
              id: 'fixture:counter',
              name: 'container.fixture.counter',
              category: 'counter',
              capacityKg: 20,
              footprint: { w: 2, h: 1 },
            },
            {
              id: 'fixture:wardrobe',
              name: 'container.fixture.wardrobe',
              category: 'cabinet',
              capacityKg: 40,
            },
          ],
        },
        {
          path: 'items/furniture.json',
          json: [
            {
              id: 'fixture:bed-big',
              name: 'item.fixture.bedbig',
              kind: 'placeable',
              weightKg: 40,
              placeable: { sleepSurface: 'bed', footprint: { w: 1, h: 2 } },
            },
            {
              id: 'fixture:lamp-fp',
              name: 'item.fixture.lampfp',
              kind: 'placeable',
              weightKg: 2,
              placeable: { light: { radiusTiles: 4, intensity: 0.8 } },
            },
          ],
        },
      ],
    },
  ]);
}

const map = () => buildMap({ width: 64, height: 64, objects: OBJECTS });

function sim(footprint: boolean | undefined, spawn = { x: 8.5, y: 10.5 }, seed = 5): Sim {
  return createSim({
    seed,
    map: map(),
    spawn,
    content: content(footprint),
    dev: true,
    clockStart: NOON,
  });
}

const gridOf = (s: Sim) => new TileGrid(s.world.map, s.world.openings, s.world.furniture);

function walk(s: Sim, dx: number, dy: number, ticks: number): { x: number; y: number } {
  send(s, { type: 'move', dx, dy });
  for (let i = 0; i < ticks; i++) s.step();
  send(s, { type: 'move', dx: 0, dy: 0 });
  s.step();
  const p = s.getPlayer()!;
  return { x: p.x, y: p.y };
}

describe('furniture footprint: flag off (default) = behaviour as before', () => {
  it('the flag defaults to false; no index; furniture blocks nothing', () => {
    for (const f of [undefined, false]) {
      const s = sim(f);
      expect(s.world.furniture).toBeUndefined();
      const g = gridOf(s);
      expect(g.isBlocked(10, 10, 0)).toBe(false);
      expect(walkableLine(g, 0, 8.5, 10.5, 13.5, 10.5)).toBe(true);
      expect(lineOfSight(g, 0, 13.5, 20.5, 17.5, 20.5)).toBe(true);
      // Walks straight over the sofa.
      expect(walk(s, 1, 0, 60).x).toBeGreaterThan(12);
    }
  });

  it('same state hash with the flag absent and explicitly false', () => {
    const run = (f: boolean | undefined) => {
      const s = sim(f);
      const hashes: number[] = [];
      s.enqueue({ type: 'move', dx: 1, dy: 0.2, tick: s.tick, playerId: 0, seq: 0 });
      for (let i = 0; i < 200; i++) {
        s.step();
        if (i % 20 === 0) hashes.push(s.hash());
      }
      return hashes;
    };
    expect(run(false)).toEqual(run(undefined));
  });
});

describe('furniture footprint: flag on', () => {
  it('occupied tiles: rotation swaps sides, anchor NW, across a chunk border; tall flag', () => {
    const s = sim(true);
    const f = s.world.furniture!;
    const b = (x: number, y: number) => f.flags(x, y, 0);
    expect([b(10, 10), b(11, 10), b(12, 10), b(10, 11), b(9, 10)]).toEqual([
      FF.blocks,
      FF.blocks,
      0,
      0,
      0,
    ]);
    expect([b(20, 10), b(20, 11), b(21, 10)]).toEqual([FF.blocks, FF.blocks, 0]);
    expect(CHUNK_SIZE).toBe(32);
    expect([b(31, 5), b(32, 5), b(33, 5)]).toEqual([FF.blocks, FF.blocks, 0]);
    expect(b(15, 20)).toBe(FF.blocks | FF.tall);
    // Bed 1×2 at rot 1 → 2×1.
    expect([b(40, 40), b(41, 40), b(40, 41)]).toEqual([FF.blocks, FF.blocks, 0]);
    // A lamp is not furniture.
    expect(b(5, 30)).toBe(0);
  });

  it('collision: the player stops at the sofa and slides along it', () => {
    const s = sim(true);
    const p = walk(s, 1, 0, 60);
    expect(p.x).toBeLessThan(10);
    expect(p.x).toBeGreaterThan(9.5);
    const q = walk(s, 0, 1, 20);
    expect(q.y).toBeGreaterThan(11);
  });

  it('paths and straight lines go around; LOS blocked by tall furniture only', () => {
    const s = sim(true);
    const g = gridOf(s);
    expect(canStep(g, 0, 9, 10, 1, 0)).toBe(false);
    expect(walkableLine(g, 0, 8.5, 10.5, 13.5, 10.5)).toBe(false);
    const path = findPath(g, 0, 9, 10, 12, 10, 1000);
    expect(path.tiles).toBeDefined();
    for (let i = 0; i < path.tiles!.length; i += 2)
      expect(g.isBlocked(path.tiles![i]!, path.tiles![i + 1]!, 0)).toBe(false);
    // Sofa: low, the zombie sees over it. Wardrobe: tall, blocks sight.
    expect(lineOfSight(g, 0, 8.5, 10.5, 13.5, 10.5)).toBe(true);
    expect(lineOfSight(g, 0, 13.5, 20.5, 17.5, 20.5)).toBe(false);
  });

  it('search and the furniture menu from any tile next to the piece', () => {
    // East of the sofa's second tile: 2 tiles from the anchor centre (out of reach when off).
    for (const [f, ok] of [
      [true, true],
      [false, false],
    ] as const) {
      const s = sim(f, { x: 12.5, y: 10.5 });
      const ids = s.world.items!.worldByTile;
      let id = -1;
      for (const list of ids.values())
        for (const c of list) {
          const cont = s.world.items!.containers.get(c)!;
          if (cont.x === 10 && cont.y === 10) id = c;
        }
      expect(id).toBeGreaterThan(0);
      s.step();
      const near = s.drainView()?.nearby ?? [];
      expect(near.some((c) => c.id === id)).toBe(ok);
      send(s, { type: 'search', container: id });
      s.step();
      expect(s.getAction()?.kind === 'search').toBe(ok);
      const menu = furnitureActionsView(s.world, gridOf(s), s.world.players.get(0)!);
      const entry = menu.find((m) => m.furnitureId === objectFurnitureId(10, 10, 0, 0));
      expect(entry !== undefined).toBe(ok);
      if (ok) expect([entry!.x, entry!.y]).toEqual([11, 10.5]);
    }
  });

  it('shop counter: only from the sides along the long edge (customer +z, clerk at the wall), rot aware', () => {
    const reach = (x: number, y: number, ax: number, ay: number): boolean => {
      const s = sim(true, { x, y });
      let id = -1;
      for (const list of s.world.items!.worldByTile.values())
        for (const c of list) {
          const cont = s.world.items!.containers.get(c)!;
          if (cont.x === ax && cont.y === ay) id = c;
        }
      expect(id).toBeGreaterThan(0);
      s.step();
      return (s.drainView()?.nearby ?? []).some((c) => c.id === id);
    };
    // rot 0 at (50, 10): tiles (50, 10), (51, 10). Long edges: north (clerk) and south (customer).
    expect(reach(50.5, 11.5, 50, 10)).toBe(true);
    expect(reach(51.5, 11.5, 50, 10)).toBe(true);
    expect(reach(51.5, 9.5, 50, 10)).toBe(true);
    // Ends and corners: no.
    expect(reach(52.5, 10.5, 50, 10)).toBe(false);
    expect(reach(49.5, 10.5, 50, 10)).toBe(false);
    expect(reach(52.5, 11.5, 50, 10)).toBe(false);
    // rot 1 at (50, 20): tiles (50, 20), (50, 21); long edges are west / east.
    expect(reach(51.5, 21.5, 50, 20)).toBe(true);
    expect(reach(49.5, 20.5, 50, 20)).toBe(true);
    expect(reach(50.5, 22.5, 50, 20)).toBe(false);
    expect(reach(50.5, 19.5, 50, 20)).toBe(false);
  });

  it('deterministic: same seed → same hashes', () => {
    const run = () => {
      const s = sim(true);
      s.enqueue({ type: 'move', dx: 1, dy: 0.3, tick: s.tick, playerId: 0, seq: 0 });
      const h: number[] = [];
      for (let i = 0; i < 200; i++) {
        s.step();
        if (i % 25 === 0) h.push(s.hash());
      }
      return h;
    };
    expect(run()).toEqual(run());
  });
});
