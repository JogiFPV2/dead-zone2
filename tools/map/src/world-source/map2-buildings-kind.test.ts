import { describe, expect, it } from 'vitest';
import { map2Buildings, type Map2Building } from '../osm/map2-buildings.js';
import type { Map2Land } from '../osm/map2-land.js';

type Pt = [number, number];
const sq = (x: number, y: number, w: number, h = w): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const b = (
  id: number,
  outer: Pt[],
  tags: Record<string, string> = { building: 'yes' },
): Map2Building => ({
  id,
  rel: false,
  ring: 0,
  outer,
  inner: [],
  shared: [],
  sharedBy: [],
  tags,
  levels: 1,
  roofLevels: 0,
  height: 3,
  heightFrom: 'default',
  area: Math.abs((outer[2]![0] - outer[0]![0]) * (outer[2]![1] - outer[0]![1])),
});
const area = (id: number, tags: Record<string, string>, outer: Pt[]) => ({
  id,
  way: true,
  ring: 0,
  tags,
  outer: [...outer, outer[0]!],
  inner: [],
});

describe('map2 building kinds from the land around them', () => {
  const land: Map2Land = {
    areas: [
      area(1, { landuse: 'residential' }, sq(0, 0, 400)),
      area(2, { landuse: 'industrial' }, sq(500, 0, 300)),
      area(3, { amenity: 'hospital' }, sq(0, 500, 200)),
      // landuse=grass inside the estate is not context.
      area(4, { landuse: 'grass' }, sq(100, 100, 200)),
    ],
    lines: [],
    nodes: [
      { id: 10, tags: { amenity: 'police', name: 'Komenda' }, xy: [55, 305] },
      { id: 11, tags: { amenity: 'bus_station', name: 'Dworzec PKS' }, xy: [210, 310] },
      { id: 12, tags: { amenity: 'police' }, xy: [355, 305] },
    ],
  };
  const bs = [
    b(1, sq(150, 150, 60, 30)), // big, in the estate (and the grass) → block
    b(2, sq(20, 20, 6, 7)), // 42 m², no number → garage
    b(3, sq(30, 20, 6, 7), { building: 'yes', 'addr:housenumber': '12' }), // 42 m² with a number → house
    b(4, sq(550, 50, 40, 40)), // industrial land → industrial
    b(5, sq(50, 550, 30, 30)), // hospital grounds → hospital
    b(6, sq(50, 300, 10, 10)), // police POI inside
    b(7, sq(200, 300, 20, 20)), // PKS
    b(8, sq(350, 300, 20, 20), { building: 'train_station' }), // railway guard post inside a station
  ];
  const kinds = Object.fromEntries(map2Buildings(bs, land).map((o) => [o.id, o.kind]));

  it('uses landuse, house numbers, amenity grounds and POIs', () => {
    expect(kinds).toEqual({
      1: 'block',
      2: 'garage',
      3: 'house',
      4: 'industrial',
      5: 'hospital',
      6: 'police',
      7: 'station',
      8: 'station',
    });
  });

  it('without land only tags and size count (as before)', () => {
    const k = Object.fromEntries(map2Buildings(bs).map((o) => [o.id, o.kind]));
    expect(k[1]).toBe('industrial');
    expect(k[6]).toBe('house');
    expect(k[8]).toBe('station');
  });
});
