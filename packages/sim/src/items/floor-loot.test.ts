import { describe, expect, it } from 'vitest';
import { createSim } from '../sim.js';
import { fixtureContent } from '../test/content-fixtures.js';
import { buildMap } from '../test/fixtures.js';

const sim = (seed: number) =>
  createSim({
    seed,
    map: buildMap({ width: 64, height: 64 }),
    content: fixtureContent(),
    floorLoot: true,
  });

describe('floor loot', () => {
  it('scatters items on the ground deterministically per seed', () => {
    const piles = (seed: number) => [...sim(seed).world.items!.ground.keys()].sort().join(';');
    const a = piles(3);
    expect(a.length).toBeGreaterThan(0);
    expect(piles(3)).toBe(a);
    expect(piles(4)).not.toBe(a);
  });
});
