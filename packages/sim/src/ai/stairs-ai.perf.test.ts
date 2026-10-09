import type { SimZombieSpawn } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { runTicks } from '../test/ai-fixtures.js';
import { sendTo, stairsSim } from '../test/stairs-ai-fixtures.js';

// Moved from stairs-ai.test.ts (wall-time comparison): runs in the separate CI perf step.

interface PerfHost {
  performance: { now(): number };
  process: { stderr: { write(s: string): void } };
}
// Test-only access to the host clock; the sim itself never reads real time.
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;

describe('stairs AI: cost (perf)', () => {
  it(
    '200 zombies with goals upstairs cost about the same as with goals on their floor',
    { timeout: 120_000 },
    () => {
      const zs: SimZombieSpawn[] = [];
      for (let i = 0; i < 200; i++)
        zs.push({ x: 2.5 + (i % 20) * 3, y: 2.5 + Math.floor(i / 20) * 2, z: 0 });
      const time = (goalZ: number) => {
        const sim = stairsSim(zs);
        for (let i = 0; i < sim.getZombies().length; i++)
          sendTo(sim, i, 30.5 + (i % 10), 40.5, goalZ);
        runTicks(sim, 20);
        let best = Infinity;
        for (let b = 0; b < 3; b++) {
          const t0 = host.performance.now();
          runTicks(sim, 100);
          best = Math.min(best, (host.performance.now() - t0) / 100);
        }
        return { best, sim };
      };
      const same = time(0);
      const up = time(1);
      host.process.stderr.write(
        `[perf] 200 zombies: goals upstairs ${up.best.toFixed(2)} ms vs same floor ${same.best.toFixed(2)} ms\n`,
      );
      expect(up.best).toBeLessThanOrEqual(same.best * 1.5 + 0.5);
      expect(up.sim.getZombies().some((z) => z.z >= 0.5)).toBe(true);
    },
  );
});
