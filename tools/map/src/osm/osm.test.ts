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
    // floor(height / 2.8): 16.5 m → 5 storeys (not round(16.5 / 3) = 6).
    expect(levelsFromTags({ height: '16.5' })).toBe(5);
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
  ['huge industrial hall in sections', 'industrial', 1, fp(170, 96, () => true)],
  ['huge L-shaped hall in sections', 'industrial', 1, fp(160, 120, (x, y) => x < 70 || y < 40)],
];

describe('generated interiors fit any footprint', () => {
  it.each(SHAPES)(
    '%s: every storey has stairs, an exit is reachable from every tile',
    (_n, kind, levels, f) => {
      const { res, map } = build(kind, levels, f);
      expect(res.levels).toBe(levels);
      // One flight per storey above the ground floor in every stairwell (blocks: one per klatka).
      const per = new Map<number, number>();
      for (const st of res.stairs) per.set(st.zFrom ?? 0, (per.get(st.zFrom ?? 0) ?? 0) + 1);
      expect([...per.keys()].sort((a, b) => a - b)).toEqual(
        Array.from({ length: levels - 1 }, (_, i) => i),
      );
      expect(new Set(per.values()).size).toBeLessThanOrEqual(1);
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

  // Flood fill over every storey of the whole scene: ~5 s on a loaded box, so a generous timeout.
  it('from every storey of every building you can walk out', { timeout: 60_000 }, () => {
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

describe('new building types', () => {
  it('a long block of flats has a klatka per ~16 m, each with its own entrance and stairs', () => {
    const { res } = build(
      'block',
      5,
      fp(62, 12, () => true),
    );
    const klatki = res.stairs.filter((s) => (s.zFrom ?? 0) === 0).length;
    expect(klatki).toBe(4);
    expect(res.stairs).toHaveLength(4 * 4);
    expect(res.doors).toHaveLength(4);
    // Entrances on one long side, ~16 m apart.
    const xs = res.doors.map((d) => d.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThan(12);
    expect(new Set(res.doors.map((d) => d.side)).size).toBe(1);
    // Flats: every room of a floor except the klatki is a flat (no corridor through the block).
    const types = Object.values(res.building.rooms).map((r) => r.type);
    expect(types.filter((t) => t === 'base:room-hall')).toHaveLength(4);
    expect(types.length).toBeGreaterThanOrEqual(4 + 4 * 2);
  });

  it('a big industrial building is one open hall with offices and a double gate', () => {
    const { res } = build(
      'industrial',
      1,
      fp(60, 40, () => true),
    );
    const rooms = Object.values(res.building.rooms);
    expect(rooms.map((r) => r.type)).toContain('base:room-warehouse');
    expect(rooms.length).toBeLessThanOrEqual(3);
    // Gate: two doors side by side on the same wall.
    const [a, b] = res.doors;
    expect(a && b && a.side === b.side && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1).toBe(
      true,
    );
  });

  it('a huge hall is split into ~40 m sections joined by double gates, with workshops', () => {
    const { res } = build(
      'industrial',
      1,
      fp(170, 96, () => true),
    );
    const rooms = Object.entries(res.building.rooms);
    const halls = rooms.filter(
      ([, r]) => r.type !== 'base:room-office' && r.type !== 'base:room-bathroom',
    );
    // (170 − 4) / 40 ≈ 4 along, 96 / 40 ≈ 2 across.
    expect(halls).toHaveLength(8);
    expect(halls.map(([, r]) => r.type)).toContain('base:room-garage');
    // Inner doors between sections come in pairs side by side (gates).
    const hallChars = new Set(halls.map(([c]) => c));
    const plan = res.building.plan;
    const inner = (res.building.openings ?? []).filter((o) => {
      if (o.type !== 'door') return false;
      const [x, y] = o.at;
      const [dx, dy] =
        o.side === 'e' ? [1, 0] : o.side === 's' ? [0, 1] : o.side === 'w' ? [-1, 0] : [0, -1];
      const a = plan[y]?.[x];
      const b = plan[y + dy]?.[x + dx];
      return a !== b && hallChars.has(a ?? '') && hallChars.has(b ?? '');
    });
    // 8 sections in a 4 × 2 grid: 3 × 2 + 4 × 1 = 10 partitions, 2 doors each.
    expect(inner).toHaveLength(20);
  });
});

describe('typical home plan', () => {
  const types = (r: ReturnType<typeof build>['res'], z: number) => {
    const rooms = z === 0 ? r.building.rooms : r.building.floors?.find((f) => f.z === z)?.rooms;
    return Object.values(rooms ?? {}).map((x) => x.type);
  };

  it('a two-storey house: hall with stairs, living room, kitchen, bathroom; bedrooms upstairs', () => {
    const { res } = build(
      'house',
      2,
      fp(11, 9, () => true),
    );
    expect(res.levels).toBe(2);
    const g = types(res, 0);
    for (const t of ['hall', 'living-room', 'kitchen', 'bathroom'])
      expect(g).toContain(`base:room-${t}`);
    const up = types(res, 1);
    expect(up).toContain('base:room-bedroom');
    expect(up).toContain('base:room-bathroom');
    expect(up).not.toContain('base:room-kitchen');
    // The hall strip crosses the house: the stairs are in it.
    const plan = res.building.plan;
    for (const s of res.stairs) expect(['C', 'U']).toContain(plan[s.at[1] - 4]![s.at[0] - 4]);
  });
});
