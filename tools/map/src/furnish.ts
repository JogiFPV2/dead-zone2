import { CHUNK_SIZE, MapChunkSchema, STAIR_STEP, type MapChunk } from '@deadzone/content';
import type { Blueprint } from './blueprint.js';
import { buildMap } from './build.js';

/**
 * Furnishing (spec: „meble wewnątrz, na dworze tylko rekwizyty”): fills the rooms of a blueprint
 * with furniture from a kit per room type, and puts a few outdoor props (bins, dumpsters,
 * firewood, benches) by the buildings. Deterministic for (blueprint, seed).
 *
 * Rules (also checked by `furnish.test.ts`; the content validator checks the indoor rule on every
 * map):
 * - furniture stands only on room tiles (room ≠ 0) whose floor is not outdoor,
 * - with its back against a wall (tall items: a solid wall, low ones may stand under a window),
 *   facing a free tile of the same room (`rot`: 0 = back to the north wall, 1 = east, 2 = south,
 *   3 = west — the client turns the model by −rot·90°),
 * - never on a door tile (both sides of every door stay free) or on stairs, their foot or landing,
 * - free tiles of each room stay as connected as they were (nothing walls off a corner),
 * - outdoor props only on `propFloor` tiles outside rooms, against an outer wall, never in front
 *   of a door.
 */
export interface FurnishOptions {
  seed?: number;
  /** Outdoor floor tile (tag `base:outdoor`): no furniture there. */
  outdoorFloor: (tileId: string) => boolean;
  /** Floors where outdoor props may stand (e.g. grass, sidewalk; not the road). */
  propFloor: (tileId: string) => boolean;
  /** Street floors (sidewalk, road): only bins, dumpsters and benches may stand there. */
  streetFloor?: (tileId: string) => boolean;
}

export interface PlacedObject {
  contentId: string;
  x: number;
  y: number;
  z: number;
  rot: number;
}

interface KitItem {
  id: string;
  /** Needs a solid wall behind (not a window). */
  tall?: boolean;
  /** One per this many room tiles (count = clamp(round(area / per), min, max)). */
  per?: number;
  min?: number;
  max?: number;
  /** Free-standing in the middle of the room (shop shelves), aisles on both sides. */
  middle?: boolean;
}

const K = (id: string, min = 1, max = min, per = 0, extra: Partial<KitItem> = {}): KitItem => ({
  id,
  min,
  max,
  per,
  ...extra,
});
const TALL = { tall: true };

/** Furniture kit per room type, in placement order (first items get the best spots). */
export const ROOM_KITS: Record<string, KitItem[]> = {
  'base:room-kitchen': [
    K('base:fridge', 1, 1, 0, TALL),
    K('base:kitchen-counter', 1, 3, 5),
    K('base:kitchen-cabinet', 1, 3, 6),
    K('base:freezer', 0, 1, 14),
  ],
  'base:room-bedroom': [
    K('base:bed', 1, 2, 12),
    K('base:wardrobe', 1, 1, 0, TALL),
    K('base:dresser', 1, 1),
  ],
  'base:room-living-room': [
    K('base:sofa', 1, 2, 14),
    K('base:bookshelf', 1, 2, 16, TALL),
    K('base:dresser', 0, 1, 18),
  ],
  'base:room-bathroom': [K('base:kitchen-cabinet', 1, 1)],
  'base:room-hospital': [
    K('base:bed', 0, 3, 12),
    K('base:locker', 0, 2, 20, TALL),
    K('base:metal-shelf', 0, 2, 20, TALL),
    K('base:dresser', 0, 1, 20),
  ],
  'base:room-pharmacy': [
    K('base:metal-shelf', 2, 6, 5, TALL),
    K('base:kitchen-counter', 1, 1),
    K('base:locker', 0, 1, 20, TALL),
  ],
  'base:room-shop': [
    K('base:metal-shelf', 2, 6, 7, TALL),
    K('base:metal-shelf', 0, 4, 14, { tall: true, middle: true }),
    K('base:fridge', 1, 3, 20, TALL),
    K('base:freezer', 0, 2, 30),
    K('base:kitchen-counter', 1, 1),
  ],
  'base:room-gas-station': [
    K('base:metal-shelf', 1, 3, 8, TALL),
    K('base:fridge', 1, 1, 0, TALL),
    K('base:kitchen-counter', 1, 1),
  ],
  'base:room-warehouse': [K('base:metal-shelf', 1, 4, 8, TALL), K('base:crate', 1, 4, 10)],
  'base:room-garage': [
    K('base:tool-chest', 1, 1),
    K('base:metal-shelf', 1, 2, 16, TALL),
    K('base:crate', 0, 1, 16),
  ],
  'base:room-police': [
    K('base:locker', 1, 3, 10, TALL),
    K('base:dresser', 0, 1, 16),
    K('base:gun-locker', 0, 1, 24, TALL),
  ],
  'base:room-school': [K('base:locker', 1, 3, 14, TALL), K('base:bookshelf', 0, 1, 24, TALL)],
  'base:room-gym': [K('base:locker', 1, 4, 14, TALL), K('base:bench', 1, 3, 30)],
  'base:room-office': [K('base:bookshelf', 1, 2, 12, TALL), K('base:dresser', 0, 1, 14)],
  'base:room-ruin': [K('base:crate', 0, 1, 10)],
};

/** Room types whose building gets a dumpster by an outer wall; benches by the main door. */
const DUMPSTER = new Set([
  'base:room-shop',
  'base:room-hospital',
  'base:room-pharmacy',
  'base:room-gas-station',
  'base:room-school',
]);
const BENCH = new Set([
  'base:room-hospital',
  'base:room-school',
  'base:room-police',
  'base:room-gym',
]);
const HOME = new Set(['base:room-bedroom', 'base:room-living-room']);

type Side = 'n' | 'e' | 's' | 'w';
const SIDES: { s: Side; dx: number; dy: number; rot: number }[] = [
  { s: 'n', dx: 0, dy: -1, rot: 0 },
  { s: 'e', dx: 1, dy: 0, rot: 1 },
  { s: 's', dx: 0, dy: 1, rot: 2 },
  { s: 'w', dx: -1, dy: 0, rot: 3 },
];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * What the furnishing rules read: floors, rooms, edges and stairs in world tiles. `MapView` (a
 * built blueprint) and the lazy world generator's per-building view (`world-source/`) implement
 * it, so both furnish with exactly the same rules.
 */
export interface FurnishView {
  readonly rooms: ReadonlyMap<number, { roomType: string; buildingId: number }>;
  readonly levels: ReadonlySet<number>;
  readonly stairs: readonly {
    x: number;
    y: number;
    z: number;
    dir: 'N' | 'E' | 'S' | 'W';
    len: number;
  }[];
  floor(x: number, y: number, z: number): string | undefined;
  room(x: number, y: number, z: number): number;
  edge(x: number, y: number, z: number, s: Side): string | undefined;
  open(x: number, y: number, z: number, s: Side): boolean;
  tiles(z: number): Iterable<[number, number]>;
}

/** Decoded chunks of a built map, looked up in world tiles. */
export class MapView implements FurnishView {
  private readonly chunks = new Map<string, MapChunk>();
  private readonly edges = new Map<string, string>();
  readonly rooms = new Map<number, { roomType: string; buildingId: number }>();
  readonly levels = new Set<number>();
  readonly stairs: { x: number; y: number; z: number; dir: 'N' | 'E' | 'S' | 'W'; len: number }[] =
    [];

  constructor(chunks: readonly { json: unknown }[]) {
    for (const { json } of chunks) {
      const c = MapChunkSchema.parse(json);
      const { cx, cy, z } = c.address;
      this.levels.add(z);
      this.chunks.set(key(cx, cy, z), c);
      const ox = cx * CHUNK_SIZE;
      const oy = cy * CHUNK_SIZE;
      for (const e of c.edges) this.edges.set(`${key(ox + e.x, oy + e.y, z)},${e.side}`, e.type);
      for (const [id, r] of Object.entries(c.rooms)) this.rooms.set(Number(id), r);
      for (const s of c.stairs ?? [])
        this.stairs.push({ x: ox + s.tx, y: oy + s.ty, z, dir: s.dir, len: s.len });
    }
  }

  private cell(x: number, y: number, z: number): [MapChunk, number] | undefined {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const c = this.chunks.get(key(cx, cy, z));
    return c ? [c, (y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)] : undefined;
  }

  /** Floor tile id, or undefined (no floor / outside the map). */
  floor(x: number, y: number, z: number): string | undefined {
    const c = this.cell(x, y, z);
    const v = c ? (c[0].layers.floor[c[1]] ?? 0) : 0;
    return v === 0 ? undefined : c![0].palette[v - 1];
  }

  room(x: number, y: number, z: number): number {
    const c = this.cell(x, y, z);
    return c ? (c[0].layers.room?.[c[1]] ?? 0) : 0;
  }

  /** Edge type on side `s` of tile (x, y) (wall, window, door, fence) or undefined. */
  edge(x: number, y: number, z: number, s: Side): string | undefined {
    if (s === 's') return this.edges.get(`${key(x, y + 1, z)},n`);
    if (s === 'e') return this.edges.get(`${key(x + 1, y, z)},w`);
    return this.edges.get(`${key(x, y, z)},${s}`);
  }

  /** Walkable step between neighbours (no wall / window / fence in between; doors pass). */
  open(x: number, y: number, z: number, s: Side): boolean {
    const e = this.edge(x, y, z, s);
    return e === undefined || e === 'door';
  }

  /** Every [x, y] tile on level z that has floor or room (scan over loaded chunks). */
  *tiles(z: number): Generator<[number, number]> {
    for (const c of this.chunks.values()) {
      if (c.address.z !== z) continue;
      const ox = c.address.cx * CHUNK_SIZE;
      const oy = c.address.cy * CHUNK_SIZE;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++)
        yield [ox + (i % CHUNK_SIZE), oy + Math.floor(i / CHUNK_SIZE)];
    }
  }
}

/** mulberry32 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Furniture and outdoor props for `bp` (its own `objects` stay and are avoided). */
export function furnish(bp: Blueprint, opt: FurnishOptions): PlacedObject[] {
  return furnishView(
    new MapView(buildMap(bp).chunks),
    bp.objects.map((o) => key(o.x, o.y, o.z)),
    opt,
  );
}

/**
 * Furniture and outdoor props over any `FurnishView`; `occupied` = `x,y,z` keys of objects already
 * there (avoided). Deterministic for (view, occupied, seed).
 */
export function furnishView(
  view: FurnishView,
  occupied: Iterable<string>,
  opt: FurnishOptions,
): PlacedObject[] {
  const seed = opt.seed ?? 1;
  const taken = new Set<string>(occupied);
  const keepFree = reservedTiles(view);
  const out: PlacedObject[] = [];
  const rotAt = new Map<string, number>();
  const put = (o: PlacedObject) => {
    out.push(o);
    taken.add(key(o.x, o.y, o.z));
    rotAt.set(key(o.x, o.y, o.z), o.rot);
  };

  // --- rooms ---------------------------------------------------------------------------------
  const roomTiles = new Map<number, { z: number; tiles: [number, number][] }>();
  for (const z of [...view.levels].sort((a, b) => a - b)) {
    for (const [x, y] of view.tiles(z)) {
      const r = view.room(x, y, z);
      if (r === 0) continue;
      let e = roomTiles.get(r);
      if (!e) roomTiles.set(r, (e = { z, tiles: [] }));
      e.tiles.push([x, y]);
    }
  }
  const indoor = (x: number, y: number, z: number, room: number) => {
    const f = view.floor(x, y, z);
    return f !== undefined && !opt.outdoorFloor(f) && view.room(x, y, z) === room;
  };

  for (const [roomId, { z, tiles }] of [...roomTiles].sort((a, b) => a[0] - b[0])) {
    const meta = view.rooms.get(roomId);
    const kit = meta ? ROOM_KITS[meta.roomType] : undefined;
    if (!kit) continue;
    const rand = rng(seed * 7919 + roomId * 104729);
    const area = tiles.filter(([x, y]) => indoor(x, y, z, roomId)).length;
    if (area === 0) continue;
    const free = (x: number, y: number) =>
      indoor(x, y, z, roomId) && !taken.has(key(x, y, z)) && !keepFree.has(key(x, y, z));
    const fronts = new Set<string>();
    const comps0 = components(view, tiles, z, roomId, taken, indoor);

    for (const item of kit) {
      const want = Math.max(
        item.min ?? 1,
        Math.min(item.max ?? 1, item.per ? Math.round(area / item.per) : (item.min ?? 1)),
      );
      for (let n = 0; n < want; n++) {
        const cands: { x: number; y: number; rot: number; score: number }[] = [];
        for (const [x, y] of tiles) {
          if (!free(x, y) || fronts.has(key(x, y, z))) continue;
          for (const sd of SIDES) {
            const fx = x - sd.dx;
            const fy = y - sd.dy;
            if (!free(fx, fy) || !view.open(x, y, z, opposite(sd.s))) continue;
            const e = view.edge(x, y, z, sd.s);
            if (item.middle) {
              // Free-standing: no edge around, aisles in front and behind.
              if (SIDES.some((q) => view.edge(x, y, z, q.s) !== undefined)) continue;
              if (!free(x + sd.dx, y + sd.dy)) continue;
              if (SIDES.some((q) => !indoor(x + q.dx, y + q.dy, z, roomId))) continue;
            } else if (!(e === 'wall' || (!item.tall && e === 'window'))) continue;
            // Cluster along the same wall (kitchen rows, shelf rows), otherwise random.
            let score = rand();
            for (const q of SIDES) {
              if (rotAt.get(key(x + q.dx, y + q.dy, z)) === sd.rot) score += 0.6;
            }
            cands.push({ x, y, rot: sd.rot, score });
          }
        }
        cands.sort((a, b) => b.score - a.score);
        for (const c of cands) {
          taken.add(key(c.x, c.y, z));
          const sd = SIDES[c.rot]!;
          const ok = components(view, tiles, z, roomId, taken, indoor) <= comps0;
          taken.delete(key(c.x, c.y, z));
          if (!ok) continue;
          put({ contentId: item.id, x: c.x, y: c.y, z, rot: c.rot });
          fronts.add(key(c.x - sd.dx, c.y - sd.dy, z));
          if (item.middle) fronts.add(key(c.x + sd.dx, c.y + sd.dy, z));
          break;
        }
      }
    }
  }

  // --- outdoor props ---------------------------------------------------------------------------
  const buildings = new Map<number, Set<string>>();
  for (const r of view.rooms.values()) {
    let s = buildings.get(r.buildingId);
    if (!s) buildings.set(r.buildingId, (s = new Set()));
    s.add(r.roomType);
  }
  /** Outside ground tiles against an outer wall of building b: [x, y, rot]. */
  const wallside = (b: number): [number, number, number][] => {
    const res: [number, number, number][] = [];
    for (const [x, y] of view.tiles(0)) {
      const f = view.floor(x, y, 0);
      if (view.room(x, y, 0) !== 0 || !f || !opt.propFloor(f)) continue;
      if (taken.has(key(x, y, 0)) || keepFree.has(key(x, y, 0))) continue;
      for (const sd of SIDES) {
        const r = view.room(x + sd.dx, y + sd.dy, 0);
        if (r === 0 || view.rooms.get(r)?.buildingId !== b) continue;
        const e = view.edge(x, y, 0, sd.s);
        if (e !== 'wall' && e !== 'window') continue;
        // Needs a free outside tile in front (not boxed in by a fence or another building).
        const fx = x - sd.dx;
        const fy = y - sd.dy;
        if (view.room(fx, fy, 0) !== 0 || !view.floor(fx, fy, 0)) continue;
        if (!view.open(x, y, 0, opposite(sd.s))) continue;
        res.push([x, y, sd.rot]);
        break;
      }
    }
    return res;
  };
  const doorsOf = (b: number): [number, number][] => {
    const res: [number, number][] = [];
    for (const [x, y] of view.tiles(0)) {
      if (view.room(x, y, 0) !== 0) continue;
      for (const sd of SIDES) {
        const r = view.room(x + sd.dx, y + sd.dy, 0);
        if (r !== 0 && view.rooms.get(r)?.buildingId === b && view.edge(x, y, 0, sd.s) === 'door')
          res.push([x, y]);
      }
    }
    return res;
  };
  for (const [b, types] of [...buildings].sort((p, q) => p[0] - q[0])) {
    const rand = rng(seed * 31337 + b * 7907);
    const doors = doorsOf(b);
    if (doors.length === 0) continue;
    const main = doors[0]!;
    const near = (x: number, y: number) => Math.abs(x - main[0]) + Math.abs(y - main[1]);
    const sideTiles = wallside(b);
    const pick = (score: (x: number, y: number) => number, id: string) => {
      const street = !STREET_PROPS.has(id) && opt.streetFloor;
      const c = sideTiles
        .filter(([x, y]) => !taken.has(key(x, y, 0)))
        .filter(([x, y]) => !street || !street(view.floor(x, y, 0) ?? ''))
        .map(([x, y, rot]) => ({ x, y, rot, s: score(x, y) + rand() * 0.5 }))
        .filter((c) => Number.isFinite(c.s))
        .sort((p, q) => q.s - p.s)[0];
      if (c) put({ contentId: id, x: c.x, y: c.y, z: 0, rot: c.rot });
    };
    const any = (set: ReadonlySet<string>) => [...types].some((t) => set.has(t));
    // Bin right by the main door (1–2 tiles aside).
    pick((x, y) => (near(x, y) <= 2 ? 3 - near(x, y) : -Infinity), 'base:trash-bin');
    if (any(DUMPSTER)) pick((x, y) => near(x, y), 'base:dumpster');
    if (any(BENCH)) {
      pick(
        (x, y) => (near(x, y) >= 2 && near(x, y) <= 4 ? 4 - near(x, y) : -Infinity),
        'base:bench',
      );
    }
    if (any(HOME) || types.has('base:room-garage')) {
      if (rand() < 0.75)
        pick(
          (x, y) => (near(x, y) >= 4 ? Math.min(near(x, y), 8) : -Infinity),
          'base:firewood-pile',
        );
    }
  }
  return out.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

/** Props that may stand on a sidewalk (street furniture). */
const STREET_PROPS: ReadonlySet<string> = new Set([
  'base:trash-bin',
  'base:dumpster',
  'base:bench',
]);

const opposite = (s: Side): Side => ({ n: 's', s: 'n', e: 'w', w: 'e' })[s] as Side;

/** Door tiles (both sides), stair runs, their foot and their landing: never furnished. */
function reservedTiles(view: FurnishView): Set<string> {
  const res = new Set<string>();
  for (const z of view.levels) {
    for (const [x, y] of view.tiles(z)) {
      for (const sd of SIDES) {
        if (view.edge(x, y, z, sd.s) !== 'door') continue;
        res.add(key(x, y, z));
        res.add(key(x + sd.dx, y + sd.dy, z));
      }
    }
  }
  for (const s of view.stairs) {
    const [dx, dy] = STAIR_STEP[s.dir];
    res.add(key(s.x - dx, s.y - dy, s.z));
    for (let k = 0; k < s.len; k++) {
      res.add(key(s.x + dx * k, s.y + dy * k, s.z));
      res.add(key(s.x + dx * k, s.y + dy * k, s.z + 1));
    }
    res.add(key(s.x + dx * s.len, s.y + dy * s.len, s.z + 1));
    // Landing neighbours on the upper floor (U-stairs turn there).
    for (const [qx, qy] of [
      [dy, dx],
      [-dy, -dx],
    ] as const)
      res.add(key(s.x + dx * (s.len - 1) + qx, s.y + dy * (s.len - 1) + qy, s.z + 1));
  }
  return res;
}

/** Connected components of the free (not taken) indoor tiles of a room. */
export function components(
  view: FurnishView,
  tiles: readonly [number, number][],
  z: number,
  room: number,
  taken: ReadonlySet<string>,
  indoor: (x: number, y: number, z: number, room: number) => boolean,
): number {
  const seen = new Set<string>();
  let n = 0;
  for (const [sx, sy] of tiles) {
    const k0 = key(sx, sy, z);
    if (seen.has(k0) || taken.has(k0) || !indoor(sx, sy, z, room)) continue;
    n++;
    const queue: [number, number][] = [[sx, sy]];
    seen.add(k0);
    while (queue.length > 0) {
      const [x, y] = queue.pop()!;
      for (const sd of SIDES) {
        const nx = x + sd.dx;
        const ny = y + sd.dy;
        const k = key(nx, ny, z);
        if (seen.has(k) || taken.has(k) || !indoor(nx, ny, z, room)) continue;
        if (!view.open(x, y, z, sd.s)) continue;
        seen.add(k);
        queue.push([nx, ny]);
      }
    }
  }
  return n;
}
