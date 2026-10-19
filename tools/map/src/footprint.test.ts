// Footprint mebli (#218) on every content map and on a sample of the lazy world generator:
// every tile of every piece of furniture lies in its room, nothing overlaps, doors stay free.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from '@deadzone/content';
import { BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import {
  footprintForId,
  occupiedTiles,
  onSurfaceForId,
  surfaceHeightForId,
} from '@deadzone/content/footprint';
import { beforeAll, describe, expect, it } from 'vitest';
import { blockedTiles, footprintIssues, surfaceIssues } from './footprint-check.js';
import {
  LIGHT_SWITCH,
  MapView,
  OVERLAY_OBJECTS,
  POWERED_LAMPS,
  SPACED_SEATS,
  components,
  lightSwitches,
  type PlacedObject,
} from './furnish.js';
import {
  PlanChunkGenerator,
  columnFootprintIssues,
  plan4Plan,
  type GenColumn,
} from './world-source/index.js';

const MAPS = join(BASE_PACK_DIR, 'maps');
let bundle: ContentBundle;
const fp = (id: string) => footprintForId(bundle, id);
const sh = (id: string) => surfaceHeightForId(bundle, id);

beforeAll(async () => {
  bundle = await buildContentBundleFromDirs([BASE_PACK_DIR]);
});

function loadMap(id: string): { view: MapView; objects: PlacedObject[] } {
  const dir = join(MAPS, id, 'chunks');
  const chunks = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ json: JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown }));
  const objects: PlacedObject[] = [];
  for (const { json } of chunks) {
    const c = json as {
      address: { cx: number; cy: number; z: number };
      objects?: { contentId: string; x: number; y: number; rot?: number }[];
    };
    for (const o of c.objects ?? [])
      objects.push({
        contentId: o.contentId,
        x: c.address.cx * 32 + o.x,
        y: c.address.cy * 32 + o.y,
        z: c.address.z,
        rot: o.rot ?? 0,
      });
  }
  return { view: new MapView(chunks), objects };
}

const MAP_IDS = readdirSync(MAPS).filter((d) => readdirSync(join(MAPS, d)).includes('chunks'));

describe('footprint mebli na mapach contentu', () => {
  it('są wszystkie mapy z meblami', () => {
    expect(MAP_IDS).toEqual(expect.arrayContaining(['osm-okulickiego', 'town-catalog']));
  });
  for (const id of MAP_IDS) {
    it(`${id}: meble w pokoju, bez nakładania, drzwi wolne`, { timeout: 60_000 }, () => {
      const { view, objects } = loadMap(id);
      const issues = footprintIssues(view, objects, fp);
      expect(issues.map((i) => `${i.kind}: ${i.at}`).slice(0, 20)).toEqual([]);
    });
  }

  it('TV, magnetowid, radio i lampka stoją na meblu z blatem (#267), radio tylko w salonach', () => {
    let tops = 0;
    for (const id of MAP_IDS) {
      const { view, objects } = loadMap(id);
      tops += objects.filter((o) => onSurfaceForId(bundle, o.contentId)).length;
      expect(
        surfaceIssues(objects, fp, sh, (c) => onSurfaceForId(bundle, c)).slice(0, 20),
        id,
      ).toEqual([]);
      // Every TV has its VCR under it (#211), on the same stand.
      for (const t of objects.filter((o) => o.contentId === 'base:tv'))
        expect(
          objects.some(
            (v) => v.contentId === 'base:vcr' && v.x === t.x && v.y === t.y && v.z === t.z,
          ),
          `${id}: TV (${t.x}, ${t.y}, ${t.z}) bez magnetowidu`,
        ).toBe(true);
      for (const r of objects.filter((o) => o.contentId === 'base:radio-set'))
        expect(view.rooms.get(view.room(r.x, r.y, r.z))?.roomType).toBe('base:room-living-room');
    }
    for (const id of ['osm-okulickiego', 'town-catalog']) {
      const { objects } = loadMap(id);
      for (const c of ['base:tv', 'base:vcr', 'base:radio-set', 'base:desk-lamp'])
        expect(
          objects.some((o) => o.contentId === c),
          `${id}: ${c}`,
        ).toBe(true);
    }
    expect(tops).toBeGreaterThan(100);
  });

  it('kanapy, fotele i ławki tego samego typu nie stoją stykiem (kratka odstępu)', () => {
    let seats = 0;
    for (const id of MAP_IDS) {
      const { objects } = loadMap(id);
      const owner = new Map<string, number>();
      const list = objects.filter((o) => SPACED_SEATS.has(o.contentId));
      list.forEach((o, i) => {
        for (const t of occupiedTiles(o.x, o.y, o.rot, fp(o.contentId)))
          owner.set(`${o.contentId},${t.x},${t.y},${o.z}`, i);
      });
      list.forEach((o, i) => {
        seats++;
        for (const t of occupiedTiles(o.x, o.y, o.rot, fp(o.contentId)))
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const j = owner.get(`${o.contentId},${t.x + dx},${t.y + dy},${o.z}`);
              expect(
                j === undefined || j === i,
                `${id}: ${o.contentId} (${o.x}, ${o.y}, ${o.z}) styka się z drugim`,
              ).toBe(true);
            }
      });
    }
    expect(seats).toBeGreaterThan(10);
  });

  it('toaleta w każdej łazience, która ma na nią miejsce (#258)', () => {
    const SIDES = [
      ['n', 0, -1],
      ['e', 1, 0],
      ['s', 0, 1],
      ['w', -1, 0],
    ] as const;
    const OPP = { n: 's', s: 'n', e: 'w', w: 'e' } as const;
    let toilets = 0;
    for (const id of MAP_IDS) {
      const { view, objects } = loadMap(id);
      const { doors, stairs } = blockedTiles(view);
      const occ = new Set<string>();
      for (const o of objects)
        if (!OVERLAY_OBJECTS.has(o.contentId))
          for (const t of occupiedTiles(o.x, o.y, o.rot, fp(o.contentId)))
            occ.add(`${t.x},${t.y},${o.z}`);
      const baths = new Map<number, number>();
      for (const [r, m] of view.rooms) if (m.roomType === 'base:room-bathroom') baths.set(r, 0);
      for (const o of objects)
        if (o.contentId === 'base:toilet') {
          const r = view.room(o.x, o.y, o.z);
          expect(baths.has(r), `${id}: toaleta (${o.x}, ${o.y}) poza łazienką`).toBe(true);
          // Back to a solid wall, front open into the room.
          const [s, dx, dy] = SIDES[o.rot & 3]!;
          expect(view.edge(o.x, o.y, o.z, s), `${id}: toaleta (${o.x}, ${o.y}) bez ściany`).toBe(
            'wall',
          );
          expect(view.open(o.x, o.y, o.z, OPP[s])).toBe(true);
          expect(view.room(o.x - dx, o.y - dy, o.z)).toBe(r);
          baths.set(r, (baths.get(r) ?? 0) + 1);
          toilets++;
        }
      // A bathroom without one has no free wall tile with a free front (doors, stairs aside).
      const tiles = new Map<number, [number, number, number][]>();
      for (const z of view.levels)
        for (const [x, y] of view.tiles(z)) {
          const r = view.room(x, y, z);
          if (baths.get(r) === 0) (tiles.get(r) ?? tiles.set(r, []).get(r)!).push([x, y, z]);
        }
      // Front rows of the furniture stay free (a toilet never blocks the sink).
      const fronts = new Set<string>();
      for (const o of objects) {
        if (OVERLAY_OBJECTS.has(o.contentId) || o.contentId === 'base:chair') continue;
        const [, dx, dy] = SIDES[o.rot & 3]!;
        const cells = occupiedTiles(o.x, o.y, o.rot, fp(o.contentId));
        const own = new Set(cells.map((t) => `${t.x},${t.y}`));
        for (const t of cells)
          if (!own.has(`${t.x - dx},${t.y - dy}`)) fronts.add(`${t.x - dx},${t.y - dy},${o.z}`);
      }
      const free = (x: number, y: number, z: number) => {
        const k = `${x},${y},${z}`;
        return !occ.has(k) && !doors.has(k) && !stairs.has(k);
      };
      const indoor = (x: number, y: number, z: number, r: number) => view.room(x, y, z) === r;
      for (const [r, list] of tiles) {
        const xy = list.map(([x, y]) => [x, y] as [number, number]);
        const z0 = list[0]![2];
        const before = components(view, xy, z0, r, occ, indoor);
        const spot = list.find(([x, y, z]) =>
          SIDES.some(
            ([s, dx, dy]) =>
              free(x, y, z) &&
              !fronts.has(`${x},${y},${z}`) &&
              components(view, xy, z, r, new Set([...occ, `${x},${y},${z}`]), indoor) <= before &&
              view.edge(x, y, z, s) === 'wall' &&
              view.open(x, y, z, OPP[s]) &&
              view.room(x - dx, y - dy, z) === r &&
              free(x - dx, y - dy, z),
          ),
        );
        expect(spot, `${id}: łazienka ${r} bez toalety, a miejsce jest przy ${String(spot)}`).toBe(
          undefined,
        );
      }
    }
    expect(toilets).toBeGreaterThan(10);
  });

  it('przy każdym stole w kuchni stoi krzesło przodem do stołu (#254)', () => {
    let tables = 0;
    for (const id of MAP_IDS) {
      const { view, objects } = loadMap(id);
      const chairs = objects.filter((o) => o.contentId === 'base:chair');
      for (const t of objects.filter((o) => o.contentId === 'base:table')) {
        if (view.rooms.get(view.room(t.x, t.y, t.z))?.roomType !== 'base:room-kitchen') continue;
        tables++;
        const cells = occupiedTiles(t.x, t.y, t.rot, fp(t.contentId));
        // rot = the chair's back side: it faces the tile on the opposite side.
        const facing = [
          [0, 1],
          [-1, 0],
          [0, -1],
          [1, 0],
        ] as const;
        const seated = chairs.some((c) => {
          const [dx, dy] = facing[c.rot & 3]!;
          return c.z === t.z && cells.some((q) => q.x === c.x + dx && q.y === c.y + dy);
        });
        expect(seated, `${id}: stół (${t.x}, ${t.y}, ${t.z}) bez krzesła`).toBe(true);
      }
    }
    expect(tables).toBeGreaterThan(0);
  });

  it('w każdym pokoju z lampą na prąd jest włącznik światła (#242, #246)', () => {
    let lamps = 0;
    for (const id of MAP_IDS) {
      const { view, objects } = loadMap(id);
      const switched = new Set(
        objects
          .filter((o) => o.contentId === LIGHT_SWITCH)
          .map((o) => `${o.z}:${view.room(o.x, o.y, o.z)}`),
      );
      for (const o of objects.filter((o) => POWERED_LAMPS.has(o.contentId))) {
        const r = view.room(o.x, o.y, o.z);
        if (!r) continue;
        lamps++;
        expect(switched.has(`${o.z}:${r}`), `${id}: lampa (${o.x}, ${o.y}) bez włącznika`).toBe(
          true,
        );
      }
      expect(lightSwitches(view, objects), id).toEqual([]);
    }
    expect(lamps).toBeGreaterThan(0);
  });

  it('sprawdzarka łapie nakładanie, wyjście z pokoju i mebel w drzwiach', () => {
    const { view, objects } = loadMap('town-catalog');
    const bed = objects.find((o) => o.contentId === 'base:bed')!;
    // A second bed shifted by one tile into the first one's second tile.
    const kinds = footprintIssues(view, [...objects, { ...bed }], fp).map((i) => i.kind);
    expect(kinds).toContain('overlap');
    // A bed pushed one tile back through its head wall: one tile is in another room / outside.
    const beds = objects.filter((o) => o.contentId === 'base:bed' && o.rot === 0);
    expect(beds.length).toBeGreaterThan(0);
    for (const b of beds) {
      const kinds = footprintIssues(view, [{ ...b, y: b.y - 1 }], fp).map((i) => i.kind);
      expect(kinds).toContain('room');
    }
    const door = [...blockedTiles(view).doors][0]!.split(',').map(Number);
    const inDoor = { contentId: 'base:dresser', x: door[0]!, y: door[1]!, z: door[2]!, rot: 0 };
    expect(footprintIssues(view, [inDoor], fp).map((i) => i.kind)).toContain('door');
  });
});

describe('footprint mebli w generatorze świata (plan-4, próbka chunków)', () => {
  it('meble w pokoju, bez nakładania, drzwi wolne', { timeout: 180_000 }, () => {
    const gen = new PlanChunkGenerator(plan4Plan(1993, 4096));
    const s = gen.start();
    const cols: GenColumn[] = [];
    const cx0 = Math.floor(s.x / 32);
    const cy0 = Math.floor(s.y / 32);
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const c = gen.column(cx0 + dx, cy0 + dy);
        if (c) cols.push(c);
      }
    let objects = 0;
    let big = 0;
    for (const c of cols)
      for (const l of c.levels)
        for (const o of l.objects) {
          objects++;
          const f = fp(o.contentId);
          if (f.w * f.h > 1) big++;
        }
    expect(objects).toBeGreaterThan(100);
    expect(big).toBeGreaterThan(10);
    const issues = columnFootprintIssues(cols, fp);
    // #267: every onSurface object on a worktop (anchors in the chunk: same column).
    const surf: string[] = [];
    for (const c of cols)
      for (const l of c.levels)
        surf.push(
          ...surfaceIssues(
            l.objects.map((o) => ({ ...o, x: c.cx * 32 + o.x, y: c.cy * 32 + o.y, z: l.z })),
            fp,
            sh,
            (id) => onSurfaceForId(bundle, id),
          ),
        );
    expect(surf.slice(0, 20)).toEqual([]);
    expect(issues.map((i) => `${i.kind}: ${i.at}`).slice(0, 20)).toEqual([]);
  });
});
