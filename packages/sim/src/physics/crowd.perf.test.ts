import { describe, expect, it } from 'vitest';
import { hordeSim, stepScripted } from '../test/horde-fixtures.js';
import { DEFAULT_PHYSICS_CONFIG, type PhysicsConfig } from './constants.js';

// Moved from crowd.test.ts (wall-time comparison): runs in the separate CI perf step.

/** Like main before crowds: no pressure and no zombie–zombie pushing. */
const mainLike: PhysicsConfig = {
  ...DEFAULT_PHYSICS_CONFIG,
  crowd: {
    ...DEFAULT_PHYSICS_CONFIG.crowd,
    enabled: false,
    separation: { ...DEFAULT_PHYSICS_CONFIG.crowd.separation, stiffness: 0 },
  },
};

interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// Test-only access to the host clock; the sim itself never reads real time.
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;

describe('physics: crowd pressure (perf)', () => {
  it('200 zombies: crowd pressure and pushing cost little over main', { timeout: 120_000 }, () => {
    const time = (cfg?: PhysicsConfig): number => {
      const sim = hordeSim(200, 5, cfg);
      for (let i = 0; i < 200; i++) stepScripted(sim);
      let best = Infinity;
      for (let b = 0; b < 3; b++) {
        const t0 = host.performance.now();
        for (let i = 0; i < 150; i++) stepScripted(sim);
        best = Math.min(best, (host.performance.now() - t0) / 150);
      }
      return best;
    };
    const base = time(mainLike);
    const crowdOn = time();
    host.process.stderr.write(
      `[perf] 200 zombies: crowd ${crowdOn.toFixed(2)} ms vs main-like ${base.toFixed(2)} ms\n`,
    );
    expect(crowdOn).toBeLessThanOrEqual(base * 1.5 + 0.5);
  });
});
