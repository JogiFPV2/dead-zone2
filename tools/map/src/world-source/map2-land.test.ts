import { describe, expect, it } from 'vitest';
import { map2Land, waterwayWidth, type Map2Land } from '../osm/map2-land.js';
import { OSM_RAW_SHIFT, STW2_OFFSET } from '../osm/map2-buildings.js';

const sq = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];
const dm = (v: number, axis: 0 | 1) => Math.round((v + STW2_OFFSET[axis] - OSM_RAW_SHIFT) * 10);

const land: Map2Land = {
  areas: [
    // Pond with an island (hole), 1:1.
    {
      id: 1,
      way: true,
      ring: 0,
      tags: { natural: 'water', water: 'pond', name: 'Staw' },
      outer: sq(0, 0, 100),
      inner: [sq(40, 40, 10)],
    },
    { id: 2, way: true, ring: 0, tags: { landuse: 'forest' }, outer: sq(200, 0, 50), inner: [] },
    // Multipolygon ring 1 (second outer ring): its own id above every way id.
    { id: 3, way: false, ring: 1, tags: { natural: 'wood' }, outer: sq(300, 0, 50), inner: [] },
    {
      id: 4,
      way: true,
      ring: 0,
      tags: { amenity: 'parking_space' },
      outer: sq(0, 300, 5),
      inner: [],
    },
    // Far outside the world square.
    { id: 5, way: true, ring: 0, tags: { landuse: 'forest' }, outer: sq(-90000, 0, 50), inner: [] },
  ],
  lines: [
    {
      id: 10,
      tags: { waterway: 'river', name: 'San' },
      pts: [
        [0, 0],
        [500, 0],
      ],
    },
    {
      id: 11,
      tags: { waterway: 'stream', width: '4.5' },
      pts: [
        [0, 10],
        [50, 10],
      ],
    },
    {
      id: 12,
      tags: { waterway: 'drain' },
      pts: [
        [0, 20],
        [50, 20],
      ],
    },
    {
      id: 13,
      tags: { waterway: 'ditch', tunnel: 'culvert' },
      pts: [
        [0, 30],
        [50, 30],
      ],
    },
    {
      id: 20,
      tags: { railway: 'rail', electrified: 'contact_line' },
      pts: [
        [0, 50],
        [100, 50],
      ],
    },
    {
      id: 21,
      tags: { railway: 'rail', service: 'siding' },
      pts: [
        [0, 60],
        [100, 60],
      ],
    },
    {
      id: 22,
      tags: { railway: 'disused', electrified: 'contact_line' },
      pts: [
        [0, 70],
        [100, 70],
      ],
    },
    {
      id: 23,
      tags: { railway: 'abandoned' },
      pts: [
        [0, 80],
        [100, 80],
      ],
    },
    {
      id: 30,
      tags: { barrier: 'hedge' },
      pts: [
        [0, 90],
        [10, 90],
        [10, 100],
      ],
    },
    {
      id: 31,
      tags: { natural: 'tree_row' },
      pts: [
        [0, 110],
        [30, 110],
      ],
    },
    {
      id: 32,
      tags: { power: 'line', voltage: '110000' },
      pts: [
        [0, 120],
        [300, 120],
      ],
    },
  ],
  nodes: [
    { id: 40, tags: { natural: 'tree' }, xy: [5, 5] },
    { id: 41, tags: { railway: 'switch' }, xy: [100, 50] },
    { id: 42, tags: { railway: 'switch' }, xy: [55, 55] },
    { id: 43, tags: { amenity: 'pharmacy', name: 'Apteka' }, xy: [7, 7] },
  ],
};

describe('map2 land → stw2 ground', () => {
  const g = map2Land(land);

  it('areas 1:1 with holes, classified like the old converter, outside dropped', () => {
    const pond = g.areas.find((a) => a.id === 1)!;
    expect(pond.kind).toBe('water');
    expect(pond.name).toBe('Staw');
    expect(pond.rings).toHaveLength(2);
    expect(pond.rings[0]!.slice(0, 4)).toEqual([dm(0, 0), dm(0, 1), dm(100, 0), dm(0, 1)]);
    expect(g.areas.find((a) => a.id === 2)!.kind).toBe('forest');
    expect(g.areas.find((a) => a.id === 1e10 + 1e8 + 3)!.kind).toBe('forest');
    expect(g.areas.some((a) => a.id === 4 || a.id === 5)).toBe(false);
  });

  it('hedges become scrub strips (one per segment)', () => {
    expect(g.areas.filter((a) => a.id === 30 && a.kind === 'scrub')).toHaveLength(2);
  });

  it('waterways: kind and width from tags, culverts dropped', () => {
    expect(g.waterways.map((w) => [w.id, w.kind, w.width])).toEqual([
      [10, 'river', 60],
      [11, 'stream', 4.5],
      [12, 'ditch', 1.5],
    ]);
    expect(waterwayWidth('river', { name: 'Łęg' })).toBe(15);
  });

  it('railways of every kind; abandoned dropped; catenary only on live lines', () => {
    expect(g.rails.map((r) => [r.id, r.kind, r.el ?? 0])).toEqual([
      [20, 'rail', 1],
      [21, 'siding', 0],
      [22, 'disused', 0],
    ]);
    expect(g.railNodes).toEqual([{ kind: 'switch', x: dm(100, 0), y: dm(50, 1) }]);
  });

  it('trees, tree rows, power lines and POIs', () => {
    expect(g.trees).toEqual([dm(5, 0), dm(5, 1)]);
    expect(g.treeRows).toHaveLength(1);
    expect(g.power).toEqual([expect.objectContaining({ id: 32, kind: 'hv110', circuits: 1 })]);
    expect(g.pois).toEqual([{ kind: 'pharmacy', name: 'Apteka', x: dm(7, 0), y: dm(7, 1) }]);
  });
});
