import { describe, expect, it } from 'vitest';
import type { VectorRoad } from '../streaming/source.js';
import { zebraSpots } from './zebras.js';

const road = (pts: number[], over: Partial<VectorRoad> = {}): VectorRoad => ({
  surface: 'base:asphalt',
  r: 3,
  rs: 5,
  bridge: false,
  pts,
  d0: 0,
  ...over,
});
const all = () => true;

describe('zebraSpots', () => {
  it('puts a zebra on every leg of a crossroads, past the other road', () => {
    const z = zebraSpots([road([0, 16, 16, 16, 32, 16]), road([16, 0, 16, 16, 16, 32])], all);
    expect(z).toHaveLength(4);
    for (const s of z) {
      const d = Math.hypot(s.x - 16, s.z - 16);
      expect(d).toBeGreaterThan(5); // beyond the 3 m carriageway + curb
      expect(d).toBeLessThan(8);
      expect(s.halfWidth).toBeCloseTo(2.8);
    }
  });

  it('T junction: three legs', () => {
    const z = zebraSpots([road([0, 16, 16, 16, 32, 16]), road([16, 16, 16, 32])], all);
    expect(z).toHaveLength(3);
  });

  it('a footway crossing gets a zebra on the junction itself', () => {
    const z = zebraSpots(
      [
        road([0, 16, 10, 16, 32, 16]),
        road([10, 4, 10, 16, 10, 28], { surface: 'base:sidewalk', r: 1, rs: 0 }),
      ],
      all,
    );
    expect(z).toHaveLength(1);
    expect(z[0]!.x).toBeCloseTo(10);
    expect(z[0]!.z).toBeCloseTo(16);
    expect(Math.abs(z[0]!.ux)).toBeCloseTo(1);
  });

  it('a road split into two ways (straight on) is not a junction; narrow lanes get none', () => {
    expect(zebraSpots([road([0, 16, 16, 16]), road([16, 16, 32, 17])], all)).toHaveLength(0);
    expect(
      zebraSpots([road([0, 16, 32, 16], { r: 1.5 }), road([16, 0, 16, 32], { r: 1.5 })], all),
    ).toHaveLength(0);
  });

  it('only the chunk owning the junction draws it', () => {
    const roads = [road([0, 16, 16, 16, 32, 16]), road([16, 0, 16, 16, 16, 32])];
    expect(zebraSpots(roads, (x) => x < 10)).toHaveLength(0);
  });
});
