import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STAIR_STEP } from '@deadzone/content';
import { BASE_PACK_DIR } from '@deadzone/content/node';
import { describe, expect, it } from 'vitest';
import { parseBlueprint, type Blueprint } from './blueprint.js';
import { buildMap } from './build.js';
import { CATALOG, CATALOG_IDS, placeCatalog } from './catalog.js';
import { MapView, components, furnish, type PlacedObject } from './furnish.js';
import { baseFurnishOptions } from './furnish-base.js';
import { townCatalogBlueprint } from './town-catalog-map.js';

const OPT = baseFurnishOptions(1);

/** Content ids tagged `base:outdoor-ok` (containers + items) in the base pack. */
function outdoorOk(): Set<string> {
  const out = new Set<string>();
  for (const dir of ['containers', 'items']) {
    const d = join(BASE_PACK_DIR, dir);
    for (const f of readdirSync(d).filter((n) => n.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(d, f), 'utf8')) as unknown;
      const list = (Array.isArray(raw) ? raw : [raw]) as { id: string; tags?: string[] }[];
      for (const t of list) if (t.tags?.includes('base:outdoor-ok')) out.add(t.id);
    }
  }
  return out;
}
const OK = outdoorOk();

const SIDE = [
  ['n', 0, -1],
  ['e', 1, 0],
  ['s', 0, 1],
  ['w', -1, 0],
] as const;
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' } as const;

function unit(type: string, rot: number): Blueprint {
  const p = placeCatalog(CATALOG[type]!, [6, 6], rot, 1, 1);
  return parseBlueprint({
    id: 'unit',
    chunks: { cx0: 0, cy0: 0, cx1: 1, cy1: 1 },
    ground: 'base:grass',
    buildings: p.buildings,
    stairs: p.stairs,
  });
}

/** Checks every furnishing rule; returns a list of human-readable violations. */
function violations(bp: Blueprint, objs: readonly PlacedObject[]): string[] {
  const bad: string[] = [];
  const view = new MapView(buildMap({ ...bp, objects: [] }).chunks);
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const taken = new Set(objs.map((o) => k(o.x, o.y, o.z)));
  if (taken.size !== objs.length) bad.push('two objects on one tile');
  // Door sides and stairs (runs, foot, landing).
  const reserved = new Set<string>();
  for (const z of view.levels) {
    for (const [x, y] of view.tiles(z)) {
      for (const [s, dx, dy] of SIDE) {
        if (view.edge(x, y, z, s) !== 'door') continue;
        reserved.add(k(x, y, z));
        reserved.add(k(x + dx, y + dy, z));
      }
    }
  }
  for (const s of view.stairs) {
    const [dx, dy] = STAIR_STEP[s.dir];
    reserved.add(k(s.x - dx, s.y - dy, s.z));
    reserved.add(k(s.x + dx * s.len, s.y + dy * s.len, s.z + 1));
    for (let i = 0; i < s.len; i++) {
      reserved.add(k(s.x + dx * i, s.y + dy * i, s.z));
      reserved.add(k(s.x + dx * i, s.y + dy * i, s.z + 1));
    }
  }
  const outdoorFloor = (x: number, y: number, z: number) => {
    const f = view.floor(x, y, z);
    return f === undefined || OPT.outdoorFloor(f);
  };
  for (const o of objs) {
    const at = `${o.contentId} (${o.x}, ${o.y}, z ${o.z})`;
    const room = view.room(o.x, o.y, o.z);
    if (reserved.has(k(o.x, o.y, o.z))) bad.push(`${at}: in a doorway or on stairs`);
    const [side, dx, dy] = SIDE[o.rot]!;
    const fx = o.x - dx;
    const fy = o.y - dy;
    const front = k(fx, fy, o.z);
    if (taken.has(front)) bad.push(`${at}: front blocked`);
    if (!view.open(o.x, o.y, o.z, OPP[side])) bad.push(`${at}: faces a wall`);
    if (!OK.has(o.contentId)) {
      if (room === 0) bad.push(`${at}: indoor object outside a room`);
      if (outdoorFloor(o.x, o.y, o.z)) bad.push(`${at}: indoor object on an outdoor floor`);
      if (view.room(fx, fy, o.z) !== room) bad.push(`${at}: faces another room`);
    } else if (room === 0) {
      const f = view.floor(o.x, o.y, o.z);
      if (!f || !OPT.propFloor(f)) bad.push(`${at}: prop on ${f}`);
    }
    // Back against a wall or window (not in the open), except free-standing shop shelves.
    const back = view.edge(o.x, o.y, o.z, side);
    if (back !== 'wall' && back !== 'window') {
      const roomType = view.rooms.get(room)?.roomType;
      if (!(o.contentId === 'base:metal-shelf' && roomType === 'base:room-shop'))
        bad.push(`${at}: back not against a wall (${back})`);
    }
  }
  // Free tiles of every room stay as connected as without furniture.
  const rooms = new Map<number, { z: number; tiles: [number, number][] }>();
  for (const z of view.levels) {
    for (const [x, y] of view.tiles(z)) {
      const r = view.room(x, y, z);
      if (!r) continue;
      if (!rooms.has(r)) rooms.set(r, { z, tiles: [] });
      rooms.get(r)!.tiles.push([x, y]);
    }
  }
  const indoor = (x: number, y: number, z: number, r: number) =>
    view.room(x, y, z) === r && !outdoorFloor(x, y, z);
  for (const [r, { z, tiles }] of rooms) {
    const before = components(view, tiles, z, r, new Set(), indoor);
    const after = components(view, tiles, z, r, taken, indoor);
    if (after > before) bad.push(`room ${r}: furniture splits it (${before} → ${after})`);
  }
  return bad;
}

describe('furnish: meble w środku, rekwizyty na dworze', () => {
  for (const type of CATALOG_IDS) {
    it(`${type}: 4 obroty × 3 seedy bez naruszeń`, { timeout: 30_000 }, () => {
      for (let rot = 0; rot < 4; rot++) {
        const bp = unit(type, rot);
        for (const seed of [1, 2, 3]) {
          const objs = furnish(bp, { ...OPT, seed });
          expect(violations(bp, objs), `${type} rot ${rot} seed ${seed}`).toEqual([]);
          // Builds with the objects (levels exist, tiles inside the map).
          buildMap({ ...bp, objects: objs.map((o) => ({ ...o })) });
        }
      }
    });
  }

  it('każdy dom ma łóżko w sypialni, lodówkę w kuchni i kosz przy drzwiach', () => {
    for (const type of ['house', 'kostka', 'house-garage']) {
      const bp = unit(type, 0);
      const objs = furnish(bp, OPT);
      const view = new MapView(buildMap(bp).chunks);
      const inType = (t: string, id: string) =>
        objs.some(
          (o) => o.contentId === id && view.rooms.get(view.room(o.x, o.y, o.z))?.roomType === t,
        );
      expect(inType('base:room-bedroom', 'base:bed'), type).toBe(true);
      expect(inType('base:room-kitchen', 'base:fridge'), type).toBe(true);
      expect(
        objs.some((o) => o.contentId === 'base:trash-bin'),
        type,
      ).toBe(true);
    }
  });

  it('sprawdzarka łapie szafę na trawie i mebel w drzwiach', () => {
    const bp = unit('house', 0);
    const objs = furnish(bp, OPT);
    const wardrobe = { contentId: 'base:wardrobe', x: 1, y: 1, z: 0, rot: 0 };
    expect(violations(bp, [...objs, wardrobe]).join('\n')).toContain('outside a room');
    const bin = objs.find((o) => o.contentId === 'base:trash-bin')!;
    const moved = objs.map((o) => (o === bin ? { ...o, contentId: 'base:dresser' } : o));
    expect(violations(bp, moved).join('\n')).toContain('indoor object outside a room');
  });

  it('jest deterministyczne, a seed zmienia układ', () => {
    const bp = unit('hospital', 1);
    expect(furnish(bp, OPT)).toEqual(furnish(bp, OPT));
    expect(furnish(bp, { ...OPT, seed: 9 })).not.toEqual(furnish(bp, OPT));
  });

  it('town-catalog: blueprint w repo = wygenerowany, bez naruszeń', () => {
    const fresh = townCatalogBlueprint();
    const file = JSON.parse(
      readFileSync(new URL('../blueprints/town-catalog.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(file).toEqual(JSON.parse(JSON.stringify(fresh)));
    const bp = parseBlueprint(fresh);
    expect(violations({ ...bp, objects: [] }, bp.objects)).toEqual([]);
    expect(bp.objects.length).toBeGreaterThan(200);
  });
});
