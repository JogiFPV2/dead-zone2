import {
  CHUNK_SIZE,
  MAP_FORMAT_VERSION,
  STAIR_STEP,
  chunkFileName,
  encodeLayer,
  type EdgeType,
  type MapChunkJson,
  type MapManifest,
  type Stairs,
} from '@deadzone/content';
import type { Blueprint, BlueprintStairs, Building } from './blueprint.js';
import { buildZones } from './zones.js';

type Rooms = Building['rooms'];
type Opening = Building['openings'][number];
/** Room ids of upper floors without their own `rooms`: ground id + ROOM_Z_STRIDE * z. */
export const ROOM_Z_STRIDE = 4096;

type Side = 'n' | 'w';
interface EdgeCell {
  type: EdgeType;
  contentId: string;
}

/** Built map, ready to serialize: `maps/<id>/manifest.json` + `maps/<id>/chunks/<file>`. */
export interface BuiltMap {
  id: string;
  manifest: MapManifest;
  chunks: { file: string; json: MapChunkJson }[];
}

const TILES = CHUNK_SIZE * CHUNK_SIZE;
const edgeKey = (x: number, y: number, side: Side) => `${x},${y},${side}`;

/** World-sized layers covering the blueprint's chunk range. */
class World {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  /** Floor/roof values are indices into `tiles` (+1), 0 = empty. */
  readonly floor: Uint32Array;
  readonly roof: Uint32Array;
  readonly room: Uint16Array;
  readonly tiles: string[] = [];
  readonly edges = new Map<string, EdgeCell>();

  constructor(
    bp: Blueprint,
    /** Level of these layers (0 = ground). */
    readonly z = 0,
    /** Tile list shared by all levels (one palette order). */
    tiles?: string[],
  ) {
    if (tiles) this.tiles = tiles;
    const { cx0, cy0, cx1, cy1 } = bp.chunks;
    if (cx1 < cx0 || cy1 < cy0) throw new Error('chunks: pusty zakres');
    this.x0 = cx0 * CHUNK_SIZE;
    this.y0 = cy0 * CHUNK_SIZE;
    this.w = (cx1 - cx0 + 1) * CHUNK_SIZE;
    this.h = (cy1 - cy0 + 1) * CHUNK_SIZE;
    this.floor = new Uint32Array(this.w * this.h);
    this.roof = new Uint32Array(this.w * this.h);
    this.room = new Uint16Array(this.w * this.h);
  }

  inside = (x: number, y: number) =>
    x >= this.x0 && y >= this.y0 && x < this.x0 + this.w && y < this.y0 + this.h;

  index(x: number, y: number, what: string): number {
    if (!this.inside(x, y)) throw new Error(`${what}: kafel (${x}, ${y}) poza mapą`);
    return (y - this.y0) * this.w + (x - this.x0);
  }

  /** Registers a tile id in authoring order (this order becomes the chunk palette order). */
  tile(id: string): number {
    const i = this.tiles.indexOf(id);
    return i === -1 ? this.tiles.push(id) : i + 1;
  }

  /** Any floor, room or edge in chunk (cx, cy) (upper levels only emit used chunks). */
  used(cx: number, cy: number): boolean {
    const ox = cx * CHUNK_SIZE;
    const oy = cy * CHUNK_SIZE;
    for (let y = oy; y < oy + CHUNK_SIZE; y++) {
      for (let x = ox; x < ox + CHUNK_SIZE; x++) {
        const i = this.index(x, y, '');
        if (this.floor[i] || this.room[i]) return true;
      }
    }
    for (const k of this.edges.keys()) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      if (x >= ox && y >= oy && x < ox + CHUNK_SIZE && y < oy + CHUNK_SIZE) return true;
    }
    return false;
  }

  roomAt = (x: number, y: number) =>
    this.inside(x, y) ? (this.room[this.index(x, y, '')] ?? 0) : 0;
}

/** Canonical edge: s/e sides are stored as n/w of the neighbour tile. */
function canonical(x: number, y: number, side: 'n' | 's' | 'e' | 'w'): [number, number, Side] {
  if (side === 's') return [x, y + 1, 'n'];
  if (side === 'e') return [x + 1, y, 'w'];
  return [x, y, side];
}

/** Rooms of floor `z` (its own, or the ground floor's with ids shifted by ROOM_Z_STRIDE · z). */
export function floorRooms(b: Building, z: number): Rooms {
  if (z === 0) return b.rooms;
  const own = b.floors.find((f) => f.z === z)?.rooms;
  if (own) return own;
  return Object.fromEntries(
    Object.entries(b.rooms).map(([k, r]) => [k, { ...r, id: r.id + ROOM_Z_STRIDE * z }]),
  );
}

/** Highest floor of a building (its roof sits there). */
export const topFloor = (b: Building): number => Math.max(0, ...b.floors.map((f) => f.z));

/** World tiles (`x,y`) of flights arriving on level z: no floor there (stair opening). */
function stairHoles(stairs: readonly BlueprintStairs[], z: number): Set<string> {
  const holes = new Set<string>();
  for (const st of stairs) {
    if (st.zFrom !== z - 1) continue;
    const [dx, dy] = STAIR_STEP[st.dir];
    for (let k = 0; k < st.len; k++) holes.add(`${st.at[0] + dx * k},${st.at[1] + dy * k}`);
  }
  return holes;
}

function paintBuilding(world: World, b: Building, holes: ReadonlySet<string>): void {
  const z = world.z;
  const level = z === 0 ? undefined : b.floors.find((f) => f.z === z);
  if (z > 0 && !level) return;
  const plan = level?.plan ?? b.plan;
  const rooms = floorRooms(b, z);
  const openings: Opening[] = level ? level.openings : b.openings;
  const tiles: [number, number][] = [];
  // Palette order = authoring order: room floors, then the roof.
  for (const r of Object.values(rooms)) world.tile(r.floor);
  const roof = b.roof === undefined || z !== topFloor(b) ? 0 : world.tile(b.roof);
  plan.forEach((row, py) => {
    [...row].forEach((ch, px) => {
      if (ch === '.' || ch === ' ') return;
      const room = rooms[ch];
      if (!room) throw new Error(`budynek ${b.id}: znak „${ch}” nie ma wpisu w rooms`);
      const x = b.origin[0] + px;
      const y = b.origin[1] + py;
      const i = world.index(x, y, `budynek ${b.id}`);
      // 0 = no floor: the opening above a flight of stairs.
      world.floor[i] = holes.has(`${x},${y}`) ? 0 : world.tile(room.floor);
      world.room[i] = room.id;
      if (roof) world.roof[i] = roof;
      tiles.push([x, y]);
    });
  });
  // Walls on every border where the room changes (room | other room, room | outside).
  for (const [x, y] of tiles) {
    const r = world.roomAt(x, y);
    for (const side of ['n', 's', 'e', 'w'] as const) {
      const [ex, ey, s] = canonical(x, y, side);
      const [nx, ny] =
        side === 'n'
          ? [x, y - 1]
          : side === 's'
            ? [x, y + 1]
            : side === 'e'
              ? [x + 1, y]
              : [x - 1, y];
      if (world.roomAt(nx, ny) === r) continue;
      world.index(ex, ey, `budynek ${b.id}: ściana`);
      world.edges.set(edgeKey(ex, ey, s), { type: 'wall', contentId: b.wall });
    }
  }
  for (const o of openings) {
    const [ex, ey, s] = canonical(b.origin[0] + o.at[0], b.origin[1] + o.at[1], o.side);
    const key = edgeKey(ex, ey, s);
    if (!world.edges.has(key)) {
      throw new Error(
        `budynek ${b.id}: otwór ${o.type} w (${o.at.join(', ')}) ${o.side} nie leży na ścianie`,
      );
    }
    const contentId = o.contentId ?? (o.type === 'door' ? b.door : b.window);
    if (!contentId) throw new Error(`budynek ${b.id}: brak domyślnego ${o.type}`);
    world.edges.set(key, { type: o.type, contentId });
  }
}

/** Stairs tool: the whole flight must lie on the map; no two flights on a level share a tile. */
function checkStairs(world: World, stairs: readonly BlueprintStairs[]): void {
  const used = new Map<string, number>();
  stairs.forEach((st, i) => {
    const [dx, dy] = STAIR_STEP[st.dir];
    for (let k = 0; k < st.len; k++) {
      const x = st.at[0] + dx * k;
      const y = st.at[1] + dy * k;
      world.index(x, y, `schody ${i}`);
      const key = `${x},${y},${st.zFrom}`;
      const other = used.get(key);
      if (other !== undefined)
        throw new Error(`schody ${i} zachodzą na schody ${other} w (${x}, ${y})`);
      used.set(key, i);
    }
  });
}

/** Blueprint -> chunked map JSON (content format). Pure and deterministic. */
export function buildMap(bp: Blueprint): BuiltMap {
  const world = new World(bp);
  world.floor.fill(world.tile(bp.ground));
  for (const a of bp.areas) {
    const v = world.tile(a.floor);
    for (let y = a.y; y < a.y + a.h; y++) {
      for (let x = a.x; x < a.x + a.w; x++) world.floor[world.index(x, y, 'area')] = v;
    }
  }
  const rooms = new Map<number, { roomType: string; buildingId: number }>();
  const levels = new Map<number, World>([[0, world]]);
  for (const b of bp.buildings) {
    for (const z of [0, ...b.floors.map((f) => f.z)]) {
      for (const r of Object.values(floorRooms(b, z))) {
        if (r.id > 0xffff) throw new Error(`budynek ${b.id}: roomId ${r.id} > 65535`);
        const prev = rooms.get(r.id);
        if (prev && (prev.roomType !== r.type || prev.buildingId !== b.id)) {
          throw new Error(`roomId ${r.id} użyty z innym typem lub budynkiem`);
        }
        rooms.set(r.id, { roomType: r.type, buildingId: b.id });
      }
      let w = levels.get(z);
      if (!w) levels.set(z, (w = new World(bp, z, world.tiles)));
      paintBuilding(w, b, stairHoles(bp.stairs, z));
    }
  }
  for (const f of bp.fences) {
    for (let i = 0; i < f.len; i++) {
      const x = f.side === 'n' ? f.x + i : f.x;
      const y = f.side === 'n' ? f.y : f.y + i;
      world.index(x, y, `płot ${f.contentId}`);
      world.edges.set(edgeKey(x, y, f.side), { type: 'fence', contentId: f.contentId });
    }
  }
  checkStairs(world, bp.stairs);
  for (const o of bp.objects) world.index(o.x, o.y, `obiekt ${o.contentId}`);

  const { cx0, cy0, cx1, cy1 } = bp.chunks;
  const chunks: BuiltMap['chunks'] = [];
  const addresses: MapManifest['chunks'] = [];
  for (const st of bp.stairs) {
    if (st.zFrom > 0 && !levels.has(st.zFrom))
      throw new Error(`schody w (${st.at.join(', ')}): brak piętra z = ${st.zFrom}`);
  }
  for (const [z, w] of [...levels].sort((a, b) => a[0] - b[0])) {
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        // Upper levels: only chunks with something on them.
        if (z > 0 && !w.used(cx, cy)) continue;
        const address = { cx, cy, z };
        addresses.push(address);
        chunks.push({ file: chunkFileName(address), json: chunkJson(w, bp, rooms, cx, cy) });
      }
    }
  }
  chunks.sort((a, b) => a.file.localeCompare(b.file));
  const manifest: MapManifest = {
    formatVersion: MAP_FORMAT_VERSION,
    ...(bp.name ? { name: bp.name } : {}),
    chunkSize: CHUNK_SIZE,
    floorHeight: bp.floorHeight,
    chunks: addresses,
  };
  const zones = buildZones(bp);
  if (zones.length > 0) manifest.zones = zones;
  return { id: bp.id, manifest, chunks };
}

function chunkJson(
  world: World,
  bp: Blueprint,
  rooms: ReadonlyMap<number, { roomType: string; buildingId: number }>,
  cx: number,
  cy: number,
): MapChunkJson {
  const ox = cx * CHUNK_SIZE;
  const oy = cy * CHUNK_SIZE;
  const floor = new Uint32Array(TILES);
  const roof = new Uint32Array(TILES);
  const room = new Uint16Array(TILES);
  for (let y = 0; y < CHUNK_SIZE; y++) {
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const w = world.index(ox + x, oy + y, 'chunk');
      floor[y * CHUNK_SIZE + x] = world.floor[w] ?? 0;
      roof[y * CHUNK_SIZE + x] = world.roof[w] ?? 0;
      room[y * CHUNK_SIZE + x] = world.room[w] ?? 0;
    }
  }
  // Chunk palette: used tiles in authoring order, 1-based (0 = empty).
  const used = new Set([...floor, ...roof]);
  const global = world.tiles.map((_, i) => i + 1).filter((v) => used.has(v));
  const local = new Map(global.map((g, i) => [g, i + 1]));
  const remap = (a: Uint32Array) => Uint16Array.from(a, (v) => (v === 0 ? 0 : (local.get(v) ?? 0)));

  const edges = [...world.edges]
    .map(([key, e]) => {
      const [x, y, side] = key.split(',') as [string, string, Side];
      return { x: Number(x) - ox, y: Number(y) - oy, side, type: e.type, contentId: e.contentId };
    })
    .filter((e) => e.x >= 0 && e.y >= 0 && e.x < CHUNK_SIZE && e.y < CHUNK_SIZE)
    .sort((a, b) => a.x - b.x || a.y - b.y || a.side.localeCompare(b.side));
  // Map objects stand on the ground level (no `z` in the blueprint yet).
  const objects = bp.objects
    .filter(() => world.z === 0)
    .filter((o) => o.x >= ox && o.y >= oy && o.x < ox + CHUNK_SIZE && o.y < oy + CHUNK_SIZE)
    .map((o) => ({ ...o, x: o.x - ox, y: o.y - oy }));
  const ids = [...new Set(room)].filter((v) => v !== 0).sort((a, b) => a - b);
  const stairs: Stairs[] = bp.stairs
    .filter(
      (s) =>
        s.zFrom === world.z &&
        s.at[0] >= ox &&
        s.at[1] >= oy &&
        s.at[0] < ox + CHUNK_SIZE &&
        s.at[1] < oy + CHUNK_SIZE,
    )
    .map((s) => ({ tx: s.at[0] - ox, ty: s.at[1] - oy, dir: s.dir, len: s.len }));

  return {
    address: { cx, cy, z: world.z },
    palette: global.map((g) => world.tiles[g - 1] ?? ''),
    layers: {
      floor: encodeLayer(remap(floor)),
      ...(roof.some((v) => v !== 0) ? { roof: encodeLayer(remap(roof)) } : {}),
      ...(ids.length > 0 ? { room: encodeLayer(room) } : {}),
    },
    edges,
    objects,
    rooms: Object.fromEntries(ids.map((id) => [String(id), rooms.get(id)!])),
    // Only when present, so maps without stairs keep byte-identical chunk files.
    ...(stairs.length > 0 ? { stairs } : {}),
  };
}
