import { CHUNK_SIZE, MapChunkSchema, STAIR_STEP, type MapChunk } from '@deadzone/content';
import { DEFAULT_FOOTPRINT, occupiedTiles, type Footprint } from '@deadzone/content/footprint';
import type { Blueprint } from './blueprint.js';
import { buildMap } from './build.js';

/**
 * Furnishing (spec: „meble wewnątrz, na dworze tylko rekwizyty”): fills the rooms of a blueprint
 * with furniture from a kit per room type, and puts a few outdoor props (bins, dumpsters,
 * firewood, benches) by the buildings. Deterministic for (blueprint, seed).
 *
 * Rules (also checked by `furnish.test.ts`; the content validator checks the indoor rule on every
 * map):
 * - furniture covers its whole footprint (`@deadzone/content/footprint`: `w` along the wall, `h`
 *   into the room, anchor = NW tile) and every covered tile is a room tile (room ≠ 0, same room)
 *   whose floor is not outdoor; no two objects share a tile,
 * - with its back against a wall (every back tile) (tall items: a solid wall, low ones may stand under a window),
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
  /** Footprint per content id at rot 0 (default: `BASE_FOOTPRINTS`, otherwise 1×1). */
  footprint?: (contentId: string) => Footprint;
}

/**
 * Footprints of the base pack furniture bigger than 1×1 (the content's `footprint` /
 * `placeable.footprint`; `furnish.test.ts` checks this table against the bundle). Kept here so
 * the lazy world generator (a game worker) needs no content bundle.
 */
export const BASE_FOOTPRINTS: Readonly<Record<string, Footprint>> = {
  'base:bathtub': { w: 2, h: 1 },
  'base:bed': { w: 1, h: 2 },
  'base:desk': { w: 2, h: 1 },
  'base:double-bed': { w: 2, h: 2 },
  'base:table': { w: 2, h: 1 },
  'base:metal-shelf': { w: 2, h: 1 },
  'base:shop-counter': { w: 2, h: 1 },
  'base:sofa': { w: 2, h: 1 },
};

/** Base pack footprint of `contentId` (1×1 when not in `BASE_FOOTPRINTS`). */
export function baseFootprint(contentId: string): Footprint {
  return BASE_FOOTPRINTS[contentId] ?? DEFAULT_FOOTPRINT;
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
  /** Seeded pick of the id per room (e.g. bathtub or shower); `id` is the default. */
  alt?: readonly string[];
  /** Prefer a spot touching one of these (VCR and radio by the TV). */
  near?: readonly string[];
  /** Only spots touching one of `near` (a TV on its stand's side, a VCR by the TV). */
  mustTouch?: boolean;
  /** Placed right after this one; when it finds no spot, this one moves or is left out. */
  then?: KitItem;
  /** As a `then`: on a front tile of the piece before, facing it (a chair at the desk). */
  atFront?: boolean;
  /**
   * Chairs around this piece (a table): on its free front tiles first, then at its two ends,
   * each facing it; count = clamp(round(area / per), min, max). Fewer than `min` fit: the piece
   * moves to its next spot (or is left out).
   */
  seats?: { id: string; min: number; max: number; per: number };
  /**
   * Stand on top of this piece once it is placed, on its anchor tile, in this order (a desk
   * lamp on the desk; a VCR, then the TV on it, on the TV stand). No tile of their own.
   */
  top?: string | readonly string[];
  /**
   * An `ON_SURFACE` item (#267): on the anchor tile of a piece of these types already in the
   * room with nothing on it yet (first type first); none free: `stand` is placed for it (left
   * out when that does not fit either).
   */
  onto?: { ids: readonly string[]; stand?: string };
  /** Prefers a free corner (walls or windows on two sides, no door): a floor lamp. */
  corner?: boolean;
}

const K = (id: string, min = 1, max = min, per = 0, extra: Partial<KitItem> = {}): KitItem => ({
  id,
  min,
  max,
  per,
  ...extra,
});
const TALL = { tall: true };
const CHAIR = 'base:chair';
/**
 * Seats that never stand right next to one of the same type (8-neighbourhood, a free tile
 * between): sofas, armchairs, benches. Chairs are left out: they sit side by side at a table.
 */
export const SPACED_SEATS: ReadonlySet<string> = new Set([
  'base:sofa',
  'base:armchair',
  'base:bench',
]);
const FLOOR_LAMP_ID = 'base:floor-lamp';

/**
 * Lamps (#254): a ceiling lamp in the middle of every home room (no tile of its own, it hangs).
 * Floor lamps (a corner of living rooms and bedrooms) and desk lamps (`top` of a desk) are in
 * the kits. Every room with a lamp gets a light switch by its door (`lightSwitches`).
 */
export const CEILING_LAMP_ROOMS: ReadonlySet<string> = new Set([
  'base:room-kitchen',
  'base:room-bathroom',
  'base:room-bedroom',
  'base:room-living-room',
]);
export const CEILING_LAMP = 'base:ceiling-lamp';
export const FLOOR_LAMP = FLOOR_LAMP_ID;
export const DESK_LAMP = 'base:desk-lamp';
/**
 * Objects without a tile of their own: they hang from the ceiling or stand on other furniture
 * (no footprint in the content, the sim does not block on them). Never counted as overlaps.
 */
/**
 * Worktop height (m) of the base pack furniture with one (content `surfaceHeightM`, #267;
 * `furnish.test.ts` checks it against the bundle). Kept here so the lazy world generator needs
 * no content bundle.
 */
export const BASE_SURFACES: Readonly<Record<string, number>> = {
  'base:tv-stand': 0.55,
  'base:desk': 0.75,
  'base:table': 0.75,
  'base:shop-counter': 0.95,
};
/** Objects that stand on a worktop (`placeable.onSurface`, #267): never without one under them. */
export const ON_SURFACE: ReadonlySet<string> = new Set([
  'base:tv',
  'base:vcr',
  'base:radio-set',
  DESK_LAMP,
]);
export const OVERLAY_OBJECTS: ReadonlySet<string> = new Set([
  CEILING_LAMP,
  'base:light-switch',
  ...ON_SURFACE,
]);

/** Furniture kit per room type, in placement order (first items get the best spots). */
export const ROOM_KITS: Record<string, KitItem[]> = {
  // Every container stays within its `placeIn` (content data, test in furnish.test.ts).
  'base:room-kitchen': [
    K('base:fridge-freezer', 1, 1, 0, TALL),
    // Range (stove + oven, #211) or a gas stove (#246): both cook.
    K('base:range', 1, 1, 0, { alt: ['base:range', 'base:gas-stove'] }),
    K('base:kitchen-sink', 1, 1),
    // Kitchen table (#254) with 1–3 chairs, before the counters so it gets a wall.
    K('base:table', 1, 1, 0, { seats: { id: CHAIR, min: 1, max: 3, per: 5 } }),
    K('base:kitchen-counter', 1, 3, 5),
    K('base:kitchen-cabinet', 1, 3, 6),
    K('base:freezer', 0, 1, 14),
  ],
  'base:room-bedroom': [
    K('base:bed', 1, 2, 12),
    K('base:wardrobe', 1, 1, 0, TALL),
    K('base:dresser', 1, 1),
    K(FLOOR_LAMP_ID, 1, 1, 0, { corner: true }),
    K('base:desk', 0, 1, 12, {
      then: K(CHAIR, 1, 1, 0, { atFront: true }),
      top: 'base:desk-lamp',
    }),
  ],
  'base:room-living-room': [
    // TV corner first (stand, TV, VCR by the TV, radio), so small rooms still get it (#211).
    // TV corner (Symulacja #211): stand, the TV by it and its VCR right by them, all or none
    // of the TV and VCR (the stand only where both fit, else a plain stand).
    // #267: the VCR and the TV on top of it stand on the stand (its tile, +surfaceHeightM).
    K('base:tv-stand', 1, 1, 0, { top: ['base:vcr', 'base:tv'] }),
    K('base:sofa', 1, 2, 14),
    K('base:armchair', 1, 1),
    K(FLOOR_LAMP_ID, 1, 1, 0, { corner: true }),
    // Dining table with 2–4 chairs where the room is big enough.
    K('base:table', 0, 1, 16, { seats: { id: CHAIR, min: 2, max: 4, per: 5 } }),
    // Radio on the table, else on a stand of its own (#267: never on the floor).
    K('base:radio-set', 1, 1, 0, {
      onto: { ids: ['base:table', 'base:desk'], stand: 'base:tv-stand' },
    }),
    K('base:bookshelf', 1, 2, 16, TALL),
    K('base:dresser', 0, 1, 18),
  ],
  'base:room-bathroom': [
    K('base:bathroom-sink', 1, 1),
    K('base:bathtub', 1, 1, 0, { alt: ['base:bathtub', 'base:shower'] }),
    // Toilet (#258): back to a solid wall, facing the room, never in the doorway.
    K('base:toilet', 1, 1, 0, TALL),
    K('base:bathroom-cabinet', 1, 1),
  ],
  'base:room-hospital': [
    K('base:bed', 0, 3, 12),
    K('base:locker', 0, 2, 20, TALL),
    K('base:metal-shelf', 0, 2, 20, TALL),
  ],
  'base:room-pharmacy': [
    K('base:metal-shelf', 2, 6, 5, TALL),
    K('base:shop-counter', 1, 1),
    K('base:locker', 0, 1, 20, TALL),
  ],
  'base:room-shop': [
    K('base:metal-shelf', 2, 6, 7, TALL),
    K('base:metal-shelf', 0, 4, 14, { tall: true, middle: true }),
    K('base:fridge', 1, 3, 20, TALL),
    K('base:freezer', 0, 2, 30),
    K('base:shop-counter', 1, 1),
  ],
  'base:room-gas-station': [
    K('base:metal-shelf', 1, 3, 8, TALL),
    K('base:fridge', 1, 1, 0, TALL),
    K('base:shop-counter', 1, 1),
  ],
  'base:room-warehouse': [
    K('base:metal-shelf', 1, 4, 8, TALL),
    K('base:crate', 1, 4, 10),
    // Big storage halls: free-standing rack rows.
    K('base:metal-shelf', 0, 8, 60, { tall: true, middle: true }),
  ],
  'base:room-garage': [
    K('base:tool-chest', 1, 1),
    K('base:metal-shelf', 1, 2, 16, TALL),
    K('base:crate', 0, 1, 16),
    // Hall workshops (only big rooms get them).
    K('base:workbench', 0, 2, 120),
    K('base:tool-chest', 0, 2, 200),
  ],
  'base:room-police': [K('base:locker', 1, 3, 10, TALL), K('base:gun-locker', 0, 1, 24, TALL)],
  'base:room-school': [
    // Teacher's table (no desk in a school: `placeIn`), its chair and a desk lamp on it.
    K('base:table', 1, 1, 0, {
      seats: { id: CHAIR, min: 1, max: 1, per: 0 },
      top: 'base:desk-lamp',
    }),
    K('base:locker', 1, 3, 14, TALL),
    K('base:bookshelf', 0, 1, 24, TALL),
  ],
  'base:room-gym': [K('base:locker', 1, 4, 14, TALL), K('base:bench', 1, 3, 30)],
  'base:room-office': [
    // Typical office (Paweł 24.11): a desk with a chair and a lamp per ~7 m², up to four, binder
    // shelves along the walls (no lockers: they stood in front of the windows).
    K('base:desk', 1, 4, 7, {
      then: K(CHAIR, 1, 1, 0, { atFront: true }),
      top: 'base:desk-lamp',
    }),
    K('base:bookshelf', 1, 2, 12, TALL),
    K('base:metal-shelf', 0, 1, 24, TALL),
    // Meeting table in bigger offices.
    K('base:table', 0, 1, 20, { seats: { id: CHAIR, min: 2, max: 4, per: 6 } }),
    K('base:dresser', 0, 1, 14),
  ],
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

/** A candidate place for one piece of furniture (NW anchor, rot, covered tiles, front row). */
interface Spot {
  x: number;
  y: number;
  rot: number;
  tiles: [number, number][];
  keys: Set<string>;
  front: string[];
  score: number;
}

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
    bp.objects.flatMap((o) =>
      occupiedTiles(o.x, o.y, o.rot, (opt.footprint ?? baseFootprint)(o.contentId)).map((t) =>
        key(t.x, t.y, o.z),
      ),
    ),
    opt,
    bp.objects,
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
  existing: readonly PlacedObject[] = [],
): PlacedObject[] {
  const seed = opt.seed ?? 1;
  const taken = new Set<string>(occupied);
  const keepFree = reservedTiles(view);
  const byWindow = windowTiles(view);
  const out: PlacedObject[] = [];
  const rotAt = new Map<string, number>();
  const idAt = new Map<string, string>();
  const fpOf = opt.footprint ?? baseFootprint;
  const unput = (o: PlacedObject) => {
    out.splice(out.indexOf(o), 1);
    for (const t of occupiedTiles(o.x, o.y, o.rot, fpOf(o.contentId))) {
      taken.delete(key(t.x, t.y, o.z));
      rotAt.delete(key(t.x, t.y, o.z));
      idAt.delete(key(t.x, t.y, o.z));
    }
  };
  const put = (o: PlacedObject) => {
    out.push(o);
    for (const t of occupiedTiles(o.x, o.y, o.rot, fpOf(o.contentId))) {
      taken.add(key(t.x, t.y, o.z));
      rotAt.set(key(t.x, t.y, o.z), o.rot);
      idAt.set(key(t.x, t.y, o.z), o.contentId);
    }
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
    const usable = (x: number, y: number) => free(x, y) && !fronts.has(key(x, y, z));
    /**
     * The footprint `fp` with its back against side `sd` of tile (x, y), (x, y) being the first
     * back tile along the wall (+x along n/s walls, +y along e/w walls); undefined when it does
     * not fit (every tile free in this room, back on a wall, no edge inside, a free front row).
     */
    const fitAt = (
      x: number,
      y: number,
      sd: (typeof SIDES)[number],
      fp: Footprint,
      item: KitItem,
    ): Omit<Spot, 'score'> | undefined => {
      const ax = sd.dy !== 0 ? 1 : 0; // along the wall
      const ay = sd.dy !== 0 ? 0 : 1;
      const ix = -sd.dx; // into the room
      const iy = -sd.dy;
      const cells: [number, number][] = [];
      for (let j = 0; j < fp.h; j++)
        for (let i = 0; i < fp.w; i++) cells.push([x + ax * i + ix * j, y + ay * i + iy * j]);
      if (!cells.every(([cx, cy]) => usable(cx, cy))) return undefined;
      // No wall / window inside the footprint.
      for (let j = 0; j < fp.h; j++)
        for (let i = 0; i < fp.w; i++) {
          const cx = x + ax * i + ix * j;
          const cy = y + ay * i + iy * j;
          if (i + 1 < fp.w && view.edge(cx, cy, z, ay ? 's' : 'e') !== undefined) return undefined;
          if (j + 1 < fp.h && view.edge(cx, cy, z, opposite(sd.s)) !== undefined) return undefined;
        }
      const front: string[] = [];
      for (let i = 0; i < fp.w; i++) {
        const bx = x + ax * i;
        const by = y + ay * i;
        const e = view.edge(bx, by, z, sd.s);
        const lx = bx + ix * (fp.h - 1);
        const ly = by + iy * (fp.h - 1);
        const fx = lx + ix;
        const fy = ly + iy;
        if (!free(fx, fy) || !view.open(lx, ly, z, opposite(sd.s))) return undefined;
        front.push(key(fx, fy, z));
        if (item.middle) {
          // Free-standing: no edge around, aisles in front and behind, all neighbours indoor.
          if (!free(bx - ix, by - iy)) return undefined;
          front.push(key(bx - ix, by - iy, z));
        } else if (!(e === 'wall' || (!item.tall && e === 'window'))) return undefined;
      }
      if (item.middle) {
        for (const [cx, cy] of cells)
          for (const q of SIDES) {
            if (view.edge(cx, cy, z, q.s) !== undefined) return undefined;
            if (!indoor(cx + q.dx, cy + q.dy, z, roomId)) return undefined;
          }
      }
      const nx = Math.min(...cells.map((c) => c[0]));
      const ny = Math.min(...cells.map((c) => c[1]));
      return {
        x: nx,
        y: ny,
        rot: sd.rot,
        tiles: cells,
        keys: new Set(cells.map(([cx, cy]) => key(cx, cy, z))),
        front,
      };
    };

    /** Whether any of the 8 neighbours of `cells` (outside them) holds a `id`. */
    const touchesSame = (cells: readonly [number, number][], id: string): boolean => {
      const own = new Set(cells.map(([x, y]) => key(x, y, z)));
      for (const [x, y] of cells)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const k = key(x + dx, y + dy, z);
            if (!own.has(k) && idAt.get(k) === id) return true;
          }
      return false;
    };
    /** Scored spots for `item` (most wanted first). */
    const candidates = (item: KitItem, fp: Footprint): Spot[] => {
      const cands: Spot[] = [];
      for (const [x, y] of tiles) {
        for (const sd of SIDES) {
          const spot = fitAt(x, y, sd, fp, item);
          if (!spot) continue;
          // Cluster along the same wall (kitchen rows, shelf rows), otherwise random.
          let score = rand();
          let touches = false;
          for (const [tx, ty] of spot.tiles)
            for (const q of SIDES) {
              const nk = key(tx + q.dx, ty + q.dy, z);
              if (spot.keys.has(nk)) continue;
              if (rotAt.get(nk) === sd.rot) score += 0.6;
              // Near = touching inside this room (not through a wall).
              if (
                item.near?.includes(idAt.get(nk) ?? '') &&
                view.room(tx + q.dx, ty + q.dy, z) === roomId &&
                view.open(tx, ty, z, q.s)
              ) {
                score += 5;
                touches = true;
              }
            }
          if (item.mustTouch && !touches) continue;
          // Seats of one type keep a tile apart (two sofas side by side read as one bench).
          if (SPACED_SEATS.has(item.id) && touchesSame(spot.tiles, item.id)) continue;
          cands.push({ ...spot, score });
        }
      }
      return cands.sort((a, b) => b.score - a.score);
    };
    /**
     * Places one `item` at its best spot that keeps the room connected; with `then`, only where
     * the follow-up item fits too (a TV only where its VCR has a place). Returns success.
     */
    /** A chair-like `then` on a free front tile of `parent`, facing it. */
    const frontSpots = (parent: Spot): Spot[] =>
      parent.front
        .map((k) => k.split(',').map(Number) as [number, number, number])
        .filter(([fx, fy]) => free(fx, fy))
        .map(([fx, fy]) => ({
          x: fx,
          y: fy,
          rot: (parent.rot + 2) % 4,
          tiles: [[fx, fy]] as [number, number][],
          keys: new Set([key(fx, fy, z)]),
          front: [],
          score: 0,
        }));
    /** Keeps the room's free tiles as connected as before when `keys` get taken. */
    const keepsConnected = (keys: Iterable<string>): boolean => {
      const ks = [...keys];
      for (const k of ks) taken.add(k);
      const ok = components(view, tiles, z, roomId, taken, indoor) <= comps0;
      for (const k of ks) taken.delete(k);
      return ok;
    };
    /**
     * Chairs around `parent` (front tiles, then both ends), each facing it; `own` = the parent's
     * own front tiles (a chair never takes the front tile another piece needs).
     */
    const seatSpots = (parent: Spot, own: ReadonlySet<string>): Spot[] => {
      const res: Spot[] = [];
      const seen = new Set<string>();
      const add = (x: number, y: number, fromX: number, fromY: number) => {
        const k = key(x, y, z);
        if (seen.has(k) || parent.keys.has(k)) return;
        seen.add(k);
        if (!free(x, y) || (fronts.has(k) && !own.has(k))) return;
        const sd = SIDES.find((q) => q.dx === x - fromX && q.dy === y - fromY)!;
        if (!view.open(fromX, fromY, z, sd.s)) return;
        // Back toward the side away from the table: faces it.
        res.push({ x, y, rot: sd.rot, tiles: [[x, y]], keys: new Set([k]), front: [], score: 0 });
      };
      const sd = SIDES.find((q) => q.rot === parent.rot)!;
      for (const k of parent.front) {
        const [fx, fy] = k.split(',').map(Number) as [number, number];
        add(fx, fy, fx + sd.dx, fy + sd.dy);
      }
      // Ends: along the wall, beside the first and the last tile of the back row.
      const ax = sd.dy !== 0 ? 1 : 0;
      const ay = sd.dy !== 0 ? 0 : 1;
      const along = parent.tiles.map(([x, y]) => x * ax + y * ay);
      const lo = Math.min(...along);
      const hi = Math.max(...along);
      for (const [tx, ty] of parent.tiles) {
        const a = tx * ax + ty * ay;
        if (a === lo) add(tx - ax, ty - ay, tx, ty);
        if (a === hi) add(tx + ax, ty + ay, tx, ty);
      }
      return res;
    };
    /** Free corners for a 1×1 piece: solid edges on two adjacent sides, back to one of them. */
    const cornerSpots = (): Spot[] => {
      const res: Spot[] = [];
      const solid = (x: number, y: number, s: Side) => {
        const e = view.edge(x, y, z, s);
        return e === 'wall' || e === 'window';
      };
      for (const [x, y] of tiles) {
        if (!usable(x, y) || SIDES.some((q) => view.edge(x, y, z, q.s) === 'door')) continue;
        for (let i = 0; i < 4; i++) {
          const a = SIDES[i]!;
          const b = SIDES[(i + 1) % 4]!;
          if (!solid(x, y, a.s) || !solid(x, y, b.s)) continue;
          for (const back of [a, b]) {
            const fx = x - back.dx;
            const fy = y - back.dy;
            if (!free(fx, fy) || !view.open(x, y, z, opposite(back.s))) continue;
            res.push({
              x,
              y,
              rot: back.rot,
              tiles: [[x, y]],
              keys: new Set([key(x, y, z)]),
              front: [key(fx, fy, z)],
              score: rand(),
            });
          }
        }
      }
      return res.sort((p, q) => q.score - p.score);
    };
    const placeOne = (item: KitItem, parent?: Spot): boolean => {
      const spots =
        item.atFront && parent
          ? frontSpots(parent)
          : item.corner
            ? [...cornerSpots(), ...candidates(item, fpOf(item.id))]
            : candidates(item, fpOf(item.id));
      for (const c of spots) {
        if (!keepsConnected(c.keys)) continue;
        if (WINDOW_CLEAR.has(item.id) && [...c.keys].some((k) => byWindow.has(k))) continue;
        const o = { contentId: item.id, x: c.x, y: c.y, z, rot: c.rot };
        put(o);
        const added = c.front.filter((k) => !fronts.has(k));
        for (const k of added) fronts.add(k);
        const chairs: PlacedObject[] = [];
        let ok = !item.then || placeOne(item.then, c);
        if (ok && item.seats) {
          const s = item.seats;
          const want = Math.max(s.min, Math.min(s.max, s.per ? Math.round(area / s.per) : s.min));
          const own = new Set(added);
          for (const seat of seatSpots(c, own)) {
            if (chairs.length >= want) break;
            if (!free(seat.x, seat.y) || !keepsConnected(seat.keys)) continue;
            if (WINDOW_CLEAR.has(s.id) && byWindow.has(key(seat.x, seat.y, z))) continue;
            const ch = { contentId: s.id, x: seat.x, y: seat.y, z, rot: seat.rot };
            put(ch);
            chairs.push(ch);
          }
          if (chairs.length < s.min) {
            for (const ch of chairs) unput(ch);
            ok = false;
          }
        }
        if (ok) {
          // On its anchor (NW) tile, drawn there with footprints on or off; no tile taken.
          for (const t of typeof item.top === 'string' ? [item.top] : (item.top ?? []))
            out.push({ contentId: t, x: c.x, y: c.y, z, rot: c.rot });
          return true;
        }
        unput(o);
        for (const k of added) fronts.delete(k);
      }
      return false;
    };

    for (const kitItem of kit) {
      const item = kitItem.alt
        ? { ...kitItem, id: kitItem.alt[Math.floor(rand() * kitItem.alt.length)]! }
        : kitItem;
      const want = Math.max(
        item.min ?? 1,
        Math.min(item.max ?? 1, item.per ? Math.round(area / item.per) : (item.min ?? 1)),
      );
      for (let n = 0; n < want; n++) {
        if (!item.onto) {
          placeOne(item);
          continue;
        }
        // On a free worktop of this room (anchor tile without an ON_SURFACE item yet).
        const busy = new Set(
          out.filter((o) => ON_SURFACE.has(o.contentId)).map((o) => key(o.x, o.y, o.z)),
        );
        const host = item.onto.ids
          .flatMap((id) =>
            out.filter(
              (o) =>
                o.contentId === id &&
                o.z === z &&
                view.room(o.x, o.y, z) === roomId &&
                !busy.has(key(o.x, o.y, z)),
            ),
          )
          .at(0);
        if (host) out.push({ contentId: item.id, x: host.x, y: host.y, z, rot: host.rot });
        else if (item.onto.stand) placeOne(K(item.onto.stand, 1, 1, 0, { top: item.id }));
      }
    }

    // Lamps (#254).
    if (meta && CEILING_LAMP_ROOMS.has(meta.roomType)) {
      // Hangs over the tile nearest the room's middle (a free one if any, never a door tile).
      const inner = tiles.filter(
        ([x, y]) => indoor(x, y, z, roomId) && !keepFree.has(key(x, y, z)),
      );
      if (inner.length > 0) {
        const mx = inner.reduce((s, t) => s + t[0], 0) / inner.length;
        const my = inner.reduce((s, t) => s + t[1], 0) / inner.length;
        const best = inner
          .map(([x, y]) => ({
            x,
            y,
            d: Math.hypot(x - mx, y - my) + (taken.has(key(x, y, z)) ? 3 : 0),
          }))
          .sort((p, q) => p.d - q.d || p.y - q.y || p.x - q.x)[0]!;
        out.push({ contentId: CEILING_LAMP, x: best.x, y: best.y, z, rot: 0 });
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
        .filter(
          ([x, y, rot]) =>
            !WINDOW_CLEAR.has(id) ||
            !occupiedTiles(x, y, rot, fpOf(id)).some((t) => byWindow.has(key(t.x, t.y, 0))),
        )
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
    // Block of flats (several klatki or 4+ storeys): a bin shelter, two dumpsters side by side
    // 4–10 tiles from the main entrance (altana śmietnikowa by the block).
    const ownStair = (s: { x: number; y: number; z: number }) =>
      view.rooms.get(view.room(s.x, s.y, s.z))?.buildingId === b;
    const klatki = view.stairs.filter((s) => s.z === 0 && ownStair(s)).length;
    const tall = view.stairs.some((s) => s.z >= 2 && ownStair(s));
    if (any(HOME) && (klatki >= 2 || tall)) {
      const first = out.length;
      pick(
        (x, y) => (near(x, y) >= 4 && near(x, y) <= 10 ? 6 - Math.abs(near(x, y) - 6) : -Infinity),
        'base:dumpster',
      );
      const d = out.length > first ? out[out.length - 1] : undefined;
      if (d)
        pick(
          (x, y) => (Math.abs(x - d.x) + Math.abs(y - d.y) === 1 ? 1 : -Infinity),
          'base:dumpster',
        );
    }
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
  // --- light switches (#242 / #246): one by the door of every room with a powered lamp -------
  // On the wall (no tile of its own): off door and stair tiles, best where nothing stands.
  for (const sw of lightSwitches(
    view,
    [...existing, ...out],
    (k) => taken.has(k),
    (k) => keepFree.has(k),
  ))
    out.push(sw);
  return out.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

/** Lamps that need power (`placeable.light.requiresPower`, default true): switched per room. */
export const POWERED_LAMPS: ReadonlySet<string> = new Set([
  'base:ceiling-lamp',
  'base:floor-lamp',
  'base:desk-lamp',
]);
/** Light switch (`lighting.switchTag`); `placeable: {}` — blocks nothing, no footprint. */
export const LIGHT_SWITCH = 'base:light-switch';

/**
 * A light switch for every room with a powered lamp and no switch yet: on the wall right beside
 * the room's door (inside, the tile next to the door tile along the wall, back to that wall),
 * else on the door tile's neighbour inside the room, else (no door of its own) on any wall of
 * the room. Never on a door or stair tile (`isReserved`, default: tiles with a door edge); a tile
 * where nothing stands (`isTaken`) wins. Deterministic (rooms, doors in tile order).
 */
export function lightSwitches(
  view: FurnishView,
  objects: readonly PlacedObject[],
  isTaken: (k: string) => boolean = () => false,
  isReserved?: (k: string) => boolean,
): PlacedObject[] {
  const reserved =
    isReserved ??
    ((k: string) => {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      return SIDES.some((q) => view.edge(x, y, z, q.s) === 'door');
    });
  const lampRooms = new Map<number, number>();
  const hasSwitch = new Set<number>();
  for (const o of objects) {
    const r = view.room(o.x, o.y, o.z);
    if (!r) continue;
    if (POWERED_LAMPS.has(o.contentId)) lampRooms.set(r, o.z);
    if (o.contentId === LIGHT_SWITCH) hasSwitch.add(r);
  }
  const used = new Set(
    objects.filter((o) => o.contentId === LIGHT_SWITCH).map((o) => key(o.x, o.y, o.z)),
  );
  const out: PlacedObject[] = [];
  for (const [room, z] of [...lampRooms].sort((a, b) => a[0] - b[0])) {
    if (hasSwitch.has(room)) continue;
    let best: PlacedObject | undefined;
    let bestScore = -1;
    for (const [x, y] of view.tiles(z)) {
      if (view.room(x, y, z) !== room) continue;
      for (const sd of SIDES) {
        if (view.edge(x, y, z, sd.s) !== 'door') continue;
        // Along the door's wall, both ways.
        const along =
          sd.dy !== 0
            ? [
                [1, 0],
                [-1, 0],
              ]
            : [
                [0, 1],
                [0, -1],
              ];
        for (const [ax, ay] of along) {
          const sx = x + ax!;
          const sy = y + ay!;
          const k = key(sx, sy, z);
          if (view.room(sx, sy, z) !== room || used.has(k) || reserved(k)) continue;
          if (!view.open(x, y, z, sideOf(ax!, ay!))) continue;
          const onWall = view.edge(sx, sy, z, sd.s) === 'wall';
          const score = (onWall ? 2 : 1) + (isTaken(k) ? 0 : 2);
          if (score > bestScore) {
            bestScore = score;
            best = {
              contentId: LIGHT_SWITCH,
              x: sx,
              y: sy,
              z,
              rot: onWall ? sd.rot : (sd.rot + 2) % 4,
            };
          }
        }
      }
    }
    if (!best) {
      // No door of its own (an opening into the hall): on any wall of the room.
      for (const [x, y] of view.tiles(z)) {
        if (view.room(x, y, z) !== room) continue;
        const k = key(x, y, z);
        if (used.has(k) || reserved(k)) continue;
        const wall = SIDES.find((q) => view.edge(x, y, z, q.s) === 'wall');
        const score = isTaken(k) ? 0 : 0.5;
        if (wall && score > bestScore) {
          bestScore = score;
          best = { contentId: LIGHT_SWITCH, x, y, z, rot: wall.rot };
        }
      }
    }
    if (best) {
      out.push(best);
      used.add(key(best.x, best.y, best.z));
    }
  }
  return out;
}

const sideOf = (dx: number, dy: number): Side => (dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n');

/** Props that may stand on a sidewalk (street furniture). */
const STREET_PROPS: ReadonlySet<string> = new Set([
  'base:trash-bin',
  'base:dumpster',
  'base:bench',
]);

const opposite = (s: Side): Side => ({ n: 's', s: 'n', e: 'w', w: 'e' })[s] as Side;

/**
 * Kept off the tile just inside / just outside every window (Fizyka 25.10: windows must stay
 * climbable, like doors): furniture in front of a window inside, yard props outside. Kitchen
 * units, sinks, wardrobes etc. are not listed (they stand under windows or need a solid wall).
 */
export const WINDOW_CLEAR: ReadonlySet<string> = new Set([
  'base:dresser',
  'base:desk',
  'base:table',
  'base:sofa',
  'base:armchair',
  'base:chair',
  'base:bed',
  'base:shop-counter',
  'base:tv-stand',
  'base:trash-bin',
  'base:dumpster',
  'base:crate',
  'base:firewood-pile',
  // Fizyka 25.10 (2): kitchen, shelving and bathroom fittings, inside only.
  'base:fridge',
  'base:freezer',
  'base:fridge-freezer',
  'base:kitchen-counter',
  'base:kitchen-cabinet',
  'base:kitchen-sink',
  'base:gas-stove',
  'base:range',
  'base:bookshelf',
  'base:metal-shelf',
  'base:bathroom-cabinet',
  'base:bathroom-sink',
  'base:bathtub',
  'base:shower',
  'base:toilet',
]);

/** Tiles on both sides of every window edge (`x,y,z` keys). */
function windowTiles(view: FurnishView): Set<string> {
  const res = new Set<string>();
  for (const z of view.levels)
    for (const [x, y] of view.tiles(z))
      for (const sd of SIDES) {
        if (view.edge(x, y, z, sd.s) !== 'window') continue;
        res.add(key(x, y, z));
        res.add(key(x + sd.dx, y + sd.dy, z));
      }
  return res;
}

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
