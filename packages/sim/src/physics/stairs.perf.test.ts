import type { SimMap } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { buildLevels, commander } from '../test/level-fixtures.js';
import { levelSim, mapA } from '../test/stairs-fixtures.js';

// Moved from stairs.test.ts (wall-time comparison): runs in the separate CI perf step.

interface PerfHost {
  performance: { now(): number };
  process: { stderr: { write(s: string): void } };
}
// Test-only access to the host clock; the sim itself never reads real time.
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;

describe('stairs: performance', () => {
  it(
    '200 zombies on a map with levels and stairs cost about the same as without',
    { timeout: 120_000 },
    () => {
      const zombies = Array.from({ length: 200 }, (_, i) => ({
        x: 4.5 + (i % 20) * 1.1,
        y: 30.5 + Math.floor(i / 20) * 1.1,
      }));
      const time = (map: SimMap) => {
        const sim = levelSim(map, { x: 18.5, y: 20.5 }, zombies);
        const c = commander(sim);
        for (let i = 0; i < 100; i++) {
          if (i % 20 === 0) c.move(i % 40 === 0 ? 1 : -1, 0);
          sim.step();
        }
        let best = Infinity;
        for (let b = 0; b < 3; b++) {
          const t0 = host.performance.now();
          for (let i = 0; i < 100; i++) sim.step();
          best = Math.min(best, (host.performance.now() - t0) / 100);
        }
        return best;
      };
      const flat = time(
        buildLevels([{ z: 0, wallN: (x, y) => (y === 20 || y === 21) && x >= 20 && x < 24 }]),
      );
      const levels = time(mapA());
      host.process.stderr.write(
        `[perf] 200 zombies: levels+stairs ${levels.toFixed(2)} ms vs single level ${flat.toFixed(2)} ms\n`,
      );
      expect(levels).toBeLessThanOrEqual(flat * 1.5 + 0.5);
    },
  );
});
