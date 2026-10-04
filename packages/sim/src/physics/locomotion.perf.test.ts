import { GAITS } from '@deadzone/protocol';
import { dsincos } from '../vehicles/math.js';
import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { hordeSim } from '../test/horde-fixtures.js';

/**
 * Player locomotion + 200 zombies (docs 1.1 budget: 200 active zombies ≤ 4 ms per tick): the
 * player zig-zags through the bench town in all gaits (jerk-limited profiles, turning, sliding
 * along block walls and into corners) while the horde chases. Compared with the same horde and a
 * player standing still. `PERF_TOLERANCE` like `ai-perf`.
 */
interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

interface Run {
  sim: Sim;
  script: (t: number) => void;
  times: number[];
}

function setup(moving: boolean): Run {
  const sim = hordeSim(200, 5);
  let seq = 1_000_000;
  const script = (t: number) => {
    if (!moving || t % 23 !== 0) return;
    const a = ((t * 47) % 360) * (Math.PI / 180);
    sim.enqueue({
      type: 'move',
      dx: dsincos(a)[1],
      dy: dsincos(a)[0],
      gait: GAITS[(t / 23) % 4]!,
      tick: sim.tick,
      playerId: 0,
      seq: seq++,
    });
  };
  return { sim, script, times: [] };
}

/** Best of three 200-tick batches (robust against other processes competing for the CPU). */
function best(times: readonly number[]): number {
  const batch = (b: number) => times.slice(b * 200, b * 200 + 200).reduce((a, x) => a + x, 0) / 200;
  return Math.min(batch(0), batch(1), batch(2));
}

function measure(): { idle: number; moving: number } {
  const runs = [setup(false), setup(true)];
  for (let t = 0; t < 800; t++) {
    for (const r of runs) {
      r.script(t);
      const t0 = host.performance.now();
      r.sim.step();
      if (t >= 200) r.times.push(host.performance.now() - t0);
    }
  }
  const idle = best(runs[0]!.times);
  const moving = best(runs[1]!.times);
  host.process.stderr.write(
    `[perf] 200 zombies, player idle: avg ${idle.toFixed(2)} ms; player moving: avg ${moving.toFixed(2)} ms\n`,
  );
  return { idle, moving };
}

describe('locomotion: perf', () => {
  it(
    'player locomotion + 200 zombies stays within the 200-zombie budget',
    { timeout: 120_000 },
    () => {
      const { idle, moving } = measure();
      expect(moving).toBeLessThanOrEqual(4 * tolerance);
      expect(moving).toBeLessThanOrEqual(idle * 1.3 + 0.3);
    },
  );
});
