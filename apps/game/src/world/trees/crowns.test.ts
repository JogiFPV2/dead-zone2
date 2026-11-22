import { SIM_TREE_STRIDE } from '@deadzone/protocol';
import { describe, expect, it } from 'vitest';
import { crownOfSpecies, simTrees } from './crowns.js';
import { TREE_HEIGHT_SCALE } from './species.js';

describe('tree crowns for the sim light model', () => {
  it('oak: crown from content sizes at the realistic tree scale, bottom below top', () => {
    const oak = crownOfSpecies('base:oak');
    expect(oak.top).toBeGreaterThan(oak.bottom);
    expect(oak.bottom).toBeGreaterThan(1);
    expect(oak.r).toBeGreaterThan(1);
    // Oak 15–28 m real → about 8.6 m in game.
    expect(oak.top).toBeCloseTo(21.5 * TREE_HEIGHT_SCALE, 1);
  });

  it('unknown species falls back to a mid-size crown; a column becomes x, y, r, bottom, top', () => {
    expect(crownOfSpecies('mod:nope').top).toBeGreaterThan(0);
    const out = simTrees([1.5, 2.5, 30, 4], ['base:pine', 'base:birch']);
    expect(out).toHaveLength(2 * SIM_TREE_STRIDE);
    expect(out.slice(0, 2)).toEqual([1.5, 2.5]);
    expect(out.slice(5, 7)).toEqual([30, 4]);
    expect(out[4]).toBe(crownOfSpecies('base:pine').top);
  });
});
