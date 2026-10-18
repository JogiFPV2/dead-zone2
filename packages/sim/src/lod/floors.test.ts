import { CHUNK_SIZE } from '@deadzone/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Sim } from '../sim.js';
import { utf8Decode, utf8Encode } from '../save/codec.js';
import { bang, gridWorld, lodSim, walk } from '../test/lod-fixtures.js';
import { floorDrift, resolveCell } from './floors.js';
import {
  addCoarseZombies,
  cellOfChunk,
  cellTotal,
  floorTotal,
  groundTotal,
  levelCounts,
  type LodWorld,
} from './state.js';

// Heavy worlds (LOD, floors, long health runs): 5 s is too little on a busy shared box.
vi.setConfig({ testTimeout: 30_000 });

/** docs 9.39: far simulation on several levels (blocks of 4–11 storeys). */
const total = (sim: Sim): number => {
  const s = sim.lodStats()!;
  return s.activeZombies + s.coarseZombies;
};
const atLevel = (lod: LodWorld, cell: number, z: number): number => {
  const at = levelCounts(lod, cell, z, false);
  if (!at) return 0;
  let n = 0;
  for (let t = 0; t < lod.types; t++) n += at[0][at[1] + t] ?? 0;
  return n;
};
const isHouse = (x: number, y: number): boolean =>
  (Math.floor(x / CHUNK_SIZE) + Math.floor(y / CHUNK_SIZE)) % 2 === 0;

describe('sim LOD on several levels', () => {
  it('splits a cell over its levels on the first activation and spawns zombies on each floor', () => {
    const world = gridWorld({ w: 40, h: 40, floors: 6 });
    const sim = lodSim(world, 20, 20, {
      maxEntities: 4096,
      lod: { defaultZombiesPerChunk: 12, maxActiveZombies: 2000, maxSpawnPerTick: 200 },
    });
    const lod = sim.world.lod!;
    expect(lod.levels).toBe(6);
    const start = total(sim);
    expect(floorTotal(lod)).toBe(0); // start population waits on the ground
    for (let i = 0; i < 30; i++) sim.step();
    expect(lod.links.size).toBe(49); // the 7 × 7 active cells were split
    expect(total(sim)).toBe(start);
    const levels = new Set<number>();
    for (const z of sim.getZombies()) {
      expect(Number.isInteger(z.z)).toBe(true);
      levels.add(z.z);
      if (z.z === 0) continue;
      // Upper floors exist only over the houses (tiles 4..14 of the chunk).
      expect(isHouse(z.x, z.y)).toBe(true);
      const lx = Math.floor(z.x) % CHUNK_SIZE;
      const ly = Math.floor(z.y) % CHUNK_SIZE;
      expect(lx >= 4 && lx <= 14 && ly >= 4 && ly <= 14).toBe(true);
    }
    expect([...levels].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    // Stair masks: houses have stairs on z 0..4, fields none.
    expect(lod.links.get(cellOfChunk(lod, 20, 20))).toBe(0b11111);
    expect(lod.links.get(cellOfChunk(lod, 21, 20))).toBe(0);
    // Far cells are not split.
    expect(lod.links.has(cellOfChunk(lod, 2, 2))).toBe(false);
    expect(lod.floors.has(cellOfChunk(lod, 2, 2))).toBe(false);
  });

  it('folds a zombie off the ground into its level and unfolds it on the same floor', () => {
    const world = gridWorld({ w: 40, h: 40, floors: 6 });
    const x = 30 * CHUNK_SIZE + 8.5;
    const y = 30 * CHUNK_SIZE + 8.5;
    const sim = lodSim(world, 20, 20, {
      lod: { defaultZombiesPerChunk: 0 },
      spawnZombies: [{ x, y, z: 3 }],
    });
    const lod = sim.world.lod!;
    const cell = cellOfChunk(lod, 30, 30);
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.lodStats()!.activeZombies).toBe(0);
    expect(atLevel(lod, cell, 3)).toBe(1);
    expect(groundTotal(lod, cell)).toBe(0);
    expect(sim.lodStats()!.floorZombies).toBe(1);
    expect(lod.links.get(cell)).toBe(0b11111);
    sim.enqueue({
      type: 'setInterest',
      tick: sim.tick,
      playerId: 0,
      seq: 1,
      cx: 30,
      cy: 30,
      radiusChunks: 1,
    });
    for (let i = 0; i < 10; i++) sim.step();
    const zs = sim.getZombies();
    expect(zs).toHaveLength(1);
    expect(zs[0]!.z).toBe(3);
    expect(Math.floor(zs[0]!.x / CHUNK_SIZE)).toBe(30);
    expect(cellTotal(lod, cell)).toBe(0);
    expect(lod.floors.has(cell)).toBe(false); // sparse again
  });

  it('drifts between levels only along stairs of the cell', () => {
    const sim = lodSim(gridWorld({ w: 40, h: 40, floors: 6 }), 20, 20, {
      lod: { defaultZombiesPerChunk: 0 },
    });
    const lod = sim.world.lod!;
    const cell = cellOfChunk(lod, 2, 2);
    lod.links.set(cell, 0b00011); // stairs 0 → 1 and 1 → 2 only
    addCoarseZombies(lod, 2, 2, 0, 50, 4);
    addCoarseZombies(lod, 2, 2, 0, 40, 2);
    for (let i = 0; i < 40; i++) floorDrift(lod, cell, true); // a loud noise: down to the ground
    expect(atLevel(lod, cell, 4)).toBe(50); // no stairs from z 4
    expect(atLevel(lod, cell, 2)).toBe(0);
    expect(groundTotal(lod, cell)).toBe(40);
    // Random drift: up and down the connected levels, never onto z 3.
    lod.links.set(cell, 0b00011);
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      floorDrift(lod, cell, false);
      for (let z = 0; z < 6; z++) if (atLevel(lod, cell, z) > 0) seen.add(z);
    }
    expect(cellTotal(lod, cell)).toBe(90);
    expect(atLevel(lod, cell, 3)).toBe(0);
    expect(atLevel(lod, cell, 4)).toBe(50);
    expect(seen.has(1) && seen.has(2)).toBe(true);
    // Without stairs nothing moves.
    lod.links.set(cell, 0);
    const before = [0, 1, 2, 3, 4, 5].map((z) => atLevel(lod, cell, z));
    for (let i = 0; i < 1000; i++) floorDrift(lod, cell, i % 2 === 0);
    expect([0, 1, 2, 3, 4, 5].map((z) => atLevel(lod, cell, z))).toEqual(before);
  });

  it('a loud noise pulls zombies of a far block down its stairs in the coarse sweep', () => {
    const sim = lodSim(gridWorld({ w: 40, h: 40, floors: 6 }), 20, 20, {
      lod: { defaultZombiesPerChunk: 0, drift: { chance: 0, fraction: 0 } },
    });
    const lod = sim.world.lod!;
    const cell = cellOfChunk(lod, 6, 6);
    lod.links.set(cell, 0b11111);
    addCoarseZombies(lod, 6, 6, 0, 32, 5);
    for (let i = 0; i < 300; i++) sim.step(); // no noise, no drift: they stay
    expect(atLevel(lod, cell, 5)).toBe(32);
    bang(sim, 6 * CHUNK_SIZE + 16, 6 * CHUNK_SIZE + 16, 120);
    for (let i = 0; i < 1100; i++) sim.step(); // 11 sweeps of every cell
    expect(atLevel(lod, cell, 5)).toBeLessThan(32);
    expect(groundTotal(lod, cell)).toBeGreaterThan(0);
    expect(sim.lodStats()!.coarseZombies).toBe(32);
  });

  it('a building without stairs gets a zero mask (its floors are sealed for the drift)', () => {
    const world = gridWorld({ w: 40, h: 40, floors: 4, noStairs: true });
    const sim = lodSim(world, 20, 20, { lod: { defaultZombiesPerChunk: 0 } });
    const lod = sim.world.lod!;
    const cell = cellOfChunk(lod, 2, 2);
    for (let i = 0; i < 400; i++) addCoarseZombies(lod, 2, 2, 0, 1);
    resolveCell(lod, sim.world.map, cell);
    expect(lod.links.get(cell)).toBe(0);
    const split = [0, 1, 2, 3].map((z) => atLevel(lod, cell, z));
    expect(split.reduce((a, b) => a + b, 0)).toBe(400);
    expect(split[1]! + split[2]! + split[3]!).toBeGreaterThan(0);
    expect(split[0]!).toBeGreaterThan(split[1]!);
    for (let i = 0; i < 500; i++) floorDrift(lod, cell, false);
    expect([0, 1, 2, 3].map((z) => atLevel(lod, cell, z))).toEqual(split);
  });

  it('save → load keeps floor counters and stair masks; a save without them still loads', () => {
    const world = gridWorld({ w: 40, h: 40, floors: 6 });
    const opts = {
      lod: { defaultZombiesPerChunk: 3, maxActiveZombies: 120 },
      walkSpeedTilesPerSecond: 12,
    };
    const a = lodSim(world, 20, 20, opts);
    walk(a, 1, 0, 300);
    bang(a, a.getPlayer()!.x, a.getPlayer()!.y, 200);
    walk(a, 0, 1, 300);
    const lod = a.world.lod!;
    expect(lod.links.size).toBeGreaterThan(49);
    expect(floorTotal(lod)).toBeGreaterThan(0);
    const bytes = a.save();
    const json = JSON.parse(utf8Decode(bytes)) as { lod: Record<string, unknown> };
    expect(json.lod.floors).toBeDefined();
    expect(json.lod.links).toBeDefined();
    const b = lodSim(world, 20, 20, { ...opts, load: bytes });
    expect(b.hash()).toBe(a.hash());
    expect(b.lodStats()).toEqual(a.lodStats());
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(b.hash()).toBe(a.hash());
    // A pre-floors save (no `floors` / `links`): loads, splits cells again when they activate.
    delete json.lod.floors;
    delete json.lod.links;
    const old = lodSim(world, 20, 20, { ...opts, load: utf8Encode(JSON.stringify(json)) });
    expect(old.world.lod!.links.size).toBe(0);
    for (let i = 0; i < 30; i++) old.step();
    expect(old.world.lod!.links.size).toBeGreaterThan(0);
  });

  it('single-level worlds keep the pre-floors layout (no floor entries, no extra save fields)', () => {
    const sim = lodSim(gridWorld({ w: 40, h: 40 }), 20, 20, { lod: { defaultZombiesPerChunk: 2 } });
    for (let i = 0; i < 200; i++) sim.step();
    const lod = sim.world.lod!;
    expect(lod.levels).toBe(1);
    expect(lod.floors.size + lod.links.size).toBe(0);
    const json = JSON.parse(utf8Decode(sim.save())) as { lod: Record<string, unknown> };
    expect('floors' in json.lod || 'links' in json.lod).toBe(false);
  });
});
