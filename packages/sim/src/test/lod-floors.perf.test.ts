import { describe, expect, it } from 'vitest';
import { MAP_CHUNKS } from '@deadzone/protocol';
import { addCoarseZombies, cellOfChunk, coarseTotal, floorTotal } from '../lod/state.js';
import type { Sim } from '../sim.js';
import { gridWorld, lodSim } from './lod-fixtures.js';
import { stepScripted } from './horde-fixtures.js';
import { testLog } from './world-map-fixture.js';

/**
 * docs 9.39: far simulation on 11 levels over the full 16 × 16 km map (512 × 512 chunks, every
 * other chunk a 10-storey block with stairs). Worst case for the sweep: every block cell already
 * split (stair mask + floor counters), ~25 % of ~210 000 coarse zombies off the ground. Budget
 * for the LOD part of a tick (no zombie entities): ≤ 2 ms; full tick with 200 active zombies as in
 * big-world (≤ 4 ms). `PERF_TOLERANCE` as in ai-perf (1.5 on CI); numbers are printed.
 */
interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined> };
}
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

const SIDE = MAP_CHUNKS;
const MID = SIDE / 2;
const LEVELS = 11;

function avgTick(sim: Sim): { avg: number; p95: number } {
  for (let i = 0; i < 200; i++) stepScripted(sim);
  const times: number[] = [];
  for (let i = 0; i < 600; i++) {
    const t0 = host.performance.now();
    stepScripted(sim);
    times.push(host.performance.now() - t0);
  }
  const batch = (b: number) => times.slice(b * 200, b * 200 + 200).reduce((a, t) => a + t, 0) / 200;
  const avg = Math.min(batch(0), batch(1), batch(2));
  times.sort((a, b) => a - b);
  return { avg, p95: times[Math.floor(times.length * 0.95)]! };
}

function blocks(maxActiveZombies: number): Sim {
  const world = gridWorld({ w: SIDE, h: SIDE, houseObjects: 4, floors: LEVELS });
  const sim = lodSim(world, MID, MID, {
    maxEntities: 8192,
    lod: { defaultZombiesPerChunk: 0.8, maxActiveZombies, minSpawnDistTiles: 12 },
  });
  const lod = sim.world.lod!;
  const full = (1 << (LEVELS - 1)) - 1;
  for (let cy = 0; cy < SIDE; cy++) {
    for (let cx = cy & 1; cx < SIDE; cx += 2) {
      const cell = cellOfChunk(lod, cx, cy);
      lod.links.set(cell, full);
      // Every other block has its zombies upstairs (spread over the floors).
      const g = lod.counts[cell * lod.types] ?? 0;
      const up = ((cx >> 1) + cy) % 2 === 0 ? g : 0;
      if (up === 0) continue;
      lod.counts[cell * lod.types] = g - up;
      for (let k = 0; k < up; k++)
        addCoarseZombies(lod, cx, cy, 0, 1, 1 + ((cx + cy + k) % (LEVELS - 1)));
    }
  }
  return sim;
}

describe('far simulation on 11 levels (512 × 512 chunks)', () => {
  it('LOD tick ≤ 2 ms, full tick ≤ 4 ms with every block split', { timeout: 300_000 }, () => {
    const lodOnly = blocks(0);
    const lod = lodOnly.world.lod!;
    const all = coarseTotal(lod);
    const floors = floorTotal(lod);
    expect(lod.levels).toBe(LEVELS);
    expect(all).toBeGreaterThan(150_000);
    expect(floors).toBeGreaterThan(all / 6);
    let floorBytes = 0;
    for (const f of lod.floors.values()) floorBytes += f.byteLength;
    const a = avgTick(lodOnly);
    expect(coarseTotal(lod)).toBe(all); // drift moves, never loses
    const withZombies = blocks(200);
    const b = avgTick(withZombies);
    const s = withZombies.lodStats()!;
    testLog(
      `[floors] 512×512, ${LEVELS} levels: ${all} coarse zombies (${floors} off the ground, ` +
        `${lod.floors.size} floor cells, ${(floorBytes / 1024).toFixed(0)} KiB counters, ` +
        `${lod.links.size} stair masks); LOD-only tick avg ${a.avg.toFixed(2)} ms ` +
        `(p95 ${a.p95.toFixed(2)}), with ${s.activeZombies} active zombies avg ` +
        `${b.avg.toFixed(2)} ms (p95 ${b.p95.toFixed(2)})\n`,
    );
    expect(a.avg).toBeLessThanOrEqual(2 * tolerance);
    expect(b.avg).toBeLessThanOrEqual(4 * tolerance);
  });
});
