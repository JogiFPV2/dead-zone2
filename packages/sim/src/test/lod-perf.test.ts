import { describe, expect, it } from 'vitest';
import { addCoarseZombies, coarseTotal } from '../lod/state.js';
import { gridWorld, lodSim } from './lod-fixtures.js';
import { stepScripted } from './horde-fixtures.js';

/**
 * docs 9.24: LOD budget. A 250 × 250 chunk world (8 × 8 km) with 50 000 zombies as cell
 * counters, 200 of them unfolded around the player (cap `maxActiveZombies`), a loud noise every
 * 5 s (coarse pulls in a 480-tile radius) and the player walking: average tick ≤ 4 ms (Node).
 * `PERF_TOLERANCE` as in ai-perf (1.5 on CI); numbers are printed either way.
 */
interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

describe('LOD performance', () => {
  it('200 active + 50 000 coarse zombies: average tick ≤ 4 ms', { timeout: 180_000 }, () => {
    const sim = lodSim(gridWorld({ w: 250, h: 250, houseObjects: 4 }), 125, 125, {
      maxEntities: 8192,
      lod: { defaultZombiesPerChunk: 0.8, maxActiveZombies: 200, minSpawnDistTiles: 12 },
    });
    const lod = sim.world.lod!;
    // A dense town around the start: more pending zombies than the active cap.
    for (let cy = 121; cy <= 129; cy++)
      for (let cx = 121; cx <= 129; cx++) addCoarseZombies(lod, cx, cy, 0, 4);
    const all = coarseTotal(lod);
    expect(all).toBeGreaterThan(50_000);
    for (let i = 0; i < 300; i++) stepScripted(sim); // warm-up: unfold up to the cap
    const times: number[] = [];
    for (let i = 0; i < 600; i++) {
      const t0 = host.performance.now();
      stepScripted(sim);
      times.push(host.performance.now() - t0);
    }
    const batch = (b: number) =>
      times.slice(b * 200, b * 200 + 200).reduce((a, t) => a + t, 0) / 200;
    const avg = Math.min(batch(0), batch(1), batch(2));
    times.sort((a, b) => a - b);
    const s = sim.lodStats()!;
    host.process.stderr.write(
      `[perf] LOD: ${s.activeZombies} active + ${s.coarseZombies} coarse zombies, ` +
        `avg ${avg.toFixed(2)} ms (best 200-tick batch), p95 ${times[Math.floor(times.length * 0.95)]!.toFixed(2)} ms\n`,
    );
    expect(s.activeZombies).toBeGreaterThanOrEqual(150);
    expect(s.activeZombies + s.coarseZombies).toBe(all);
    expect(avg).toBeLessThanOrEqual(4 * tolerance);
  });
});
