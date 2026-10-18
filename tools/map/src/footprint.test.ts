// Footprint mebli (#218) on every content map and on a sample of the lazy world generator:
// every tile of every piece of furniture lies in its room, nothing overlaps, doors stay free.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentBundle } from '@deadzone/content';
import { BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import { footprintForId } from '@deadzone/content/footprint';
import { beforeAll, describe, expect, it } from 'vitest';
import { blockedTiles, footprintIssues } from './footprint-check.js';
import {
  LIGHT_SWITCH,
  MapView,
  POWERED_LAMPS,
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

  it('przy każdym telewizorze stoi magnetowid (#211), w salonach radio', () => {
    for (const id of ['osm-okulickiego', 'town-catalog']) {
      const { view, objects } = loadMap(id);
      const tvs = objects.filter((o) => o.contentId === 'base:tv');
      const vcrs = objects.filter((o) => o.contentId === 'base:vcr');
      expect(tvs.length, id).toBeGreaterThan(0);
      for (const t of tvs)
        expect(
          vcrs.some(
            (v) =>
              v.z === t.z &&
              Math.abs(v.x - t.x) + Math.abs(v.y - t.y) <= 2 &&
              view.room(v.x, v.y, v.z) === view.room(t.x, t.y, t.z),
          ),
          `${id}: TV (${t.x}, ${t.y}, ${t.z}) bez magnetowidu`,
        ).toBe(true);
      const radios = objects.filter((o) => o.contentId === 'base:radio-set');
      for (const r of radios)
        expect(view.rooms.get(view.room(r.x, r.y, r.z))?.roomType).toBe('base:room-living-room');
      expect(radios.length, id).toBeGreaterThan(0);
    }
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
    expect(issues.map((i) => `${i.kind}: ${i.at}`).slice(0, 20)).toEqual([]);
  });
});
