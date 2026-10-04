import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_PACK_DIR } from '@deadzone/content/node';
import type { MapChunkJson } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { parseBlueprint } from '../blueprint.js';
import { buildMap } from '../build.js';
import {
  defaultLevels,
  kindFromContext,
  kindFromTags,
  levelsFromTags,
  KIND_TYPE,
} from './classify.js';
import { buildInterior, type Footprint } from './interior.js';
import { unreachableRoomTiles } from './reach.js';
import { BUILDING_TYPES, type BuildingKind } from './types.js';

describe('OSM tags → our building types', () => {
  it('maps tags and POIs to kinds and catalogue types', () => {
    expect(kindFromTags({ building: 'apartments' })).toBe('block');
    expect(kindFromTags({ building: 'yes', amenity: 'pharmacy' })).toBe('pharmacy');
    expect(kindFromTags({ building: 'yes', shop: 'supermarket' })).toBe('shop');
    expect(kindFromTags({ building: 'church' })).toBe('church');
    expect(kindFromTags({ building: 'garages' })).toBe('garage');
    expect(kindFromTags({ building: 'yes', amenity: 'fuel' })).toBe('fuel');
    expect(kindFromTags({ building: 'yes' })).toBeUndefined();
    expect(kindFromContext('residential', 600, 60).kind).toBe('block');
    expect(kindFromContext('industrial', 2000, 80)).toEqual({
      kind: 'industrial',
      from: 'landuse',
    });
    expect(kindFromContext(undefined, 20, 5)).toEqual({ kind: 'shed', from: 'default' });
    for (const t of Object.values(KIND_TYPE)) expect(BUILDING_TYPES).toContain(t);
  });

  it('takes storeys from building:levels / height, else the type default', () => {
    expect(levelsFromTags({ 'building:levels': '11' })).toBe(11);
    expect(levelsFromTags({ 'building:levels': '4;5' })).toBe(5);
    expect(levelsFromTags({ height: '9' })).toBe(3);
    expect(levelsFromTags({})).toBeUndefined();
    for (let id = 1; id < 400; id++) {
      const block = defaultLevels('block', id, 700, 30 + (id % 60));
      expect(block).toBeGreaterThanOrEqual(4);
      expect(block).toBeLessThanOrEqual(11);
      expect([1, 2]).toContain(defaultLevels('house', id, 90 + id, 12));
      const h = defaultLevels('hospital', id, 3000, 80);
      expect(h).toBeGreaterThanOrEqual(3);
      expect(h).toBeLessThanOrEqual(5);
      expect(defaultLevels('church', id, 900, 40)).toBe(1);
    }
    // Mostly 4 or 10–11.
    const counts = new Map<number, number>();
    for (let id = 1; id < 2000; id++) {
      const n = defaultLevels('block', id, 500, 20 + (id % 50));
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const common = (counts.get(4) ?? 0) + (counts.get(10) ?? 0) + (counts.get(11) ?? 0);
    expect(common / 1999).toBeGreaterThan(0.7);
  });
});

/** Footprint from a predicate over a w × h box, placed at (4, 4) on a grass map. */
function fp(w: number, h: number, inside: (x: number, y: number) => boolean): Footprint {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = inside(x, y) ? 1 : 0;
  return { x0: 4, y0: 4, w, h, mask };
}

function build(kind: BuildingKind, levels: number, f: Footprint) {
  const res = buildInterior({
    id: 1,
    kind,
    levels,
    fp: f,
    rnd: 0.3,
    nextRoomId: 1,
    doorScore: () => 10,
  });
  const size = Math.ceil((Math.max(f.w, f.h) + 8) / 32);
  const bp = parseBlueprint({
    id: 'osm-test',
    chunks: { cx0: 0, cy0: 0, cx1: size - 1, cy1: size - 1 },
    ground: 'base:grass',
    buildings: [res.building],
    stairs: res.stairs,
  });
  return { res, map: buildMap(bp) };
}

const SHAPES: [string, BuildingKind, number, Footprint][] = [
  ['11-storey point block 24×18', 'block', 11, fp(24, 18, () => true)],
  ['4-storey slab 62×12', 'block', 4, fp(62, 12, () => true)],
  ['L-shaped school 3 storeys', 'school', 3, fp(40, 30, (x, y) => x < 12 || y >= 18)],
  [
    'courtyard office (ring) 5 storeys',
    'office',
    5,
    fp(36, 30, (x, y) => x < 9 || x >= 27 || y < 9 || y >= 21),
  ],
  [
    'diagonal (rotated) house 2 storeys',
    'house',
    2,
    fp(16, 16, (x, y) => Math.abs(x - y) < 6 && x + y > 6 && x + y < 26),
  ],
  ['small house 2 storeys 7×8', 'house', 2, fp(7, 8, () => true)],
  ['hospital U 5 storeys', 'hospital', 5, fp(50, 34, (x, y) => y < 12 || x < 12 || x >= 38)],
  ['church nave 1 tall storey', 'church', 1, fp(30, 14, (x, y) => !(x > 24 && (y < 4 || y > 9)))],
  ['industrial hall', 'industrial', 1, fp(60, 40, () => true)],
];

describe('generated interiors fit any footprint', () => {
  it.each(SHAPES)(
    '%s: every storey has stairs, an exit is reachable from every tile',
    (_n, kind, levels, f) => {
      const { res, map } = build(kind, levels, f);
      expect(res.levels).toBe(levels);
      // One flight per storey above the ground floor.
      expect(res.stairs.map((s) => s.zFrom ?? 0).sort((a, b) => a - b)).toEqual(
        Array.from({ length: levels - 1 }, (_, i) => i),
      );
      expect(res.doors.length).toBeGreaterThan(0);
      const chunks = map.chunks.map((c) => c.json);
      for (let z = 0; z < levels; z++)
        expect(chunks.some((c) => c.address.z === z && Object.keys(c.rooms ?? {}).length > 0)).toBe(
          true,
        );
      expect(unreachableRoomTiles(chunks)).toEqual([]);
    },
  );
});

describe('OSM scene osm-okulickiego (content map in the base pack)', () => {
  const dir = join(BASE_PACK_DIR, 'maps', 'osm-okulickiego', 'chunks');
  const chunks = readdirSync(dir).map(
    (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as MapChunkJson,
  );

  it('from every storey of every building you can walk out', () => {
    expect(unreachableRoomTiles(chunks)).toEqual([]);
  });

  it('every building storey above the ground has a flight arriving from below', () => {
    const rooms = new Map<number, Set<number>>();
    for (const c of chunks)
      for (const r of Object.values(c.rooms ?? {}))
        rooms.set(r.buildingId, (rooms.get(r.buildingId) ?? new Set()).add(c.address.z));
    const flights = chunks.reduce((n, c) => n + (c.stairs?.length ?? 0), 0);
    const storeys = [...rooms.values()].reduce((n, zs) => n + zs.size - 1, 0);
    expect(flights).toBe(storeys);
    expect(rooms.size).toBeGreaterThan(50);
  });
});
