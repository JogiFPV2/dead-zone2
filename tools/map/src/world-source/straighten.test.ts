import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import {
  dominantRoadAngle,
  OSM_SHIFT,
  rotatePt,
  rotation,
  straightenOsmMap,
  unrotatePt,
  type StraightenStats,
} from './straighten.js';

/** Closed flat decimetre ring of a rectangle w × h (m) at (x, y), turned by `deg`. */
function rect(x: number, y: number, w: number, h: number, deg: number): number[] {
  const a = (deg * Math.PI) / 180;
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([u, v]) => [
    Math.round((x + u! * Math.cos(a) - v! * Math.sin(a)) * 10),
    Math.round((y + u! * Math.sin(a) + v! * Math.cos(a)) * 10),
  ]);
  return [...pts, pts[0]!].flat();
}

function map(over: Partial<OsmMap>): OsmMap {
  return {
    format: 'deadzone-osm-1',
    crs: 'EPSG:32634',
    E0: 0,
    N1: 0,
    size: 16384,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    source: 'test',
    roads: [],
    rails: [],
    waterways: [],
    areas: [],
    buildings: [],
    trees: [],
    treeRows: [],
    pois: [],
    places: [],
    ...over,
  };
}

const building = (rings: number[][]) =>
  ({
    id: 1,
    type: 'x',
    kind: 'house',
    typeFrom: 'tag',
    levels: 1,
    levelsFrom: 'tag',
    rings,
  }) as never;

describe('straighten (grid alignment of OSM)', () => {
  it('rotation round-trips', () => {
    const r = rotation(27);
    const p = rotatePt(r, 6290, 8520);
    const q = unrotatePt(r, p.x, p.y);
    expect(q.x).toBeCloseTo(6290, 6);
    expect(q.y).toBeCloseTo(8520, 6);
  });

  it('dominant road angle: a 63° street grid', () => {
    const roads = [0, 1, 2].map((i) => ({
      id: i,
      kind: 'tertiary',
      width: 6,
      sidewalk: 0,
      pts: rect(8000 + i * 40, 8000, 200, 0, 63).slice(0, 4),
    }));
    const a = dominantRoadAngle(map({ roads } as never), {
      x0: 7000,
      y0: 7000,
      x1: 9000,
      y1: 9000,
    });
    expect(Math.abs(a - 63)).toBeLessThanOrEqual(1.5);
  });

  it('a building a few degrees off the axes becomes axis-aligned; a 40° one is squared to its own axis', () => {
    const stats = {} as StraightenStats;
    const m = straightenOsmMap(
      map({
        buildings: [
          building([rect(8100, 8100, 12, 8, 5)]),
          building([rect(8200, 8200, 12, 8, 40)]),
        ],
      }),
      0,
      stats,
    );
    expect(stats.buildingsSquared).toBe(2);
    expect(stats.buildingsLocal).toBe(1);
    const r = m.buildings[0]!.rings[0]!;
    expect(r).toHaveLength(10);
    for (let i = 0; i + 3 < r.length; i += 2) {
      // Every edge horizontal or vertical.
      expect(r[i] === r[i + 2] || r[i + 1] === r[i + 3]).toBe(true);
    }
    // Already a clean rectangle at 40°: kept within rounding.
    const want = rect(8200 + OSM_SHIFT, 8200 + OSM_SHIFT, 12, 8, 40);
    const got = m.buildings[1]!.rings[0]!;
    expect(got).toHaveLength(10);
    for (const v of got)
      expect(Math.min(...want.map((w) => Math.abs(w - v)))).toBeLessThanOrEqual(1);
  });

  it('an L-shaped outline keeps its six right-angled corners', () => {
    const L = [0, 0, 100, 0, 100, 40, 40, 40, 40, 100, 0, 100, 0, 0].map((v, i) =>
      i % 2 ? v + 81000 + (i > 2 ? 3 : 0) : v + 81000,
    );
    const m = straightenOsmMap(map({ buildings: [building([L])] }), 0);
    const r = m.buildings[0]!.rings[0]!;
    expect(r).toHaveLength(14);
    for (let i = 0; i + 3 < r.length; i += 2)
      expect(r[i] === r[i + 2] || r[i + 1] === r[i + 3]).toBe(true);
  });

  it('rotates every feature about the square centre (and shifts it into the world)', () => {
    const m = straightenOsmMap(
      map({
        trees: [81920 + 100, 81920],
        places: [{ name: 'A', kind: 'town', x: 81920, y: 81920 + 100 }],
      }),
      90,
    );
    const sh = OSM_SHIFT * 10;
    expect(m.trees).toEqual([81920 + sh, 81920 + 100 + sh]);
    expect(m.places[0]).toMatchObject({ x: 81920 - 100 + sh, y: 81920 + sh });
  });
});
