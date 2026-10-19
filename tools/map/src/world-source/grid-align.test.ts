import { describe, expect, it } from 'vitest';
import type { OsmMap } from '../osm/types.js';
import { alignBuildingsToGrid, type GridAlignStats } from './grid-align.js';
import { OSM_SHIFT, ringOrientation, straightenOsmMap } from './straighten.js';

/** Closed flat decimetre ring of a rectangle w × h (m) centred at (x, y), turned by `deg`. */
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

const map = (over: Partial<OsmMap>): OsmMap => ({
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
});

const building = (id: number, ring: number[]) =>
  ({
    id,
    type: 'x',
    kind: 'house',
    typeFrom: 'tag',
    levels: 1,
    levelsFrom: 'tag',
    rings: [ring],
  }) as never;

/** World-frame outer ring of building 0 after the runtime straightening (no global rotation). */
const worldRing = (m: OsmMap) => straightenOsmMap(m, 0).buildings[0]!.rings[0]!;
const xs = (r: number[]) => r.filter((_, i) => i % 2 === 0).map((v) => v / 10);

describe('grid align (buildings off the street grid)', () => {
  it('turns a lone building at 30° onto the axes about its centre', () => {
    const s = {} as GridAlignStats;
    const out = alignBuildingsToGrid(
      map({ buildings: [building(1, rect(5000, 5000, 24, 10, 30))] }),
      0,
      s,
    );
    expect(s).toMatchObject({ offGrid: 1, turned: 1, fitted: 0, jagged: 0 });
    const r = worldRing(out);
    expect(Math.abs(ringOrientation(r).deg)).toBeLessThan(0.5);
    const x = xs(r);
    expect(Math.max(...x) - Math.min(...x)).toBe(24);
    expect((Math.max(...x) + Math.min(...x)) / 2).toBeCloseTo(5000 + OSM_SHIFT, 0);
  });

  it('shifts / shrinks it inside its plot instead of covering a road', () => {
    const road = {
      id: 7,
      kind: 'residential',
      width: 1.5,
      sidewalk: 0,
      pts: [50110, 49000, 50110, 51000],
    };
    const s = {} as GridAlignStats;
    const out = alignBuildingsToGrid(
      map({ roads: [road] as never, buildings: [building(1, rect(5000, 5000, 24, 10, 30))] }),
      0,
      s,
    );
    expect(s).toMatchObject({ offGrid: 1, turned: 0, fitted: 1, jagged: 0 });
    // Road tiles x 5010..5011 (raw): the turned building ends west of them.
    expect(Math.max(...xs(worldRing(out)))).toBeLessThanOrEqual(5010 + OSM_SHIFT);
  });

  it('leaves buildings on the grid alone', () => {
    const s = {} as GridAlignStats;
    const m = map({ buildings: [building(1, rect(5000, 5000, 24, 10, 3))] });
    const out = alignBuildingsToGrid(m, 0, s);
    expect(s.offGrid).toBe(0);
    expect(out.buildings[0]).toBe(m.buildings[0]);
  });

  it('keeps the angle when nothing fits (houses either side, both ways)', () => {
    // A narrow building at 44° with small houses on the grid in its plot's free corners.
    const houses = [
      building(2, rect(4992, 5000, 3, 5, 0)),
      building(3, rect(5008, 5000, 3, 5, 0)),
      building(4, rect(5000, 4992, 5, 3, 0)),
      building(5, rect(5000, 5008, 5, 3, 0)),
    ];
    const s = {} as GridAlignStats;
    alignBuildingsToGrid(
      map({ buildings: [building(1, rect(5000, 5000, 24, 4, 44)), ...houses] }),
      0,
      s,
    );
    expect(s).toMatchObject({ offGrid: 1, jagged: 1 });
  });
});
