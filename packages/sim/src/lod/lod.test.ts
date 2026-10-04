import { CHUNK_SIZE } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { buildMap } from '../test/fixtures.js';
import { survivalSim } from '../test/content-fixtures.js';
import { bang, gridWorld, lodSim, walk } from '../test/lod-fixtures.js';
import { START_CHUNK, testLog, WORLD_CHUNKS, worldMapKind } from '../test/world-map-fixture.js';
import { compileContent } from '../content/adapter.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { generateLoot } from '../items/loot.js';
import {
  cellOfChunk,
  cellTotal,
  ChunkLoot,
  coarseTotal,
  createLodWorld,
  DEFAULT_SIM_LOD,
  populateLod,
} from './state.js';
import type { Sim } from '../sim.js';

const total = (sim: Sim): number => {
  const s = sim.lodStats()!;
  return s.activeZombies + s.coarseZombies;
};
const placedContainers = (sim: Sim, cx: number, cy: number): number => {
  let n = 0;
  for (const c of sim.world.items!.containers.values()) {
    if (c.kind !== 'world' && c.kind !== 'ground' && c.kind !== 'hidden') continue;
    if (Math.floor(c.x / CHUNK_SIZE) === cx && Math.floor(c.y / CHUNK_SIZE) === cy) n++;
  }
  return n;
};

describe('sim LOD', () => {
  it('stays off on maps that fit the active area (demo maps, goldens unchanged)', () => {
    const sim = survivalSim(undefined, { map: buildMap({ width: 128, height: 128 }) });
    sim.step();
    expect(sim.lodStats()).toBeUndefined();
    expect(sim.world.lod).toBeUndefined();
  });

  it('activates the window around the player and spawns zombies only there', () => {
    const sim = lodSim(gridWorld({ w: 40, h: 40 }), 20, 20, { lod: { defaultZombiesPerChunk: 2 } });
    const start = total(sim);
    expect(start).toBeGreaterThan(40 * 40 * 2 - 200);
    for (let i = 0; i < 40; i++) sim.step();
    const s = sim.lodStats()!;
    expect(s.activeCells).toBe(49);
    expect(s.liveChunks).toBe(49);
    expect(s.activeZombies).toBeGreaterThan(60);
    expect(total(sim)).toBe(start);
    // Every zombie stands in the active window (Chebyshev ≤ 3 chunks + hysteresis).
    for (const z of sim.getZombies()) {
      expect(Math.abs(Math.floor(z.x / CHUNK_SIZE) - 20)).toBeLessThanOrEqual(4);
      expect(Math.abs(Math.floor(z.y / CHUNK_SIZE) - 20)).toBeLessThanOrEqual(4);
    }
    // Far chunks have no storage yet (lazy loot).
    expect(placedContainers(sim, 2, 2)).toBe(0);
    expect(placedContainers(sim, 20, 20)).toBeGreaterThan(0);
  });

  it('hysteresis: stepping back over a chunk edge does not fold the area again', () => {
    const sim = lodSim(gridWorld({ w: 40, h: 40 }), 20, 20, {
      walkSpeedTilesPerSecond: 16,
      lod: { defaultZombiesPerChunk: 0 },
    });
    sim.step();
    walk(sim, 1, 0, 50); // into chunk 21
    expect(Math.floor(sim.getPlayer()!.x / CHUNK_SIZE)).toBe(21);
    const cells = sim.lodStats()!.activeCells;
    expect(cells).toBe(56);
    walk(sim, -1, 0, 50); // back to 20
    expect(Math.floor(sim.getPlayer()!.x / CHUNK_SIZE)).toBe(20);
    expect(sim.lodStats()!.activeCells).toBe(56);
    expect(sim.lodStats()!.liveChunks).toBe(56);
  });

  it('folds zombies when the player leaves and unfolds them deterministically (hp kept)', () => {
    const run = (): { hashes: number[]; sim: Sim } => {
      const sim = lodSim(gridWorld({ w: 60, h: 20 }), 10, 10, {
        walkSpeedTilesPerSecond: 16,
        lod: { defaultZombiesPerChunk: 1.5 },
      });
      const hashes: number[] = [];
      for (let i = 0; i < 60; i++) sim.step();
      // Wound every zombie: folded zombies remember their hp.
      const Z = sim.world.c.Zombie;
      for (let e = 0; e < sim.world.capacity; e++) if (Z.is[e] === 1) Z.hp[e] = Math.fround(7);
      hashes.push(sim.hash());
      walk(sim, 1, 0, 30 * 20); // ~300 tiles east: the start area folds
      hashes.push(sim.hash());
      walk(sim, -1, 0, 30 * 20); // and back: it unfolds again
      for (let i = 0; i < 100; i++) sim.step();
      hashes.push(sim.hash());
      return { hashes, sim };
    };
    const a = run();
    const b = run();
    expect(a.hashes).toEqual(b.hashes);
    const sim = a.sim;
    expect(total(sim)).toBeGreaterThan(0);
    const hurt = sim.getZombies().filter((z) => z.hp === 7).length;
    expect(hurt).toBeGreaterThan(10);
  });

  it('conserves zombies while folding / unfolding and drifting', () => {
    const sim = lodSim(gridWorld({ w: 50, h: 50 }), 25, 25, {
      walkSpeedTilesPerSecond: 16,
      lod: {
        defaultZombiesPerChunk: 1,
        coarseTickEvery: 20,
        drift: { chance: 0.5, fraction: 0.5 },
      },
    });
    const start = total(sim);
    for (let k = 0; k < 4; k++) {
      walk(sim, 1, 0.3, 200);
      walk(sim, -0.4, -1, 200);
    }
    expect(total(sim)).toBe(start);
  });

  it('loud noise pulls coarse zombies towards it; arrivals investigate', () => {
    const sim = lodSim(gridWorld({ w: 60, h: 60 }), 30, 30, {
      lod: { defaultZombiesPerChunk: 0, coarseTickEvery: 10, minSpawnDistTiles: 8 },
    });
    // A horde 6 chunks east of the player (coarse).
    const lod = sim.world.lod!;
    const cell = cellOfChunk(lod, 36, 30);
    lod.counts[cell * lod.types] = 30;
    sim.step();
    expect(sim.lodStats()!.activeZombies).toBe(0);
    const p = sim.getPlayer()!;
    bang(sim, p.x, p.y, 120);
    for (let i = 0; i < 200; i++) sim.step();
    expect(cellTotal(lod, cell)).toBeLessThan(30);
    const zs = sim.getZombies();
    expect(zs.length).toBeGreaterThan(5);
    expect(zs.some((z) => z.state === 'investigate' || z.state === 'chase')).toBe(true);
  });

  it('lazy loot: unchanged chunks are released and regenerated identically, changed ones stay', () => {
    const sim = lodSim(gridWorld({ w: 40, h: 12 }), 6, 6, {
      walkSpeedTilesPerSecond: 16,
      lod: { defaultZombiesPerChunk: 0 },
    });
    sim.step();
    const st = sim.world.items!;
    const lod = sim.world.lod!;
    const sig = (cx: number, cy: number): string =>
      [...st.containers.values()]
        .filter(
          (c) =>
            c.kind !== 'bag' &&
            c.kind !== 'inventory' &&
            Math.floor(c.x / CHUNK_SIZE) === cx &&
            Math.floor(c.y / CHUNK_SIZE) === cy,
        )
        .map((c) => `${c.kind}@${c.x},${c.y}:${c.items.map((i) => st.items.get(i)!.def).join('+')}`)
        .sort()
        .join('|');
    const before4 = sig(4, 4);
    expect(before4).not.toBe('');
    // Search a cabinet in chunk (6, 4): generated loot changes the chunk.
    const cab = [...st.containers.values()].find(
      (c) =>
        c.kind === 'world' &&
        Math.floor(c.x / CHUNK_SIZE) === 6 &&
        Math.floor(c.y / CHUNK_SIZE) === 4,
    )!;
    generateLoot(st, cab, sim.world.clock.startMinute);
    const searched = placedContainers(sim, 6, 4);
    walk(sim, 1, 0, 20 * 20 + 20); // ~16 chunks east
    const idx = (cx: number, cy: number): number => cy * lod.wChunks + cx;
    expect(lod.chunkLoot[idx(4, 4)]).toBe(ChunkLoot.none);
    expect(placedContainers(sim, 4, 4)).toBe(0);
    expect(lod.chunkLoot[idx(6, 4)]).toBe(ChunkLoot.dirty);
    expect(placedContainers(sim, 6, 4)).toBeGreaterThan(0);
    walk(sim, -1, 0, 20 * 20 + 20);
    expect(lod.chunkLoot[idx(4, 4)]).toBe(ChunkLoot.live);
    expect(sig(4, 4)).toBe(before4);
    // The searched chunk was not generated twice.
    expect(placedContainers(sim, 6, 4)).toBe(searched);
    // Late-generated food is aged from the world start (spoilage catch-up, no per-tick work).
    for (const c of st.containers.values()) {
      for (const id of c.items)
        expect(st.items.get(id)!.ageStamp).toBeLessThanOrEqual(sim.world.clock.startMinute + 1);
    }
  });

  it('calibration: the 8×8 km layout gives a plausible population and a light start area', () => {
    const content = compileContent(fixtureContent());
    const src = gridWorld({ w: WORLD_CHUNKS, h: WORLD_CHUNKS, kind: worldMapKind });
    const lod = createLodWorld(DEFAULT_SIM_LOD, src, content, false);
    populateLod(lod, [1000]);
    const all = coarseTotal(lod);
    let window = 0;
    for (let cy = START_CHUNK.cy - 3; cy <= START_CHUNK.cy + 3; cy++)
      for (let cx = START_CHUNK.cx - 3; cx <= START_CHUNK.cx + 3; cx++)
        window += cellTotal(lod, cellOfChunk(lod, cx, cy));
    testLog(`[lod] 8x8 km world: ${all} zombies, start window (7x7 chunks): ${window}\n`);
    expect(all).toBeGreaterThan(8000);
    expect(all).toBeLessThan(40000);
    expect(window).toBeGreaterThan(50);
    expect(window).toBeLessThanOrEqual(DEFAULT_SIM_LOD.maxActiveZombies);
  });
});
