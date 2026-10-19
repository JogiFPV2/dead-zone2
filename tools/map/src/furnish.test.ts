import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STAIR_STEP } from '@deadzone/content';
import { describe, expect, it } from 'vitest';
import { parseBlueprint, type Blueprint } from './blueprint.js';
import { buildMap } from './build.js';
import { CATALOG, CATALOG_IDS, placeCatalog } from './catalog.js';
import { BASE_PACK_DIR as BASE_PACK_DIR, buildContentBundleFromDirs } from '@deadzone/content/node';
import { footprintForId, occupiedTiles } from '@deadzone/content/footprint';
import { footprintIssues } from './footprint-check.js';
import {
  BASE_FOOTPRINTS,
  LIGHT_SWITCH,
  MapView,
  OVERLAY_OBJECTS,
  POWERED_LAMPS,
  ROOM_KITS,
  baseFootprint,
  components,
  furnish,
  type PlacedObject,
} from './furnish.js';
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

/** `placeIn` of every container / item in the base pack (undefined = no restriction). */
function placeIns(): Map<string, readonly string[] | undefined> {
  const out = new Map<string, readonly string[] | undefined>();
  for (const dir of ['containers', 'items']) {
    const d = join(BASE_PACK_DIR, dir);
    for (const f of readdirSync(d).filter((n) => n.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(d, f), 'utf8')) as unknown;
      const list = (Array.isArray(raw) ? raw : [raw]) as { id: string; placeIn?: string[] }[];
      for (const t of list) out.set(t.id, t.placeIn);
    }
  }
  return out;
}

interface Chain {
  id: string;
  then?: Chain;
  seats?: { id: string };
  top?: string;
}
/** Ids a kit item brings along: its `then` chain, its chairs and what stands on it. */
const thenIds = (k: Chain): string[] => [
  ...(k.then ? [k.then.id, ...thenIds(k.then)] : []),
  ...(k.seats ? [k.seats.id] : []),
  ...(k.top ? [k.top] : []),
];

describe('room kits (content data)', () => {
  it('use only existing furniture, each within its placeIn', () => {
    const place = placeIns();
    const bad: string[] = [];
    for (const [room, kit] of Object.entries(ROOM_KITS))
      for (const k of kit)
        for (const id of [...(k.alt ?? [k.id]), ...thenIds(k)]) {
          if (!place.has(id)) bad.push(`${room}: ${id} missing`);
          const p = place.get(id);
          if (p && !p.includes(room)) bad.push(`${room}: ${id} not in placeIn ${p.join(',')}`);
        }
    expect(bad).toEqual([]);
  });

  it('furnish homes like PZ: kitchen, bedroom, living room, bathroom sets', () => {
    const ids = (room: string) =>
      new Set(ROOM_KITS[room]!.flatMap((k) => [...(k.alt ?? [k.id]), ...thenIds(k)]));
    expect([...ids('base:room-kitchen')]).toEqual(
      expect.arrayContaining([
        'base:fridge-freezer',
        'base:range',
        'base:kitchen-sink',
        'base:kitchen-cabinet',
      ]),
    );
    expect([...ids('base:room-bedroom')]).toEqual(
      expect.arrayContaining(['base:bed', 'base:wardrobe', 'base:dresser', 'base:desk']),
    );
    expect([...ids('base:room-living-room')]).toEqual(
      expect.arrayContaining([
        'base:sofa',
        'base:tv',
        'base:tv-stand',
        'base:vcr',
        'base:radio-set',
        'base:bookshelf',
      ]),
    );
    expect([...ids('base:room-bathroom')]).toEqual(
      expect.arrayContaining([
        'base:bathroom-cabinet',
        'base:bathroom-sink',
        'base:bathtub',
        'base:shower',
        'base:toilet',
      ]),
    );
    for (const shop of ['base:room-shop', 'base:room-pharmacy', 'base:room-gas-station'])
      expect([...ids(shop)]).toContain('base:shop-counter');
  });
});

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
function violations(bp: Blueprint, all: readonly PlacedObject[]): string[] {
  const bad: string[] = [];
  const view = new MapView(buildMap({ ...bp, objects: [] }).chunks);
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  // Overlays (ceiling lamp, desk lamp on its desk) take no tile: checked apart below.
  const tops = all.filter((o) => OVERLAY_OBJECTS.has(o.contentId));
  const objs = all.filter((o) => !OVERLAY_OBJECTS.has(o.contentId));
  const taken = new Set(
    objs.flatMap((o) =>
      occupiedTiles(o.x, o.y, o.rot, baseFootprint(o.contentId)).map((t) => k(t.x, t.y, o.z)),
    ),
  );
  for (const i of footprintIssues(view, all, baseFootprint))
    bad.push(`${i.at}: ${i.kind === 'room' ? 'footprint leaves its room' : i.kind}`);
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
  const idAt = new Map<string, string>();
  for (const o of objs)
    for (const t of occupiedTiles(o.x, o.y, o.rot, baseFootprint(o.contentId)))
      idAt.set(k(t.x, t.y, o.z), o.contentId);
  for (const o of objs) {
    const at = `${o.contentId} (${o.x}, ${o.y}, z ${o.z})`;
    const room = view.room(o.x, o.y, o.z);
    if (o.contentId === 'base:chair') {
      // A chair stands at a desk or a table (front tile or an end of a table), facing it.
      const [, cdx, cdy] = SIDE[o.rot]!;
      const at2 = idAt.get(k(o.x - cdx, o.y - cdy, o.z));
      if (at2 !== 'base:desk' && at2 !== 'base:table') bad.push(`${at}: chair not at a desk`);
      if (reserved.has(k(o.x, o.y, o.z))) bad.push(`${at}: in a doorway or on stairs`);
      continue;
    }
    const [side, dx, dy] = SIDE[o.rot]!;
    const tiles = occupiedTiles(o.x, o.y, o.rot, baseFootprint(o.contentId));
    const own = new Set(tiles.map((t) => k(t.x, t.y, o.z)));
    for (const t of tiles) {
      if (reserved.has(k(t.x, t.y, o.z))) bad.push(`${at}: in a doorway or on stairs`);
      if (!OK.has(o.contentId) && outdoorFloor(t.x, t.y, o.z))
        bad.push(`${at}: indoor object on an outdoor floor`);
      // Back row: the side `side` leaves the footprint; front row: the opposite side does.
      if (!own.has(k(t.x + dx, t.y + dy, o.z))) {
        const back = view.edge(t.x, t.y, o.z, side);
        if (back !== 'wall' && back !== 'window') {
          const roomType = view.rooms.get(room)?.roomType;
          if (!(o.contentId === 'base:metal-shelf' && roomType === 'base:room-shop'))
            bad.push(`${at}: back not against a wall (${back})`);
        }
      }
      if (!own.has(k(t.x - dx, t.y - dy, o.z))) {
        const fx = t.x - dx;
        const fy = t.y - dy;
        const blocker = idAt.get(k(fx, fy, o.z));
        if (blocker !== undefined && blocker !== 'base:chair') bad.push(`${at}: front blocked`);
        if (!view.open(t.x, t.y, o.z, OPP[side])) bad.push(`${at}: faces a wall`);
        if (!OK.has(o.contentId) && view.room(fx, fy, o.z) !== room)
          bad.push(`${at}: faces another room`);
      }
    }
    if (!OK.has(o.contentId)) {
      if (room === 0) bad.push(`${at}: indoor object outside a room`);
    } else if (room === 0) {
      const f = view.floor(o.x, o.y, o.z);
      if (!f || !OPT.propFloor(f)) bad.push(`${at}: prop on ${f}`);
    }
  }
  // A desk lamp stands on a desk (or a school table), a ceiling lamp hangs inside a room, a
  // switch is on a wall of its room.
  for (const o of tops) {
    const at = `${o.contentId} (${o.x}, ${o.y}, z ${o.z})`;
    const under = idAt.get(k(o.x, o.y, o.z));
    if (o.contentId === 'base:desk-lamp' && under !== 'base:desk' && under !== 'base:table')
      bad.push(`${at}: desk lamp not on a desk (${under})`);
    if (view.room(o.x, o.y, o.z) === 0) bad.push(`${at}: outside a room`);
    if (
      o.contentId === 'base:light-switch' &&
      view.edge(o.x, o.y, o.z, SIDE[o.rot]![0]) === undefined
    )
      bad.push(`${at}: switch not on a wall`);
    if (reserved.has(k(o.x, o.y, o.z))) bad.push(`${at}: in a doorway or on stairs`);
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
  it('BASE_FOOTPRINTS = footprint paczki base (wszystko większe niż 1×1)', async () => {
    const bundle = await buildContentBundleFromDirs([BASE_PACK_DIR]);
    const big: Record<string, { w: number; h: number }> = {};
    for (const id of [...Object.keys(bundle.containers), ...Object.keys(bundle.items)]) {
      const fp = footprintForId(bundle, id);
      if (fp.w * fp.h > 1) big[id] = fp;
    }
    expect(BASE_FOOTPRINTS).toEqual(big);
  });

  it('meble 2×1 i 1×2 stoją w pokoju plecami do ściany, przy każdym obrocie', () => {
    const seen = new Map<string, Set<number>>();
    for (const type of ['house', 'kostka', 'shop', 'hospital']) {
      if (!CATALOG[type]) continue;
      for (let rot = 0; rot < 4; rot++) {
        for (const o of furnish(unit(type, rot), OPT)) {
          const fp = baseFootprint(o.contentId);
          if (fp.w * fp.h === 1) continue;
          if (!seen.has(o.contentId)) seen.set(o.contentId, new Set());
          seen.get(o.contentId)!.add(o.rot);
        }
      }
    }
    expect(seen.has('base:bed')).toBe(true);
    expect(seen.has('base:sofa')).toBe(true);
    expect(seen.get('base:bed')!.size).toBeGreaterThan(1);
  });

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

  it('każdy dom ma łóżko w sypialni, lodówkę i zlew w kuchni i kosz przy drzwiach', () => {
    for (const type of ['house', 'kostka', 'house-garage']) {
      const bp = unit(type, 0);
      const objs = furnish(bp, OPT);
      const view = new MapView(buildMap(bp).chunks);
      const inType = (t: string, id: string) =>
        objs.some(
          (o) => o.contentId === id && view.rooms.get(view.room(o.x, o.y, o.z))?.roomType === t,
        );
      expect(inType('base:room-bedroom', 'base:bed'), type).toBe(true);
      expect(inType('base:room-kitchen', 'base:fridge-freezer'), type).toBe(true);
      expect(inType('base:room-kitchen', 'base:kitchen-sink'), type).toBe(true);
      expect(
        objs.some((o) => o.contentId === 'base:trash-bin'),
        type,
      ).toBe(true);
    }
  });

  it('stół w kuchni z krzesłem, lampy w domu, włącznik w każdym pokoju z lampą (#254)', () => {
    let tables = 0;
    let deskLamps = 0;
    const lampTypes = new Set<string>();
    for (const type of CATALOG_IDS)
      for (const seed of [1, 2, 3]) {
        const bp = unit(type, seed % 4);
        const objs = furnish(bp, { ...OPT, seed });
        const view = new MapView(buildMap(bp).chunks);
        const typeOf = (o: PlacedObject) => view.rooms.get(view.room(o.x, o.y, o.z))?.roomType;
        const chairs = objs.filter((o) => o.contentId === 'base:chair');
        for (const t of objs.filter((o) => o.contentId === 'base:table')) {
          const cells = occupiedTiles(t.x, t.y, t.rot, baseFootprint(t.contentId));
          const seated = chairs.some((c) => {
            const [, dx, dy] = SIDE[c.rot]!;
            return c.z === t.z && cells.some((q) => q.x === c.x - dx && q.y === c.y - dy);
          });
          if (typeOf(t) === 'base:room-kitchen') {
            tables++;
            expect(seated, `${type} seed ${seed}: stół w kuchni bez krzesła`).toBe(true);
          }
        }
        const switched = new Set(
          objs.filter((o) => o.contentId === LIGHT_SWITCH).map((o) => view.room(o.x, o.y, o.z)),
        );
        for (const l of objs.filter((o) => POWERED_LAMPS.has(o.contentId))) {
          lampTypes.add(`${l.contentId} ${typeOf(l)}`);
          if (l.contentId === 'base:desk-lamp') deskLamps++;
          expect(
            switched.has(view.room(l.x, l.y, l.z)),
            `${type} seed ${seed}: ${l.contentId} (${l.x}, ${l.y}) bez włącznika`,
          ).toBe(true);
        }
      }
    expect(tables).toBeGreaterThan(0);
    expect(deskLamps).toBeGreaterThan(0);
    expect([...lampTypes]).toEqual(
      expect.arrayContaining([
        'base:ceiling-lamp base:room-kitchen',
        'base:ceiling-lamp base:room-bathroom',
        'base:ceiling-lamp base:room-living-room',
        'base:floor-lamp base:room-living-room',
        'base:floor-lamp base:room-bedroom',
      ]),
    );
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
