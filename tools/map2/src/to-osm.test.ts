import { describe, expect, it } from 'vitest';
import type { Edge } from './graph.js';
import { roadProfile } from './profile.js';
import { fan, laneOffsets, OSM_RAW_SHIFT, STW2_OFFSET, toOsmMap } from './to-osm.js';

describe('map2 → client OSM data (stw2)', () => {
  it('lane lines: one-way splits the carriageway, two-way keeps the centre line apart', () => {
    expect(laneOffsets(7, 2, true)).toEqual([0]);
    expect(laneOffsets(9, 3, true)).toEqual([-1.5, 1.5]);
    expect(laneOffsets(6, 2, false)).toEqual([]);
    expect(laneOffsets(14, 4, false)).toEqual([3.5, -3.5]);
  });

  it('kerb fan: strips from the centre stop 1 m short of the arc', () => {
    const f = fan(
      [0, 0],
      [
        [10, 0],
        [0, 10],
      ],
    );
    expect(f).toEqual([
      [0, 0],
      [9, 0],
      [0, 0],
      [0, 9],
    ]);
  });

  it('writes roads in the raw frame that the tile writer shifts onto the world', () => {
    const p = roadProfile({ highway: 'primary', oneway: 'yes', lanes: '2' })!;
    const e: Edge = {
      id: 0,
      way: 1,
      a: 1,
      b: 2,
      pts: [
        [0, 0],
        [10, 0],
      ],
      p,
    };
    const m = toOsmMap({ edges: [e], junctions: [], rivers: [], rails: [], places: [] }) as {
      roads: { pts: number[]; cl?: 0; ll?: number[] }[];
    };
    const r = m.roads[0]!;
    expect(r.pts[0]! / 10 + OSM_RAW_SHIFT).toBe(STW2_OFFSET[0]);
    expect(r.cl).toBe(0);
    expect(r.ll).toEqual([0]);
  });
});
