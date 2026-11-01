import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  buildBuildings,
  heightsOf,
  osmNumber,
  signedArea,
  type LonLat,
  type RawBuilding,
  type RawBuildings2,
} from './buildings.js';
import { polygonIou } from './iou.js';
import { projection, STW_ORIGIN } from './project.js';

const proj = projection(STW_ORIGIN);
const O = STW_ORIGIN;
/** Local metres → WGS84 near the origin (inverse by Newton on `toLocal`, exact to < 1 mm). */
function ll(x: number, y: number): LonLat {
  let lon = O.lon + x / 70800;
  let lat = O.lat - y / 111200;
  for (let k = 0; k < 6; k++) {
    const [px, py] = proj.toLocal(lon, lat);
    lon += (x - px) / 70800;
    lat -= (y - py) / 111200;
  }
  return [lon, lat];
}
const ring = (pts: [number, number][]): LonLat[] => [...pts, pts[0]!].map(([x, y]) => ll(x, y));
const raw = (buildings: RawBuilding[]): RawBuildings2 => ({
  format: 'deadzone-osm-bld-raw-2',
  bbox: [0, 0, 0, 0],
  source: '',
  license: 'ODbL-1.0',
  buildings,
});
const way = (
  id: number,
  pts: [number, number][],
  t: Record<string, string> = {},
  inner: [number, number][][] = [],
): RawBuilding => ({
  id,
  way: true,
  part: !t.building && !!t['building:part'],
  t: { building: 'yes', ...t },
  rings: [{ outer: ring(pts), inner: inner.map(ring) }],
});

// Shapes from the audit (old generator: boxed, squared, turned): L, U, courtyard, odd, slanted.
const L: [number, number][] = [
  [0, 0],
  [30, 0],
  [30, 10],
  [10, 10],
  [10, 40],
  [0, 40],
];
const U: [number, number][] = [
  [0, 0],
  [12, 0],
  [12, 30],
  [28, 30],
  [28, 0],
  [40, 0],
  [40, 42],
  [0, 42],
];
const ODD: [number, number][] = [
  [0, 0],
  [17.3, 2.1],
  [21, 9.4],
  [15.2, 13],
  [16.8, 22.5],
  [4.1, 19.9],
  [6.2, 11.1],
  [-1.5, 8.4],
];
const SLANT: [number, number][] = [
  [0, 0],
  [9.4, 1.1],
  [-10.3, 162.4],
  [-19.7, 161.3],
];

describe('map2 buildings 1:1', () => {
  it('keeps every OSM vertex (IoU ≥ 0.999 against the projected input)', () => {
    const shapes = [L, U, ODD, SLANT];
    const bs = buildBuildings(raw(shapes.map((s, i) => way(i + 1, s))), proj);
    expect(bs).toHaveLength(4);
    bs.forEach((b, i) => {
      expect(b.outer).toHaveLength(shapes[i]!.length);
      const iou = polygonIou([b.outer], [shapes[i]!]);
      expect(iou).toBeGreaterThan(0.999);
      for (const [k, p] of b.outer.entries()) {
        const q = shapes[i]!.find((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) < 0.02);
        expect(q, `vertex ${k} of ${i}`).toBeDefined();
      }
    });
  });

  it('keeps courtyards (multipolygon inner) with the right orientation and area', () => {
    const outer: [number, number][] = [
      [0, 0],
      [60, 0],
      [60, 50],
      [0, 50],
    ];
    const hole: [number, number][] = [
      [20, 15],
      [40, 15],
      [40, 35],
      [20, 35],
    ];
    const rel: RawBuilding = { ...way(7, outer, {}, [hole]), way: false };
    const [b] = buildBuildings(raw([rel]), proj);
    expect(b!.rel).toBe(true);
    expect(b!.inner).toHaveLength(1);
    expect(signedArea(b!.outer)).toBeGreaterThan(0);
    expect(signedArea(b!.inner[0]!)).toBeLessThan(0);
    expect(b!.area).toBeCloseTo(60 * 50 - 20 * 20, 0);
    expect(polygonIou([b!.outer, b!.inner[0]!], [outer, hole])).toBeGreaterThan(0.999);
  });

  it('marks walls shared by neighbours (terraced houses)', () => {
    const a = way(1, [
      [0, 0],
      [10, 0],
      [10, 12],
      [0, 12],
    ]);
    const b = way(2, [
      [10, 2],
      [18, 2],
      [18, 10],
      [10, 10],
    ]);
    const c = way(3, [
      [30, 0],
      [40, 0],
      [40, 10],
      [30, 10],
    ]);
    const [A, B, C] = buildBuildings(raw([a, b, c]), proj);
    expect(A!.shared).toHaveLength(1);
    const k = A!.shared[0]!;
    expect(A!.outer[k]![0]).toBeCloseTo(10, 1);
    expect(A!.outer[(k + 1) % 4]![0]).toBeCloseTo(10, 1);
    expect(B!.shared).toHaveLength(1);
    expect(C!.shared).toHaveLength(0);
  });

  it('heights: height > levels (+ roof) > default by type; building:part raises the top', () => {
    expect(osmNumber('12,5 m')).toBe(12.5);
    expect(osmNumber('abc')).toBeUndefined();
    expect(heightsOf({ building: 'yes', height: '15' })).toMatchObject({
      height: 15,
      levels: 5,
      from: 'height',
    });
    expect(
      heightsOf({ building: 'yes', 'building:levels': '4', 'roof:levels': '1' }),
    ).toMatchObject({ height: 15, levels: 4, from: 'levels' });
    expect(heightsOf({ building: 'apartments' })).toMatchObject({ levels: 4, from: 'default' });
    const base = way(
      1,
      [
        [0, 0],
        [30, 0],
        [30, 20],
        [0, 20],
      ],
      { 'building:levels': '2' },
    );
    const tower = way(
      2,
      [
        [5, 5],
        [12, 5],
        [12, 12],
        [5, 12],
      ],
      { building: '', 'building:part': 'yes', 'building:levels': '9' },
    );
    const [b] = buildBuildings(raw([base, tower]), proj);
    expect(b!.parts).toHaveLength(1);
    expect(b!.levels).toBe(9);
    expect(b!.heightFrom).toBe('parts');
  });

  const cache = `${homedir()}/.cache/deadzone-osm/stw-bld-raw2.json`;
  it.skipIf(!existsSync(cache))(
    'real data (cache): 1:1 outlines, courtyards and parts kept',
    () => {
      const r = JSON.parse(readFileSync(cache, 'utf8')) as RawBuildings2;
      const bs = buildBuildings(r, proj);
      expect(bs.length).toBeGreaterThan(60000);
      expect(bs.filter((b) => b.inner.length).length).toBeGreaterThanOrEqual(5);
      expect(bs.filter((b) => b.parts.length).length).toBeGreaterThan(5);
    },
    120_000,
  );
});
