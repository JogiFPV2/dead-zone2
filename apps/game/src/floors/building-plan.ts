import {
  CHUNK_SIZE,
  tileIndex,
  type BuildingId,
  type ChunkData,
  type ChunkSource,
  type EdgeKind,
} from '../world/chunk.js';

/**
 * Floor plans of one building, read from the static map chunks (room layer, wall edges, stairs)
 * — the same data the renderer and the sim use. What the player knows about each room (seen /
 * searched) is not here: it comes from `FloorIntel` (floor-intel.ts).
 */

/**
 * Room identity shared with the sim: the chunk-local room id of the room's first piece,
 * `z:cx:cy:room`. A room crossing a chunk border has a different id in each chunk; the plan
 * merges the pieces (same building, same room type, touching) and lists them in `parts`.
 */
export type RoomKey = string;
export const roomKey = (z: number, cx: number, cy: number, room: number): RoomKey =>
  `${z}:${cx}:${cy}:${room}`;

export interface RoomPart {
  cx: number;
  cy: number;
  room: number;
}

export interface PlanRoom {
  key: RoomKey;
  /** All chunk pieces of the room (keys the sim may report state under). */
  parts: RoomPart[];
  /** Room type content id (`base:room-kitchen`). */
  type: string;
  /** Floor area in tiles (m²). */
  area: number;
  /** Row runs of the room's tiles (world tiles): y, x0, x1 exclusive. */
  runs: { y: number; x0: number; x1: number }[];
  /** Label point: the room tile nearest to its centre (tile centre, world metres). */
  label: { x: number; y: number };
  /** Room bounding box (world tiles, x1 / y1 exclusive). */
  box: Box;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A wall / window / door segment of one tile edge (world metres). */
export interface PlanEdge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind: EdgeKind;
  /** On the building's outline (one side is outside). */
  outer: boolean;
}

/** A flight of stairs drawn on this floor (world tiles). */
export interface PlanStairs {
  /** Bottom tile (world). */
  x: number;
  y: number;
  dir: 'N' | 'E' | 'S' | 'W';
  len: number;
  /** `up`: the flight starts on this floor; `down`: it arrives from the floor below. */
  way: 'up' | 'down';
  /** Stairwell letter (A, B, …) of the flight. */
  well: string;
}

export interface FloorPlan {
  z: number;
  rooms: PlanRoom[];
  edges: PlanEdge[];
  stairs: PlanStairs[];
  box: Box;
}

export interface BuildingPlan {
  id: BuildingId;
  zMin: number;
  zMax: number;
  /** Footprint box over all floors (world tiles). */
  box: Box;
  floors: Map<number, FloorPlan>;
  /** Stairwells (clusters of flights), lettered A, B, … from north-west. */
  stairwells: number;
  /** Kind from the room types: `BLOK MIESZKALNY`, `DOM`, `SZKOŁA`, … */
  kind: string;
  /** Short kind for the map tag (`BLOK`, `DOM`). */
  tag: string;
}

/** Highest / lowest level scanned (the map format allows more; no building is that tall). */
const Z_LIMIT = 24;

const ROOM_LABELS: Readonly<Record<string, string>> = {
  'base:room-bedroom': 'sypialnia',
  'base:room-living-room': 'pokój',
  'base:room-kitchen': 'kuchnia',
  'base:room-bathroom': 'łaz.',
  'base:room-hall': 'przedp.',
  'base:room-office': 'biuro',
  'base:room-school': 'sala',
  'base:room-hospital': 'sala',
  'base:room-shop': 'sklep',
  'base:room-pharmacy': 'apteka',
  'base:room-garage': 'garaż',
  'base:room-warehouse': 'magazyn',
  'base:room-police': 'pokój',
  'base:room-gym': 'siłownia',
  'base:room-gas-station': 'stacja',
  'base:room-video-store': 'wypożycz.',
  'base:room-ruin': 'ruina',
  'base:room-church': 'kościół',
  'base:room-factory': 'hala',
  'base:room-fire-station': 'remiza',
};

/** Short Polish room label for the plan (`kuchnia`, `łaz.`); unknown types: none. */
export const roomLabel = (type: string): string => ROOM_LABELS[type] ?? '';

const RESIDENTIAL = new Set([
  'base:room-bedroom',
  'base:room-living-room',
  'base:room-kitchen',
  'base:room-bathroom',
]);
const KINDS: readonly [string, string, string][] = [
  ['base:room-school', 'SZKOŁA', 'SZKOŁA'],
  ['base:room-hospital', 'SZPITAL', 'SZPITAL'],
  ['base:room-police', 'KOMISARIAT', 'POLICJA'],
  ['base:room-pharmacy', 'APTEKA', 'APTEKA'],
  ['base:room-shop', 'SKLEP', 'SKLEP'],
  ['base:room-video-store', 'WYPOŻYCZALNIA', 'SKLEP'],
  ['base:room-gas-station', 'STACJA PALIW', 'STACJA'],
  ['base:room-gym', 'SIŁOWNIA', 'SIŁOWNIA'],
  ['base:room-warehouse', 'MAGAZYN', 'MAGAZYN'],
  ['base:room-garage', 'GARAŻ', 'GARAŻ'],
  ['base:room-office', 'BIUROWIEC', 'BIURA'],
  ['base:room-church', 'KOŚCIÓŁ', 'KOŚCIÓŁ'],
  ['base:room-fire-station', 'REMIZA', 'REMIZA'],
  ['base:room-factory', 'ZAKŁAD', 'ZAKŁAD'],
  ['base:room-ruin', 'RUINA', 'RUINA'],
];

/** Building kind from its room areas (largest non-residential use wins over flats). */
export function buildingKind(
  areaByType: ReadonlyMap<string, number>,
  zMax: number,
): { kind: string; tag: string } {
  let home = 0;
  for (const [t, a] of areaByType) if (RESIDENTIAL.has(t)) home += a;
  let best: { kind: string; tag: string; area: number } | undefined;
  for (const [type, kind, tag] of KINDS) {
    const a = areaByType.get(type) ?? 0;
    if (a > 0 && (!best || a > best.area)) best = { kind, tag, area: a };
  }
  if (best && best.area >= home) return { kind: best.kind, tag: best.tag };
  return zMax >= 2 ? { kind: 'BLOK MIESZKALNY', tag: 'BLOK' } : { kind: 'DOM', tag: 'DOM' };
}

interface Piece {
  key: RoomKey;
  type: string;
  tiles: number[]; // packed world tiles: index into the floor's tile map
}

/** Union-find over room piece keys (pieces of one room across chunk borders). */
class Union {
  private readonly parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    while (p !== (this.parent.get(p) ?? p)) p = this.parent.get(p) ?? p;
    this.parent.set(a, p);
    return p;
  }
  join(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

const chunkOf = (t: number) => Math.floor(t / CHUNK_SIZE);

/** Building at a world tile (0 = none) from a chunk. */
function roomAt(
  c: ChunkData | undefined,
  tx: number,
  ty: number,
): { room: number; building: number; type: string } | undefined {
  if (!c?.room || !c.rooms) return undefined;
  const lx = tx - c.coord.cx * CHUNK_SIZE;
  const ly = ty - c.coord.cy * CHUNK_SIZE;
  if (lx < 0 || ly < 0 || lx >= CHUNK_SIZE || ly >= CHUNK_SIZE) return undefined;
  const room = c.room[tileIndex(lx, ly)] ?? 0;
  if (room === 0) return undefined;
  const info = c.rooms.get(room);
  return info ? { room, building: info.buildingId, type: info.type } : undefined;
}

/**
 * Scans the floor `z` of building `id`: flood over chunks starting at `seeds` (chunk coords),
 * following the building across chunk borders. Undefined when the building has no tile there.
 */
function scanFloor(
  source: ChunkSource,
  id: BuildingId,
  z: number,
  seeds: Iterable<string>,
): { plan: FloorPlan; chunks: Set<string>; areaByType: Map<string, number> } | undefined {
  const chunks = new Map<string, ChunkData | undefined>();
  const get = (cx: number, cy: number): ChunkData | undefined => {
    const k = `${cx},${cy}`;
    if (!chunks.has(k)) chunks.set(k, source.getChunk(cx, cy, z));
    return chunks.get(k);
  };
  const owned = new Map<string, Piece>(); // tile "x,y" -> piece
  const pieces = new Map<RoomKey, Piece>();
  const queue = [...seeds];
  const seen = new Set<string>(queue);
  const used = new Set<string>();
  while (queue.length) {
    const k = queue.pop()!;
    const [cx, cy] = k.split(',').map(Number) as [number, number];
    const c = get(cx, cy);
    if (!c?.room || !c.rooms) continue;
    let any = false;
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const room = c.room[tileIndex(lx, ly)] ?? 0;
        if (room === 0) continue;
        const info = c.rooms.get(room);
        if (!info || info.buildingId !== id) continue;
        any = true;
        const key = roomKey(z, cx, cy, room);
        let p = pieces.get(key);
        if (!p) {
          p = { key, type: info.type, tiles: [] };
          pieces.set(key, p);
        }
        const tx = cx * CHUNK_SIZE + lx;
        const ty = cy * CHUNK_SIZE + ly;
        owned.set(`${tx},${ty}`, p);
        // The building goes on past the chunk border: scan the neighbour too.
        const next = [
          lx === 0 ? [cx - 1, cy] : undefined,
          lx === CHUNK_SIZE - 1 ? [cx + 1, cy] : undefined,
          ly === 0 ? [cx, cy - 1] : undefined,
          ly === CHUNK_SIZE - 1 ? [cx, cy + 1] : undefined,
        ];
        for (const n of next) {
          if (!n) continue;
          const nk = `${n[0]},${n[1]}`;
          if (!seen.has(nk)) {
            seen.add(nk);
            queue.push(nk);
          }
        }
      }
    }
    if (any) used.add(k);
  }
  if (!owned.size) return undefined;

  // Merge pieces of one room across chunk borders (touching, same type).
  const union = new Union();
  for (const [t, p] of owned) {
    const [x, y] = t.split(',').map(Number) as [number, number];
    for (const [nx, ny] of [
      [x + 1, y],
      [x, y + 1],
    ] as const) {
      if (chunkOf(nx) === chunkOf(x) && chunkOf(ny) === chunkOf(y)) continue;
      const q = owned.get(`${nx},${ny}`);
      if (q && q !== p && q.type === p.type) union.join(p.key, q.key);
    }
  }
  const groups = new Map<string, { parts: Piece[]; tiles: [number, number][] }>();
  for (const [t, p] of owned) {
    const root = union.find(p.key);
    let g = groups.get(root);
    if (!g) {
      g = { parts: [], tiles: [] };
      groups.set(root, g);
    }
    if (!g.parts.includes(p)) g.parts.push(p);
    g.tiles.push(t.split(',').map(Number) as [number, number]);
  }
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const areaByType = new Map<string, number>();
  const rooms: PlanRoom[] = [];
  for (const g of groups.values()) {
    g.parts.sort((a, b) => (a.key < b.key ? -1 : 1));
    const rb: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const rows = new Map<number, number[]>();
    for (const [x, y] of g.tiles) {
      rb.x0 = Math.min(rb.x0, x);
      rb.y0 = Math.min(rb.y0, y);
      rb.x1 = Math.max(rb.x1, x + 1);
      rb.y1 = Math.max(rb.y1, y + 1);
      const r = rows.get(y) ?? [];
      r.push(x);
      rows.set(y, r);
    }
    const runs: PlanRoom['runs'] = [];
    for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
      xs.sort((a, b) => a - b);
      let s = xs[0]!;
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === xs[i - 1]! + 1) continue;
        runs.push({ y, x0: s, x1: xs[i - 1]! + 1 });
        if (i < xs.length) s = xs[i]!;
      }
    }
    const mx = (rb.x0 + rb.x1) / 2;
    const my = (rb.y0 + rb.y1) / 2;
    let label = g.tiles[0]!;
    for (const t of g.tiles) {
      if (
        Math.hypot(t[0] + 0.5 - mx, t[1] + 0.5 - my) <
        Math.hypot(label[0] + 0.5 - mx, label[1] + 0.5 - my)
      )
        label = t;
    }
    const first = g.parts[0]!;
    rooms.push({
      key: first.key,
      parts: g.parts.map((p) => {
        const [, cx, cy, room] = p.key.split(':').map(Number) as [number, number, number, number];
        return { cx, cy, room };
      }),
      type: first.type,
      area: g.tiles.length,
      runs,
      label: { x: label[0] + 0.5, y: label[1] + 0.5 },
      box: rb,
    });
    areaByType.set(first.type, (areaByType.get(first.type) ?? 0) + g.tiles.length);
    box.x0 = Math.min(box.x0, rb.x0);
    box.y0 = Math.min(box.y0, rb.y0);
    box.x1 = Math.max(box.x1, rb.x1);
    box.y1 = Math.max(box.y1, rb.y1);
  }
  rooms.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);

  // Edges: every wall / window / door edge touching a building tile.
  const edges: PlanEdge[] = [];
  const palette = source.edgePalette ?? [];
  const done = new Set<string>();
  const inside = (x: number, y: number) => owned.has(`${x},${y}`);
  const edgeAt = (x: number, y: number, side: 'N' | 'W') => {
    const c = get(chunkOf(x), chunkOf(y));
    const layer = side === 'N' ? c?.edgeN : c?.edgeW;
    if (!layer) return undefined;
    const id = layer[tileIndex(x - chunkOf(x) * CHUNK_SIZE, y - chunkOf(y) * CHUNK_SIZE)] ?? 0;
    return id ? (palette[id] ?? undefined) : undefined;
  };
  const addEdge = (x: number, y: number, side: 'N' | 'W') => {
    const k = `${x},${y},${side}`;
    if (done.has(k)) return;
    done.add(k);
    const def = edgeAt(x, y, side);
    if (!def) return;
    const other = side === 'N' ? inside(x, y - 1) : inside(x - 1, y);
    const outer = !(inside(x, y) && other);
    edges.push(
      side === 'N'
        ? { x0: x, y0: y, x1: x + 1, y1: y, kind: def.kind, outer }
        : { x0: x, y0: y, x1: x, y1: y + 1, kind: def.kind, outer },
    );
  };
  for (const t of owned.keys()) {
    const [x, y] = t.split(',').map(Number) as [number, number];
    addEdge(x, y, 'N');
    addEdge(x, y, 'W');
    addEdge(x, y + 1, 'N');
    addEdge(x + 1, y, 'W');
  }

  // Stairs: flights starting on this floor (in the building's chunks).
  const stairs: PlanStairs[] = [];
  for (const k of used) {
    const [cx, cy] = k.split(',').map(Number) as [number, number];
    for (const s of get(cx, cy)?.stairs ?? []) {
      const x = cx * CHUNK_SIZE + s.tx;
      const y = cy * CHUNK_SIZE + s.ty;
      const r = roomAt(get(cx, cy), x, y);
      if (r?.building !== id) continue;
      stairs.push({ x, y, dir: s.dir, len: s.len, way: 'up', well: '' });
    }
  }
  return { plan: { z, rooms, edges, stairs, box }, chunks: used, areaByType };
}

const step = (dir: PlanStairs['dir']) =>
  dir === 'N' ? [0, -1] : dir === 'S' ? [0, 1] : dir === 'E' ? [1, 0] : [-1, 0];

/** Tiles a flight covers (bottom tile first). */
export function stairTiles(s: Pick<PlanStairs, 'x' | 'y' | 'dir' | 'len'>): [number, number][] {
  const [dx, dy] = step(s.dir) as [number, number];
  return Array.from({ length: Math.max(1, s.len) }, (_, i) => [s.x + dx * i, s.y + dy * i]);
}

/**
 * Plan of building `id` around world tile (x, y) on level z (any level of the building), or
 * undefined when there is no building there. Reads only the chunks the building covers.
 */
export function scanBuilding(
  source: ChunkSource,
  id: BuildingId,
  x: number,
  y: number,
  z: number,
): BuildingPlan | undefined {
  const seed = `${chunkOf(Math.floor(x))},${chunkOf(Math.floor(y))}`;
  const start = scanFloor(source, id, z, [seed]);
  if (!start) return undefined;
  const floors = new Map<number, FloorPlan>([[z, start.plan]]);
  const area = new Map(start.areaByType);
  const add = (m: Map<string, number>) => {
    for (const [t, a] of m) area.set(t, (area.get(t) ?? 0) + a);
  };
  for (const dir of [1, -1]) {
    let seeds = start.chunks;
    for (let lz = z + dir; Math.abs(lz) <= Z_LIMIT; lz += dir) {
      const f = scanFloor(source, id, lz, seeds);
      if (!f) break;
      floors.set(lz, f.plan);
      add(f.areaByType);
      seeds = new Set([...seeds, ...f.chunks]);
    }
  }
  const zs = [...floors.keys()];
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const f of floors.values()) {
    box.x0 = Math.min(box.x0, f.box.x0);
    box.y0 = Math.min(box.y0, f.box.y0);
    box.x1 = Math.max(box.x1, f.box.x1);
    box.y1 = Math.max(box.y1, f.box.y1);
  }
  // Stairwells: flights clustered by their centre (4 m), lettered from the north-west.
  const centre = (s: PlanStairs) => {
    const t = stairTiles(s);
    const a = t[0]!;
    const b = t[t.length - 1]!;
    return { x: (a[0] + b[0]) / 2 + 0.5, y: (a[1] + b[1]) / 2 + 0.5 };
  };
  const wells: { x: number; y: number }[] = [];
  const wellOf = (s: PlanStairs): number => {
    const c = centre(s);
    let i = wells.findIndex((w) => Math.hypot(w.x - c.x, w.y - c.y) <= 4);
    if (i < 0) {
      wells.push(c);
      i = wells.length - 1;
    }
    return i;
  };
  for (const f of floors.values()) for (const s of f.stairs) wellOf(s);
  const order = wells
    .map((w, i) => ({ w, i }))
    .sort((a, b) => a.w.y - b.w.y || a.w.x - b.w.x)
    .map((e) => e.i);
  const letter = (s: PlanStairs) => String.fromCharCode(65 + order.indexOf(wellOf(s)));
  for (const f of floors.values()) for (const s of f.stairs) s.well = letter(s);
  // Flights arriving from the floor below are drawn on this floor too (the stair opening).
  for (const [lz, f] of floors) {
    const below = floors.get(lz - 1);
    if (!below) continue;
    for (const s of below.stairs) if (s.way === 'up') f.stairs.push({ ...s, way: 'down' });
  }
  const kind = buildingKind(area, zMax);
  return { id, zMin, zMax, box, floors, stairwells: wells.length, ...kind };
}
