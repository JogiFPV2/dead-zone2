import { describe, expect, it } from 'vitest';
import type { SimOptions } from '../sim.js';
import { animalContent } from './animal-fixtures.js';
import { hordeSim, stepScripted } from './horde-fixtures.js';

/**
 * docs 1.1 / 8.4: 200 active zombies + player in ≤ 4 ms per tick on average (Node). The horde
 * chases the player through a town with buildings (flow field + A* active). CI runners are
 * slower and noisy, so `PERF_TOLERANCE` (default 1.5 on CI, 1 locally) scales the budget; the
 * measured numbers are printed either way.
 */
interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// Test-only access to the host clock; the sim itself never reads real time.
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

function measure(
  count: number,
  extra: Partial<SimOptions> = {},
  label = `${count} zombies`,
): { avg: number; p95: number; chasing: number } {
  const sim = hordeSim(count, 5, undefined, extra);
  for (let i = 0; i < 200; i++) stepScripted(sim); // warm-up, horde gathers
  const times: number[] = [];
  for (let i = 0; i < 600; i++) {
    const t0 = host.performance.now();
    stepScripted(sim);
    times.push(host.performance.now() - t0);
  }
  // Best of three 200-tick batches: robust against other test workers competing for the CPU.
  const batch = (b: number) => times.slice(b * 200, b * 200 + 200).reduce((a, t) => a + t, 0) / 200;
  const avg = Math.min(batch(0), batch(1), batch(2));
  times.sort((a, b) => a - b);
  const chasing = sim.getZombies().filter((z) => z.state === 'chase').length;
  host.process.stderr.write(
    `[perf] ${label}: avg ${avg.toFixed(2)} ms (best 200-tick batch), p95 ${times[Math.floor(times.length * 0.95)]!.toFixed(2)} ms, chasing ${chasing}\n`,
  );
  return { avg, p95: times[Math.floor(times.length * 0.95)]!, chasing };
}

describe('ai performance', () => {
  it('200 zombies: average tick ≤ 4 ms', { timeout: 120_000 }, () => {
    const r = measure(200);
    expect(r.chasing).toBeGreaterThan(100);
    expect(r.avg).toBeLessThanOrEqual(4 * tolerance);
  });

  it('200 zombies + 50 animals: average tick ≤ 4 ms (same budget)', { timeout: 120_000 }, () => {
    // Animals across the town; the loud noise every 5 s keeps them fleeing (worst case).
    const r = measure(
      200,
      { content: animalContent(), populateAnimals: 50 },
      '200 zombies + 50 animals',
    );
    expect(r.chasing).toBeGreaterThan(100);
    expect(r.avg).toBeLessThanOrEqual(4 * tolerance);
  });

  it('300 zombies (Rescue horde): average tick ≤ 6 ms', { timeout: 120_000 }, () => {
    const r = measure(300);
    expect(r.avg).toBeLessThanOrEqual(6 * tolerance);
  });
});
