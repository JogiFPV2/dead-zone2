import { describe, expect, it } from 'vitest';
import type { Sim } from '../sim.js';
import { hordeSim } from '../test/horde-fixtures.js';
import { controls, driverDoor, vehicleContent } from '../test/vehicle-fixtures.js';

/**
 * 1 car + 200 zombies (docs 1.1 budget: 200 active zombies ≤ 4 ms per tick): the car drives
 * circles through the horde in the bench town (walls, bodies, ramming, bodies under the
 * wheels). Compared with the same horde chasing a player on foot. `PERF_TOLERANCE` like
 * `ai-perf`.
 */
interface PerfHost {
  performance: { now(): number };
  process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };
}
// eslint-disable-next-line no-restricted-globals -- perf test measures wall time on purpose
const host = globalThis as unknown as PerfHost;
const tolerance = Number(host.process.env.PERF_TOLERANCE ?? (host.process.env.CI ? 1.5 : 1));

const CAR = { x: 56, y: 60 };

interface Run {
  sim: Sim;
  script: (t: number) => void;
  times: number[];
}

function setup(withCar: boolean): Run {
  const sim: Sim = hordeSim(200, 5, undefined, {
    content: vehicleContent(),
    spawn: driverDoor(CAR.x, CAR.y),
    ...(withCar ? { spawnVehicles: [CAR] } : {}),
  });
  const ctl = controls(sim);
  if (withCar) ctl.enter(sim.getVehicles()[0]!.stableId);
  const script = (t: number) => {
    if (!withCar) return;
    // Circles, a handbrake turn now and then, reverse out of walls.
    if (t % 100 === 1) ctl.drive(0.7, 0, 0.8);
    if (t % 100 === 60) ctl.drive(0.5, 0, -1, true);
    if (t % 100 === 75) ctl.drive(0, 1, 0.4);
  };
  return { sim, script, times: [] };
}

/** Best of three 200-tick batches (robust against other processes competing for the CPU). */
function best(times: readonly number[]): number {
  const batch = (b: number) => times.slice(b * 200, b * 200 + 200).reduce((a, x) => a + x, 0) / 200;
  return Math.min(batch(0), batch(1), batch(2));
}

/** Both worlds step in lockstep (alternating), so machine noise hits both alike. */
function measure(): { foot: number; car: number } {
  const runs = [setup(false), setup(true)];
  for (let t = 0; t < 800; t++) {
    for (const r of runs) {
      r.script(t);
      const t0 = host.performance.now();
      r.sim.step();
      if (t >= 200) r.times.push(host.performance.now() - t0);
    }
  }
  const foot = best(runs[0]!.times);
  const car = best(runs[1]!.times);
  host.process.stderr.write(
    `[perf] 200 zombies on foot: avg ${foot.toFixed(2)} ms; + 1 car driving: avg ${car.toFixed(2)} ms\n`,
  );
  return { foot, car };
}

describe('vehicles: perf', () => {
  it('1 car + 200 zombies stays within the 200-zombie tick budget', { timeout: 120_000 }, () => {
    const { foot, car } = measure();
    expect(car).toBeLessThanOrEqual(4 * tolerance);
    expect(car).toBeLessThanOrEqual(foot * 1.3 + 0.3);
  });
});
