import { describe, expect, it } from 'vitest';
import { hordeSim, stepScripted } from './horde-fixtures.js';

/** docs 8.3: same seed + commands → same hash, with a 200-zombie horde. */
describe('ai determinism', () => {
  const run = (ticks: number, seed = 5): number[] => {
    const sim = hordeSim(200, seed);
    const hashes: number[] = [];
    for (let t = 0; t < ticks; t++) {
      stepScripted(sim);
      if (t % 100 === 99) hashes.push(sim.hash());
    }
    return hashes;
  };

  it('two runs give identical hashes every 100 ticks', { timeout: 60_000 }, () => {
    const a = run(1500);
    const b = run(1500);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
    expect(run(300, 6)).not.toEqual(a.slice(0, 3));
  });

  it('matches the golden hash (update consciously with `vitest -u` and a note in the PR)', () => {
    const hashes = run(600);
    expect(hashes[hashes.length - 1]!.toString(16)).toMatchInlineSnapshot(`"1a34d633"`);
  });
});
