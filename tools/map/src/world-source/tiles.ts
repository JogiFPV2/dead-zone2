import { CHUNK_SIZE } from '@deadzone/content';
import type { OsmMap, OsmPlace } from '../osm/types.js';
import { PlanChunkGenerator } from './generator.js';
import { GENERATOR_REV, type WorldPlanInput } from './plan.js';
import {
  OSM_ROTATION_DEG,
  OSM_WORLD_SIZE,
  rotation,
  rotatePt,
  straightenOsmMap,
  unrotatePt,
} from './straighten.js';

/**
 * The whole OSM square as lazily loaded tiles (`deadzone-osm-tiles-1`): a small manifest (places,
 * zone kinds of every chunk, tile list) plus one raw-frame `deadzone-osm-1` file per 1024 m tile of
 * the world frame. A feature goes into every tile its (rotated) bounding box touches; buildings
 * carry their global `gid` and the other layers their file rank `ord`, so the generator gives the
 * same chunks whatever order the tiles arrive in. A chunk is generated only once the 3 × 3 tiles
 * around its own are in (no feature is 1 km long across a chunk it does not reach).
 */
export const OSM_TILES_FORMAT = 'deadzone-osm-tiles-1';
/** Tile edge in the world frame (tiles = metres): 32 chunks. */
export const OSM_TILE_SIZE = 1024;

export interface OsmTileRef {
  tx: number;
  ty: number;
  file: string;
  bytes: number;
  sha256: string;
}

export interface OsmTileManifest {
  format: typeof OSM_TILES_FORMAT;
  crs: OsmMap['crs'];
  E0: number;
  N1: number;
  /** Raw square edge (16 384). */
  size: number;
  attribution: OsmMap['attribution'];
  license: OsmMap['license'];
  source: string;
  worldSize: number;
  rotationDeg: number;
  tileSize: number;
  /** World id (plan `id` / version prefix; default `osm-stw`) and spawn (world tiles), map2. */
  id?: string;
  start?: { x: number; y: number };
  /** Named places of the whole square (raw frame, decimetres). */
  places: OsmPlace[];
  /** Zone kind of every world chunk (row-major, `CHUNK_KINDS` index), run-length + base64. */
  kinds: string;
  tiles: OsmTileRef[];
  /** Hash of all tile hashes + places (the data version). */
  dataHash: string;
}

const emptyMap = (
  m: Pick<OsmMap, 'crs' | 'E0' | 'N1' | 'size' | 'attribution' | 'license' | 'source'>,
): OsmMap => ({
  format: 'deadzone-osm-1',
  crs: m.crs,
  E0: m.E0,
  N1: m.N1,
  size: m.size,
  attribution: m.attribution,
  license: m.license,
  source: m.source,
  roads: [],
  rails: [],
  power: [],
  railNodes: [],
  waterways: [],
  areas: [],
  buildings: [],
  trees: [],
  treeRows: [],
  pois: [],
  places: [],
});

/** Run-length (count ≤ 255, value) bytes of a Uint8Array, base64. */
export function packKinds(k: Uint8Array): string {
  const out: number[] = [];
  for (let i = 0; i < k.length;) {
    let n = 1;
    while (n < 255 && i + n < k.length && k[i + n] === k[i]) n++;
    out.push(n, k[i]!);
    i += n;
  }
  let s = '';
  for (const b of out) s += String.fromCharCode(b);
  return btoa(s);
}

export function unpackKinds(b64: string, n: number): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 0; i + 1 < s.length; i += 2) {
    const c = s.charCodeAt(i);
    out.fill(s.charCodeAt(i + 1), o, o + c);
    o += c;
  }
  return out;
}

/** Margin (m) of a clipped piece around its tile. */
const CLIP_MARGIN = 64;

type Box = { x0: number; y0: number; x1: number; y1: number };

/**
 * A closed raw-frame ring (decimetres) clipped to a world-frame box (Sutherland–Hodgman in the
 * world frame, back to the raw frame); empty when outside. Even-odd fill inside the box is the
 * same as the whole ring's.
 */
function clipRing(r: ReturnType<typeof rotation>, ring: readonly number[], b: Box): number[] {
  let pts: [number, number][] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const p = rotatePt(r, ring[i]! / 10, ring[i + 1]! / 10);
    pts.push([p.x, p.y]);
  }
  if (pts.length > 1) {
    const a = pts[0]!;
    const z = pts[pts.length - 1]!;
    if (a[0] === z[0] && a[1] === z[1]) pts.pop();
  }
  const edges: [
    (p: [number, number]) => boolean,
    (a: [number, number], c: [number, number]) => [number, number],
  ][] = [
    [(p) => p[0] >= b.x0, (a, c) => [b.x0, a[1] + ((c[1] - a[1]) * (b.x0 - a[0])) / (c[0] - a[0])]],
    [(p) => p[0] <= b.x1, (a, c) => [b.x1, a[1] + ((c[1] - a[1]) * (b.x1 - a[0])) / (c[0] - a[0])]],
    [(p) => p[1] >= b.y0, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y0 - a[1])) / (c[1] - a[1]), b.y0]],
    [(p) => p[1] <= b.y1, (a, c) => [a[0] + ((c[0] - a[0]) * (b.y1 - a[1])) / (c[1] - a[1]), b.y1]],
  ];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!;
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    pts = out;
  }
  if (pts.length < 3) return [];
  const flat: number[] = [];
  for (const [x, y] of pts) {
    const q = unrotatePt(r, x, y);
    flat.push(Math.round(q.x * 10), Math.round(q.y * 10));
  }
  flat.push(flat[0]!, flat[1]!);
  return flat;
}

/** Runs of a raw-frame polyline whose segments come within `pad` of a world-frame box. */
function clipLine(
  r: ReturnType<typeof rotation>,
  f: readonly number[],
  b: Box,
  pad: number,
): number[][] {
  const out: number[][] = [];
  let run: number[] | undefined;
  for (let i = 0; i + 3 < f.length; i += 2) {
    const p = rotatePt(r, f[i]! / 10, f[i + 1]! / 10);
    const q = rotatePt(r, f[i + 2]! / 10, f[i + 3]! / 10);
    const hit =
      Math.max(p.x, q.x) >= b.x0 - pad &&
      Math.min(p.x, q.x) <= b.x1 + pad &&
      Math.max(p.y, q.y) >= b.y0 - pad &&
      Math.min(p.y, q.y) <= b.y1 + pad;
    if (hit) {
      if (!run) out.push((run = [f[i]!, f[i + 1]!]));
      run.push(f[i + 2]!, f[i + 3]!);
    } else run = undefined;
  }
  return out;
}

/** Bounds of the whole world square in chunks. */
export const osmWorldBounds = (worldSize = OSM_WORLD_SIZE) => {
  const n = worldSize / CHUNK_SIZE;
  return { cx0: 0, cy0: 0, cx1: n - 1, cy1: n - 1 };
};

/**
 * Splits the whole map into tiles (pure; the CLI adds hashes and writes the files). Returns the
 * manifest without `tiles` hashes / `dataHash` and the tile maps by key `tx,ty`.
 */
export function splitOsmMap(
  map: OsmMap,
  opts: { tileSize?: number; rotationDeg?: number; worldSize?: number } = {},
): { tiles: Map<string, OsmMap>; kinds: Uint8Array } {
  const T = opts.tileSize ?? OSM_TILE_SIZE;
  const deg = opts.rotationDeg ?? OSM_ROTATION_DEG;
  const W = opts.worldSize ?? OSM_WORLD_SIZE;
  const r = rotation(deg);
  const nT = Math.ceil(W / T);
  const tiles = new Map<string, OsmMap>();
  const tile = (tx: number, ty: number) => {
    const k = `${tx},${ty}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = emptyMap(map)));
    return t;
  };
  /** Tiles touched by the rotated bounding box of a flat decimetre array (+ pad tiles). */
  const touched = (f: readonly number[], pad = 0): [number, number][] => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i + 1 < f.length; i += 2) {
      const p = rotatePt(r, f[i]! / 10, f[i + 1]! / 10);
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    const out: [number, number][] = [];
    const a = Math.max(0, Math.floor((x0 - pad) / T));
    const b = Math.min(nT - 1, Math.floor((x1 + pad) / T));
    const c = Math.max(0, Math.floor((y0 - pad) / T));
    const d = Math.min(nT - 1, Math.floor((y1 + pad) / T));
    for (let ty = c; ty <= d; ty++) for (let tx = a; tx <= b; tx++) out.push([tx, ty]);
    return out;
  };
  map.roads.forEach((x, ord) => {
    for (const [tx, ty] of touched(x.pts, x.width / 2 + x.sidewalk + 1))
      tile(tx, ty).roads.push({ ...x, ord });
  });
  map.rails.forEach((x, ord) => {
    for (const [tx, ty] of touched(x.pts, 3)) tile(tx, ty).rails.push({ ...x, ord });
  });
  (map.power ?? []).forEach((x, ord) => {
    for (const [tx, ty] of touched(x.pts, 8)) tile(tx, ty).power!.push({ ...x, ord });
  });
  for (const n of map.railNodes ?? []) {
    for (const [tx, ty] of touched([n.x, n.y])) tile(tx, ty).railNodes!.push(n);
  }
  // Large rivers and areas (over 2 × 2 tiles): one clipped piece per tile instead of copies.
  const box = (tx: number, ty: number) => ({
    x0: tx * T - CLIP_MARGIN,
    y0: ty * T - CLIP_MARGIN,
    x1: (tx + 1) * T + CLIP_MARGIN,
    y1: (ty + 1) * T + CLIP_MARGIN,
  });
  map.waterways.forEach((x, ord) => {
    const ts = touched(x.pts, x.width / 2 + 1);
    for (const [tx, ty] of ts) {
      if (ts.length <= 4) {
        tile(tx, ty).waterways.push({ ...x, ord });
        continue;
      }
      clipLine(r, x.pts, box(tx, ty), x.width / 2 + 1).forEach((pts, k) =>
        tile(tx, ty).waterways.push({ ...x, ord, part: (ty * nT + tx) * 64 + k, pts }),
      );
    }
  });
  map.areas.forEach((x, ord) => {
    const ts = touched(x.rings.flat());
    for (const [tx, ty] of ts) {
      if (ts.length <= 4) {
        tile(tx, ty).areas.push({ ...x, ord });
        continue;
      }
      const rings = x.rings.map((g) => clipRing(r, g, box(tx, ty))).filter((g) => g.length >= 8);
      if (rings.length) tile(tx, ty).areas.push({ ...x, ord, part: ty * nT + tx, rings });
    }
  });
  const gids = new Map([...map.buildings].sort((a, b) => a.id - b.id).map((b, i) => [b.id, i + 1]));
  for (const b of map.buildings) {
    for (const [tx, ty] of touched(b.rings.flat()))
      tile(tx, ty).buildings.push({ ...b, gid: gids.get(b.id)! });
  }
  // Points: exactly one tile each; tree rows become trees every 7 m (as the index spaces them).
  const point = (x: number, y: number) => {
    const p = rotatePt(r, x / 10, y / 10);
    const tx = Math.floor(p.x / T);
    const ty = Math.floor(p.y / T);
    return tx >= 0 && ty >= 0 && tx < nT && ty < nT ? tile(tx, ty) : undefined;
  };
  for (let i = 0; i + 1 < map.trees.length; i += 2)
    point(map.trees[i]!, map.trees[i + 1]!)?.trees.push(map.trees[i]!, map.trees[i + 1]!);
  for (const row of map.treeRows) {
    for (let k = 2; k + 1 < row.length; k += 2) {
      const ax = row[k - 2]!;
      const ay = row[k - 1]!;
      const bx = row[k]!;
      const by = row[k + 1]!;
      const l = Math.hypot(bx - ax, by - ay) / 10;
      for (let d = 0; d < l; d += 7) {
        const x = Math.round(ax + ((bx - ax) * d) / l);
        const y = Math.round(ay + ((by - ay) * d) / l);
        point(x, y)?.trees.push(x, y);
      }
    }
  }
  for (const p of map.pois) point(p.x, p.y)?.pois.push(p);
  // Zone kinds of every chunk from the tiles themselves (the lazily loading game cannot compute
  // them before every tile is in).
  const gen = new PlanChunkGenerator(
    tiledPlanInput(map, { dataHash: 'split', worldSize: W, rotationDeg: deg }),
  );
  for (const t of tiles.values()) gen.index.addFeatures(straightenOsmMap(t, deg));
  return { tiles, kinds: gen.computeKinds() };
}

/** World plan of the tiled map (features: `full` when given, else only places; tiles add the rest). */
export function tiledPlanInput(
  m: Pick<OsmMap, 'size' | 'attribution' | 'places'>,
  opts: {
    dataHash: string;
    worldSize?: number;
    rotationDeg?: number;
    id?: string;
    start?: { x: number; y: number };
    chunkKinds?: Uint8Array;
  },
  full?: OsmMap,
): WorldPlanInput {
  const deg = opts.rotationDeg ?? OSM_ROTATION_DEG;
  const W = opts.worldSize ?? OSM_WORLD_SIZE;
  const base = full ?? { ...emptyMap(m as OsmMap), places: m.places };
  const start =
    opts.start ??
    (() => {
      const s = rotatePt(rotation(deg), 6290, 8520);
      return { x: Math.round(s.x), y: Math.round(s.y) };
    })();
  const id = opts.id ?? 'osm-stw';
  return {
    id,
    version: `${id}-${opts.dataHash.slice(0, 12)}-all-g${GENERATOR_REV}`,
    seed: 0x05f3a1,
    size: W,
    bounds: osmWorldBounds(W),
    features: straightenOsmMap(base, deg),
    start,
    attribution: m.attribution,
    ...(opts.chunkKinds ? { chunkKinds: opts.chunkKinds } : {}),
  };
}

/**
 * Lazily loading OSM world: the generator starts with places and zone kinds only; `ensure(cx, cy)`
 * loads the 3 × 3 tiles around a chunk (each once) and indexes them. `ready(cx, cy)` tells
 * whether a chunk can be generated now.
 */
export class OsmTiles {
  readonly generator: PlanChunkGenerator;
  private readonly loaded = new Set<string>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly files = new Map<string, string>();
  /** Tile fetch + index timings (perf report). */
  readonly stats = { tiles: 0, bytes: 0, ms: 0 };

  constructor(
    readonly manifest: OsmTileManifest,
    private readonly fetchTile: (file: string) => Promise<OsmMap>,
    start?: { x: number; y: number },
  ) {
    const n = (manifest.worldSize / CHUNK_SIZE) ** 2;
    this.generator = new PlanChunkGenerator(
      tiledPlanInput(manifest, {
        dataHash: manifest.dataHash,
        worldSize: manifest.worldSize,
        rotationDeg: manifest.rotationDeg,
        chunkKinds: unpackKinds(manifest.kinds, n),
        ...(manifest.id ? { id: manifest.id } : {}),
        ...((start ?? manifest.start) ? { start: start ?? manifest.start } : {}),
      }),
    );
    for (const t of manifest.tiles) this.files.set(`${t.tx},${t.ty}`, t.file);
  }

  private tilesAround(cx: number, cy: number): string[] {
    const T = this.manifest.tileSize;
    const tx = Math.floor((cx * CHUNK_SIZE) / T);
    const ty = Math.floor((cy * CHUNK_SIZE) / T);
    const out: string[] = [];
    for (let y = ty - 1; y <= ty + 1; y++)
      for (let x = tx - 1; x <= tx + 1; x++) if (this.files.has(`${x},${y}`)) out.push(`${x},${y}`);
    return out;
  }

  ready(cx: number, cy: number): boolean {
    return this.tilesAround(cx, cy).every((k) => this.loaded.has(k));
  }

  /** Loads the tiles a chunk needs (resolves at once when they are in). */
  ensure(cx: number, cy: number): Promise<void> {
    const need = this.tilesAround(cx, cy).filter((k) => !this.loaded.has(k));
    if (!need.length) return Promise.resolve();
    return Promise.all(need.map((k) => this.load(k))).then(() => undefined);
  }

  /** Every tile (background fill after the start). */
  ensureAll(): Promise<void> {
    return Promise.all([...this.files.keys()].map((k) => this.load(k))).then(() => undefined);
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  private load(key: string): Promise<void> {
    let p = this.loading.get(key);
    if (p) return p;
    const file = this.files.get(key)!;
    p = this.fetchTile(file).then((m) => {
      const t0 = performance.now();
      this.generator.index.addFeatures(straightenOsmMap(m, this.manifest.rotationDeg));
      this.loaded.add(key);
      this.stats.tiles++;
      this.stats.ms += performance.now() - t0;
    });
    this.loading.set(key, p);
    return p;
  }
}
