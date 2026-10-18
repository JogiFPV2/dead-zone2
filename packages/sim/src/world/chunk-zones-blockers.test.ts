import {
  CHUNK_SIZE,
  simMapFromWorldSource,
  type SimZone,
  type WorldSource,
} from '@deadzone/protocol';
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_RADIUS } from '../core/constants.js';
import { createSim, type Sim } from '../sim.js';
import { NOON } from '../test/ai-fixtures.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';
import { gridWorld } from '../test/lod-fixtures.js';
import { move, run } from '../test/helpers.js';
import { SKIN, circleOverlaps, moveCircle, slideCircle } from './collision.js';
import { TileGrid } from './grid.js';

vi.setConfig({ testTimeout: 60_000 });

const R = PLAYER_RADIUS;
const bush = (cx: number, cy: number): SimZone => ({
  id: `bush-${cx}-${cy}`,
  role: 'bushes',
  z: 0,
  rects: [{ x: cx * CHUNK_SIZE + 4, y: cy * CHUNK_SIZE + 4, w: 6, h: 6 }],
});

describe('chunk zones (SimChunk.zones)', () => {
  it('maps with listChunks: zones of every chunk are cover/dark from the start', () => {
    const map = buildMap({
      zones: [{ id: 'map-dark', role: 'dark', z: 0, rects: [{ x: 0, y: 0, w: 2, h: 2 }] }],
      chunkZones: (cx, cy) =>
        cx === 1 && cy === 1
          ? [
              bush(1, 1),
              { id: 'cellar', role: 'dark', z: 0, rects: [{ x: 40, y: 50, w: 2, h: 2 }] },
            ]
          : undefined,
    });
    const sim = createSim({ seed: 1, map, content: fixtureContent(), spawn: { x: 10.5, y: 10.5 } });
    const ai = sim.world.ai!;
    expect(ai.coverZones.map((z) => z.id)).toEqual(['bush-1-1']);
    expect(ai.darkZones.map((z) => z.id)).toEqual(['map-dark', 'cellar']);
  });

  // Lazy world: a bush zone on chunk (25, 20), 5 chunks east of the spawn (LOD radius 3 + 1).
  const ZONE_CHUNK = { cx: 25, cy: 20 };
  const lazyWorld = (): WorldSource => {
    const base = gridWorld({ w: 48, h: 48 });
    return {
      ...base,
      getChunk: (cx, cy, z) => {
        const c = base.getChunk(cx, cy, z);
        return c && cx === ZONE_CHUNK.cx && cy === ZONE_CHUNK.cy && z === 0
          ? { ...c, zones: [bush(cx, cy)] }
          : c;
      },
    };
  };
  const open = (world: WorldSource, load?: Uint8Array): Sim =>
    createSim({
      seed: 5,
      map: simMapFromWorldSource(world),
      world,
      content: fixtureContent(),
      dev: true,
      clockStart: NOON,
      spawn: { x: 20 * CHUNK_SIZE + 16.5, y: 20 * CHUNK_SIZE + 16.5 },
      floorLoot: true,
      walkSpeedTilesPerSecond: 12,
      lod: { defaultZombiesPerChunk: 0 },
      ...(load ? { load } : {}),
    });
  const ids = (s: Sim): string[] => s.world.ai!.coverZones.map((z) => z.id);
  let seq = 1000;
  /** Same command (same seq) to every sim. */
  const moveAll = (sims: Sim[], dx: number): void => {
    seq++;
    for (const s of sims) s.enqueue({ type: 'move', dx, dy: 0, tick: s.tick, playerId: 0, seq });
  };
  const chunkX = (s: Sim): number => Math.floor(s.getPlayer()!.x / CHUNK_SIZE);

  it('lazy chunks (LOD): zones appear when the chunk loads, go when it is released; save/load', () => {
    const world = lazyWorld();
    const a = open(world);
    a.step();
    expect(ids(a)).toEqual([]);
    moveAll([a], 1);
    let t = 0;
    while (chunkX(a) < 22 && t++ < 400) a.step();
    a.step();
    expect(ids(a)).toEqual(['bush-25-20']);
    // Save while the zone is live: the load rebuilds it from the live chunks.
    const b = open(world, a.save());
    expect(b.hash()).toBe(a.hash());
    moveAll([a, b], -1);
    a.step();
    b.step();
    expect(ids(b)).toEqual(['bush-25-20']);
    expect(b.hash()).toBe(a.hash());
    t = 0;
    while (chunkX(a) > 19 && t++ < 400) {
      a.step();
      b.step();
    }
    expect(ids(a)).toEqual([]);
    expect(ids(b)).toEqual([]);
    expect(b.hash()).toBe(a.hash());
    // Back again: added again.
    moveAll([a, b], 1);
    t = 0;
    while (chunkX(a) < 22 && t++ < 400) {
      a.step();
      b.step();
    }
    a.step();
    b.step();
    expect(ids(a)).toEqual(['bush-25-20']);
    expect(b.hash()).toBe(a.hash());
  });
});

describe('static blockers (SimChunk.blockers: pylon / mast feet)', () => {
  // A 0.6 m pylon foot at x 20..20.6, y 10..10.6.
  const FOOT = { x0: 20, y0: 10, x1: 20.6, y1: 10.6 };
  const map = buildMap({ blockers: [FOOT] });

  it('moveCircle stops before a foot; circleOverlaps sees it', () => {
    const grid = new TileGrid(map);
    const p = moveCircle(grid, 0, 15, 10.3, 10, 0, R);
    expect(p.x).toBeCloseTo(20 - R - SKIN, 3);
    expect(circleOverlaps(grid, 0, 20.3, 10.6 + R + 0.01, R)).toBe(false);
    expect(circleOverlaps(grid, 0, 20.3, 10.6 + R - 0.05, R)).toBe(true);
    // Other levels have no blockers.
    expect(circleOverlaps(grid, 0, 30, 30, R)).toBe(false);
  });

  it('slideCircle slides around a foot, and a player walking into it stops', () => {
    const grid = new TileGrid(map);
    const out = slideCircle(grid, 0, 15, 10.4, 10, 0, R);
    // Pushed around the corner, never inside.
    expect(circleOverlaps(grid, 0, out.x, out.y, R - SKIN)).toBe(false);
    const sim = createSim({ seed: 1, map, spawn: { x: 15.5, y: 10.3 } });
    move(sim, 1, 0);
    run(sim, 60);
    const x = sim.getPlayer()!.x;
    expect(x).toBeLessThan(20 - R + 0.01);
    expect(x).toBeGreaterThan(17);
  });

  it('a foot in the next chunk blocks across the chunk border', () => {
    const m = buildMap({ blockers: [{ x0: 32, y0: 10, x1: 32.5, y1: 10.5 }] });
    const grid = new TileGrid(m);
    expect(moveCircle(grid, 0, 28, 10.25, 6, 0, R).x).toBeCloseTo(32 - R - SKIN, 3);
  });
});
