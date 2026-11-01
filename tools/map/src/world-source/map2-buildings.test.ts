import { CHUNK_SIZE } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import {
  map2Buildings,
  OSM_RAW_SHIFT,
  STW2_OFFSET,
  type Map2Building,
} from '../osm/map2-buildings.js';
import type { OsmBuilding, OsmMap } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import { OSM_REGIONS, osmPlan } from './sources.js';
import { straightenOsmMap } from './straighten.js';

type Pt = [number, number];
/** Rectangle of `w` × `h` m turned by `deg` about (cx, cy), counter-clockwise in y-south. */
function rect(cx: number, cy: number, w: number, h: number, deg: number): Pt[] {
  const a = (deg * Math.PI) / 180;
  return (
    [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ] as Pt[]
  ).map(([u, v]) => [
    cx + u * Math.cos(a) - v * Math.sin(a),
    cy + u * Math.sin(a) + v * Math.cos(a),
  ]);
}
const m2 = (id: number, outer: Pt[], o: Partial<Map2Building> = {}): Map2Building => ({
  id,
  rel: false,
  ring: 0,
  outer,
  inner: [],
  shared: [],
  sharedBy: [],
  tags: { building: 'yes' },
  levels: 1,
  roofLevels: 0,
  height: 3,
  heightFrom: 'default',
  area: 200,
  ...o,
});
const map = (buildings: OsmBuilding[]): OsmMap => ({
  format: 'deadzone-osm-1',
  crs: 'EPSG:32634',
  E0: 0,
  N1: 0,
  size: 32768,
  attribution: '© współtwórcy OpenStreetMap',
  license: 'ODbL-1.0',
  source: 'test',
  // A street south of the buildings (raw frame, dm).
  roads: [{ id: 1, kind: 'residential', width: 7, sidewalk: 2, pts: [78000, 81900, 86000, 81900] }],
  rails: [],
  waterways: [],
  areas: [],
  buildings,
  trees: [],
  treeRows: [],
  pois: [],
  places: [],
});
/** Local map2 metres of a raw-frame point (dm → m, minus the stw2 offset). */
const local = (x: number, y: number): Pt => [
  x + OSM_RAW_SHIFT - STW2_OFFSET[0],
  y + OSM_RAW_SHIFT - STW2_OFFSET[1],
];

describe('map2 buildings in the stw2 tiles (exact outlines)', () => {
  // Two terraced houses turned 5° (the old generator squared these onto the axes).
  const A = rect(...local(8190, 8180), 16, 10, 5);
  const shift: Pt = [16 * Math.cos((5 * Math.PI) / 180), 16 * Math.sin((5 * Math.PI) / 180)];
  const B: Pt[] = [
    A[1]!,
    [A[1]![0] + shift[0], A[1]![1] + shift[1]],
    [A[2]![0] + shift[0], A[2]![1] + shift[1]],
    A[2]!,
  ];
  // B's edge 3 (A[2] → A[1]) is A's edge 1 reversed: A (lower id) draws it.
  const bs = map2Buildings([
    m2(5, A, {
      shared: [1],
      sharedBy: ['6:0'],
      tags: { building: 'house', 'building:levels': '2' },
      levels: 2,
      heightFrom: 'levels',
    }),
    m2(6, B, { shared: [3], sharedBy: ['5:0'] }),
    m2(9e6, rect(...local(8240, 8180), 30, 30, 0), {
      rel: true,
      inner: [rect(...local(8240, 8180), 10, 10, 0).reverse()],
      area: 800,
    }),
  ]);

  it('keeps every vertex (dm), courtyards, tag levels; shared wall drawn by the lower id', () => {
    expect(bs.map((b) => b.exact)).toEqual([1, 1, 1]);
    const [a, b, c] = bs;
    expect(a!.rings[0]!.length).toBe(10);
    a!.rings[0]!.slice(0, 8).forEach((v, i) => {
      const p = A[i >> 1]!;
      expect(Math.abs(v / 10 - (p[i & 1]! + STW2_OFFSET[i & 1]! - OSM_RAW_SHIFT))).toBeLessThan(
        0.051,
      );
    });
    expect(a!.levels).toBe(2);
    expect(a!.levelsFrom).toBe('tag');
    expect(a!.noWall).toBeUndefined();
    expect(b!.noWall).toEqual([3]);
    expect(c!.rings).toHaveLength(2);
    expect(c!.osmId).toBe(9e6);
    expect(c!.id).toBeGreaterThan(1e10);
  });

  it('straighten leaves exact outlines 1:1 (squares the same house without `exact`)', () => {
    const s = straightenOsmMap(map(bs), 0);
    for (const [i, b] of s.buildings.entries())
      expect(b.rings[0]).toEqual(bs[i]!.rings[0]!.map((v) => v + OSM_RAW_SHIFT * 10));
    const { exact: _e, ...plain } = bs[0]!;
    const q = straightenOsmMap(map([plain]), 0).buildings[0]!.rings[0]!;
    expect(q).not.toEqual(s.buildings[0]!.rings[0]);
  });

  it('a 5° house gets vector walls on its OSM line; the shared wall only once', () => {
    const gen = new PlanChunkGenerator(
      osmPlan(map(bs.slice(0, 2)), {
        dataHash: 'x',
        region: 'all',
        ...OSM_REGIONS.all,
        rotationDeg: 0,
      }),
    );
    const segs: { b: number; x0: number; y0: number; x1: number; y1: number }[] = [];
    const seen = new Set<string>();
    for (let cx = 350; cx <= 353; cx++)
      for (let cy = 349; cy <= 353; cy++) {
        const col = gen.column(cx, cy);
        for (const l of col?.levels ?? [])
          for (const s of l.wallSegments ?? []) {
            if (s.z !== 0) continue;
            const k = `${s.x0},${s.y0},${s.x1},${s.y1}`;
            if (seen.has(k)) continue;
            seen.add(k);
            segs.push({ b: s.building, ...s });
          }
      }
    expect(CHUNK_SIZE).toBe(32);
    expect(new Set(segs.map((s) => s.b)).size).toBe(2);
    // World = local + offset; the shared wall is A[1] → A[2].
    const w = (p: Pt): Pt => [p[0] + STW2_OFFSET[0], p[1] + STW2_OFFSET[1]];
    const [p, q] = [w(A[1]!), w(A[2]!)];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const onShared = (s: (typeof segs)[number]) =>
      [
        [s.x0, s.y0],
        [s.x1, s.y1],
      ].every(
        ([x, y]) => Math.abs((x! - p[0]) * (q[1] - p[1]) - (y! - p[1]) * (q[0] - p[0])) / L < 0.06,
      );
    const shared = segs.filter(onShared);
    expect(shared.length).toBeGreaterThan(0);
    expect(new Set(shared.map((s) => s.b)).size).toBe(1);
    // Every segment lies on an OSM edge (no squaring): within 6 cm of one of the outline lines.
    const lines = [A, B].flatMap((r) => r.map((a, i) => [w(a), w(r[(i + 1) % 4]!)] as const));
    for (const s of segs)
      expect(
        lines.some(([a, b]) => {
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
          return [
            [s.x0, s.y0],
            [s.x1, s.y1],
          ].every(
            ([x, y]) =>
              Math.abs((x! - a[0]) * (b[1] - a[1]) - (y! - a[1]) * (b[0] - a[0])) / l < 0.06,
          );
        }),
      ).toBe(true);
  });
});
