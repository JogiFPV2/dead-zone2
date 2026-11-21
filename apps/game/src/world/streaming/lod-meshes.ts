import { BufferGeometry, Color, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import {
  CHUNK_SIZE,
  EMPTY_TILE,
  type BuildingId,
  type ChunkData,
  type EdgeDef,
  type TileId,
} from '../chunk.js';
import { LEVEL_HEIGHT } from '../instances.js';
import {
  ROOF_THICKNESS,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WINDOW_HEIGHT,
} from '../structure-instances.js';
import { STRUCTURE_GREYS } from '../structures.js';
import { tileGrey } from '../terrain.js';
import { SUMMARY_CELLS, type BuildingMeta, type ChunkSummary, type WorldChunk } from './source.js';

/**
 * Ground colours of the mid / far LOD by floor content (the town kit cells of the near terrain:
 * `town.json` / `skins.ts`), so distant water, grass and roads read like the near ring instead of
 * placeholder greys. Floors not listed (indoor, roofs) keep `tileGrey`.
 */
export const LOD_GROUND: Readonly<Record<string, string>> = {
  'base:grass': '#2c3a2f',
  'base:dirt': '#3f362c',
  'base:concrete': '#4a4d48',
  'base:sidewalk': '#50554f',
  'base:parking': '#2f3436',
  'base:asphalt': '#33383a',
  'base:rail': '#3c4446',
  'base:water': '#2c4650',
};
/** Grass under trees (forest, park with trees) in the mid / far LOD: the near ring's dark canopy. */
export const LOD_FOREST = '#1d2a1f';
/** Trees per SUMMARY cell (4 × 4 tiles) from which grass there reads as forest. */
export const FOREST_TREES_PER_CELL = 2;

/** Floor palette of a source (TileId → content id); undefined = placeholder greys only. */
export type TilePalette = readonly (string | null)[] | undefined;

/** LOD colour of a floor TileId: the content's ground colour, else the placeholder grey. */
export function lodGroundColor(id: TileId, palette: TilePalette, forest = false): string {
  const c = palette?.[id];
  if (forest && c === 'base:grass') return LOD_FOREST;
  return (c && LOD_GROUND[c]) || tileGrey(id);
}

/** SUMMARY_CELLS² flags: cells (4 × 4 tiles) with enough trees on the ground level. */
export function forestCells(chunk: WorldChunk): Uint8Array | undefined {
  if (!chunk.decor?.length) return undefined;
  const n = SUMMARY_CELLS;
  const cell = CHUNK_SIZE / n;
  const count = new Uint8Array(n * n);
  for (const d of chunk.decor) {
    if (d.z !== 0 || !/tree/.test(d.kind)) continue;
    const x = Math.min(n - 1, Math.max(0, Math.floor(d.x / cell)));
    const y = Math.min(n - 1, Math.max(0, Math.floor(d.y / cell)));
    if (count[y * n + x]! < 255) count[y * n + x]!++;
  }
  let any = false;
  for (let i = 0; i < count.length; i++) {
    count[i] = count[i]! >= FOREST_TREES_PER_CELL ? 1 : 0;
    if (count[i]) any = true;
  }
  return any ? count : undefined;
}

/** Fences in the mid LOD: a low slab (near draws them as openings with state). */
const FENCE_LOD_HEIGHT = 1;

/** Growable position / colour buffers of a merged, non-indexed, flat-shaded mesh. */
class MeshWriter {
  pos: number[] = [];
  col: number[] = [];
  private readonly color = new Color();
  private r = 1;
  private g = 1;
  private b = 1;

  setColor(css: string): void {
    // Linear working space (vertex colours are not colour-managed).
    this.color.set(css);
    this.r = this.color.r;
    this.g = this.color.g;
    this.b = this.color.b;
  }

  private v(x: number, y: number, z: number): void {
    this.pos.push(x, y, z);
    this.col.push(this.r, this.g, this.b);
  }

  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: V, b: V, c: V, d: V): void {
    this.v(...a);
    this.v(...b);
    this.v(...c);
    this.v(...a);
    this.v(...c);
    this.v(...d);
  }

  /** Horizontal triangle (x, z pairs) at height y, wound to face up. */
  flatTri(
    a: readonly [number, number],
    b: readonly [number, number],
    c: readonly [number, number],
    y: number,
  ): void {
    const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const [p, q, r] = ny >= 0 ? [a, b, c] : [a, c, b];
    this.v(p[0], y, p[1]);
    this.v(q[0], y, q[1]);
    this.v(r[0], y, r[1]);
  }

  /** Horizontal quad facing up over [x0, x1] × [z0, z1] at height y. */
  floor(x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]);
  }

  /** Axis-aligned box without its bottom face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.floor(x0, z0, x1, z1, y1);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +Z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -Z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +X
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -X
  }

  get triangles(): number {
    return this.pos.length / 9;
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}
type V = [number, number, number];

/** Same-id runs along each row of a CHUNK_SIZE² layer (merges floor / roof quads). */
function rowRuns(
  layer: Uint16Array,
  each: (id: TileId, x0: number, x1: number, y: number) => void,
): void {
  for (let y = 0; y < CHUNK_SIZE; y++) {
    let start = 0;
    for (let x = 1; x <= CHUNK_SIZE; x++) {
      const prev = layer[y * CHUNK_SIZE + start] ?? EMPTY_TILE;
      const cur = x < CHUNK_SIZE ? (layer[y * CHUNK_SIZE + x] ?? EMPTY_TILE) : -1;
      if (cur === prev) continue;
      if (prev !== EMPTY_TILE) each(prev, start, x, y);
      start = x;
    }
  }
}

export interface LodGeometry {
  geometry: BufferGeometry;
  triangles: number;
  bytes: number;
}

const finish = (w: MeshWriter): LodGeometry | undefined => {
  if (w.triangles === 0) return undefined;
  const geometry = w.geometry();
  // position + normal + colour, 3 floats each per vertex.
  return { geometry, triangles: w.triangles, bytes: w.pos.length * 4 * 3 };
};

/**
 * Mid LOD (vertices relative to the chunk origin `cx · 32, cy · 32`): one merged mesh per chunk (all levels) — floor runs, walls / windows at full height
 * (no cutaway, no doors), roof runs; no map objects or decor. Same placeholder colours as near.
 */
export function buildMidGeometry(
  chunk: WorldChunk,
  edgePalette: readonly (EdgeDef | null)[] | undefined,
  tilePalette?: TilePalette,
): LodGeometry | undefined {
  const w = new MeshWriter();
  // Vertices relative to the chunk origin (the mesh sits at it: floating origin, float32 buffers).
  const ox = 0;
  const oz = 0;
  const forest = tilePalette ? forestCells(chunk) : undefined;
  const cell = CHUNK_SIZE / SUMMARY_CELLS;
  // Generated maps: smooth areas / roads over the ground, outlined buildings as prisms.
  const vector = hasVector(chunk);
  const outlined = outlinedOf(chunk);
  for (const [z, data] of chunk.levels) {
    const y = z * LEVEL_HEIGHT;
    const skip = (i: number) => outlined.has(buildingAt(data, i));
    // Runs of one colour per row (a run splits where the forest flag of its cell changes).
    const colorAt = (i: number): string | undefined => {
      if (z > 0 && skip(i)) return undefined;
      const id =
        (z === 0 && vector ? chunk.under?.[i] || undefined : undefined) ??
        data.floor[i] ??
        EMPTY_TILE;
      if (id === EMPTY_TILE) return undefined;
      const x = i % CHUNK_SIZE;
      const row = Math.floor(i / CHUNK_SIZE);
      const f =
        z === 0 && !!forest?.[Math.floor(row / cell) * SUMMARY_CELLS + Math.floor(x / cell)];
      return tilePalette ? lodGroundColor(id, tilePalette, f) : tileGrey(id);
    };
    for (let row = 0; row < CHUNK_SIZE; row++) {
      let start = 0;
      let prev = colorAt(row * CHUNK_SIZE);
      for (let x = 1; x <= CHUNK_SIZE; x++) {
        const cur = x < CHUNK_SIZE ? colorAt(row * CHUNK_SIZE + x) : '';
        if (cur === prev) continue;
        if (prev) {
          w.setColor(prev);
          w.floor(ox + start, oz + row, ox + x, oz + row + 1, y);
        }
        start = x;
        prev = cur;
      }
    }
    writeEdges(w, data, edgePalette, ox, oz, y, outlined.size ? skip : undefined);
    if (data.roof) {
      w.setColor(STRUCTURE_GREYS.roof);
      const top = y + WALL_HEIGHT;
      const roof = outlined.size ? data.roof.map((v, i) => (skip(i) ? EMPTY_TILE : v)) : data.roof;
      rowRuns(roof, (_id, x0, x1, row) =>
        w.box(ox + x0, top, oz + row, ox + x1, top + ROOF_THICKNESS, oz + row + 1),
      );
    }
  }
  if (vector) writeVectorGround(w, chunk, tilePalette);
  writeOutlined(w, chunk, outlined);
  return finish(w);
}

function writeEdges(
  w: MeshWriter,
  data: ChunkData,
  palette: readonly (EdgeDef | null)[] | undefined,
  ox: number,
  oz: number,
  y: number,
  skip?: (i: number) => boolean,
): void {
  const t = WALL_THICKNESS / 2;
  const layers: [Uint16Array | undefined, boolean][] = [
    [data.edgeN, true],
    [data.edgeW, false],
  ];
  for (const [layer, north] of layers) {
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const kind = palette?.[layer[i] ?? 0]?.kind;
      if (!kind || kind === 'door') continue;
      // Outlined buildings are drawn as prisms on their outline (either side of the edge).
      if (skip && (skip(i) || skip(north ? i - CHUNK_SIZE : i - 1))) continue;
      w.setColor(STRUCTURE_GREYS[kind]);
      const h =
        kind === 'window' ? WINDOW_HEIGHT : kind === 'fence' ? FENCE_LOD_HEIGHT : WALL_HEIGHT;
      const tx = ox + (i % CHUNK_SIZE);
      const tz = oz + Math.floor(i / CHUNK_SIZE);
      if (north) w.box(tx - t, y, tz - t, tx + 1 + t, y + h, tz + t);
      else w.box(tx - t, y, tz - t, tx + t, y + h, tz + 1 + t);
    }
  }
}

/** Coarse summary of a full chunk (dominant floor and building height per cell). */
export function summarize(chunk: WorldChunk, skip?: ReadonlySet<BuildingId>): ChunkSummary {
  const n = SUMMARY_CELLS;
  const cell = CHUNK_SIZE / n;
  const ground = new Uint16Array(n * n);
  const height = new Uint8Array(n * n);
  const counts = new Map<TileId, number>();
  const base = chunk.levels.get(0) ?? chunk.levels.values().next().value;
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      counts.clear();
      let h = 0;
      for (const [z, lv] of chunk.levels) {
        let roofs = 0;
        for (let y = cy * cell; y < (cy + 1) * cell; y++) {
          for (let x = cx * cell; x < (cx + 1) * cell; x++) {
            const i = y * CHUNK_SIZE + x;
            if (lv === base) {
              const id = lv.floor[i] ?? EMPTY_TILE;
              if (id !== EMPTY_TILE) counts.set(id, (counts.get(id) ?? 0) + 1);
            }
            if ((lv.roof?.[i] ?? 0) !== 0 && !skip?.has(buildingAt(lv, i))) roofs++;
          }
        }
        // Built-up when at least a third of the cell is under a roof on that level.
        if (roofs * 3 >= cell * cell) h = Math.max(h, z + 1);
      }
      let best: TileId = EMPTY_TILE;
      let bestN = 0;
      for (const [id, c] of counts) {
        if (c > bestN || (c === bestN && id < best)) {
          best = id;
          bestN = c;
        }
      }
      ground[cy * n + cx] = best;
      height[cy * n + cx] = h;
    }
  }
  const forest = forestCells(chunk);
  return { cx: chunk.cx, cy: chunk.cy, ground, height, ...(forest ? { forest } : {}) };
}

/** Far LOD (chunk-relative like mid): coarse ground runs plus one block per built-up cell; a few hundred triangles. */
export function buildFarGeometry(
  s: ChunkSummary,
  tilePalette?: TilePalette,
): LodGeometry | undefined {
  return finish(farWriter(s, tilePalette));
}

function farWriter(s: ChunkSummary, tilePalette?: TilePalette): MeshWriter {
  const w = new MeshWriter();
  const n = SUMMARY_CELLS;
  const cell = CHUNK_SIZE / n;
  const ox = 0;
  const oz = 0;
  const colorAt = (i: number): string | undefined => {
    const id = s.ground[i] ?? EMPTY_TILE;
    if (id === EMPTY_TILE) return undefined;
    return tilePalette ? lodGroundColor(id, tilePalette, !!s.forest?.[i]) : tileGrey(id);
  };
  for (let y = 0; y < n; y++) {
    let start = 0;
    let prev = colorAt(y * n);
    for (let x = 1; x <= n; x++) {
      const cur = x < n ? colorAt(y * n + x) : '';
      if (cur === prev) continue;
      if (prev) {
        w.setColor(prev);
        w.floor(ox + start * cell, oz + y * cell, ox + x * cell, oz + (y + 1) * cell, 0);
      }
      start = x;
      prev = cur;
    }
  }
  w.setColor(STRUCTURE_GREYS.roof);
  for (let i = 0; i < n * n; i++) {
    const h = s.height[i] ?? 0;
    if (h === 0) continue;
    const x0 = ox + (i % n) * cell;
    const z0 = oz + Math.floor(i / n) * cell;
    const top = (h - 1) * LEVEL_HEIGHT + WALL_HEIGHT + ROOF_THICKNESS;
    w.box(x0 + 0.25, 0, z0 + 0.25, x0 + cell - 0.25, top, z0 + cell - 0.25);
  }
  return w;
}

/** Heights of the vector LOD layers (coarse: only seen from afar). */
const VLOD = { area: 0.02, areaStep: 0.004, sidewalk: 0.13, road: 0.15, bridge: 0.3 };
const JOIN = 8;

/** Whether a chunk carries vector ground (generated maps: smooth areas / roads / outlines). */
export function hasVector(chunk: WorldChunk): boolean {
  return !!(chunk.roads?.length || chunk.areas?.length || chunk.buildings?.some((b) => b.outline));
}

/** Buildings with an outline (vector walls), by id. */
function outlinedOf(chunk: WorldChunk): Map<BuildingId, BuildingMeta> {
  const out = new Map<BuildingId, BuildingMeta>();
  for (const b of chunk.buildings ?? []) if (b.outline && b.outline.length >= 6) out.set(b.id, b);
  return out;
}

/** Building of a chunk tile (0 = none). */
function buildingAt(data: ChunkData, i: number): BuildingId {
  const r = data.room?.[i] ?? 0;
  return r === 0 ? 0 : (data.rooms?.get(r)?.buildingId ?? 0);
}

type P2 = [number, number];

/** Polygon clipped to the chunk square [0, CHUNK_SIZE]² (Sutherland–Hodgman). */
export function clipToChunk(poly: readonly P2[]): P2[] {
  let out = poly.map(([a, b]) => [a, b] as P2);
  const C = CHUNK_SIZE;
  for (const [axis, sign, lim] of [
    [0, 1, 0],
    [0, -1, -C],
    [1, 1, 0],
    [1, -1, -C],
  ] as const) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i]!;
      const prev = inp[(i + inp.length - 1) % inp.length]!;
      const ci = sign * cur[axis] >= lim;
      const pi = sign * prev[axis] >= lim;
      if (ci !== pi) {
        const t = (lim - sign * prev[axis]) / (sign * (cur[axis] - prev[axis]));
        out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]);
      }
      if (ci) out.push(cur);
    }
    if (!out.length) break;
  }
  return out;
}

/** Filled polygon (rings: first outer, the rest holes; local tiles) clipped to the chunk. */
function fillRings(
  w: MeshWriter,
  rings: readonly (readonly number[])[],
  dx: number,
  dz: number,
  y: number,
): void {
  const toV = (r: readonly number[]) => {
    const out: Vector2[] = [];
    for (let k = 0; k + 1 < r.length; k += 2) {
      const p = new Vector2(r[k]! - dx, r[k + 1]! - dz);
      if (out.length && out[out.length - 1]!.equals(p)) continue;
      out.push(p);
    }
    if (out.length > 1 && out[0]!.equals(out[out.length - 1]!)) out.pop();
    return out;
  };
  const outer = toV(rings[0] ?? []);
  if (outer.length < 3) return;
  const holes = rings
    .slice(1)
    .map(toV)
    .filter((h) => h.length >= 3);
  const all = [outer, ...holes].flat();
  for (const [a, b, c] of ShapeUtils.triangulateShape(outer, holes)) {
    const tri = [all[a!]!, all[b!]!, all[c!]!].map((p) => [p.x, p.y] as P2);
    const inside = tri.every(([x, z]) => x >= 0 && x <= CHUNK_SIZE && z >= 0 && z <= CHUNK_SIZE);
    const poly = inside ? tri : clipToChunk(tri);
    for (let i = 1; i + 1 < poly.length; i++) w.flatTri(poly[0]!, poly[i]!, poly[i + 1]!, y);
  }
}

/** Segment a→b clipped to the chunk square (Liang–Barsky): [t0, t1] or undefined. */
function clipSeg(ax: number, az: number, bx: number, bz: number): [number, number] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  for (const [p, q] of [
    [-dx, ax],
    [dx, CHUNK_SIZE - ax],
    [-dz, az],
    [dz, CHUNK_SIZE - az],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  return t1 > t0 ? [t0, t1] : undefined;
}

/** Road ribbon (polyline, local tiles) of half width R at y, joins at the chunk's vertices. */
function ribbon(w: MeshWriter, pts: readonly number[], R: number, y: number): void {
  const n = pts.length >> 1;
  for (let i = 0; i < n; i++) {
    const ax = pts[2 * i]!;
    const az = pts[2 * i + 1]!;
    if (ax >= 0 && ax < CHUNK_SIZE && az >= 0 && az < CHUNK_SIZE)
      for (let k = 0; k < JOIN; k++) {
        const a0 = (k / JOIN) * Math.PI * 2;
        const a1 = ((k + 1) / JOIN) * Math.PI * 2;
        w.flatTri(
          [ax, az],
          [ax + Math.cos(a0) * R, az + Math.sin(a0) * R],
          [ax + Math.cos(a1) * R, az + Math.sin(a1) * R],
          y,
        );
      }
    if (i + 1 >= n) break;
    const bx = pts[2 * i + 2]!;
    const bz = pts[2 * i + 3]!;
    const t = clipSeg(ax, az, bx, bz);
    const len = Math.hypot(bx - ax, bz - az);
    if (!t || len === 0) continue;
    const nx = (-(bz - az) / len) * R;
    const nz = ((bx - ax) / len) * R;
    const px = ax + (bx - ax) * t[0];
    const pz = az + (bz - az) * t[0];
    const qx = ax + (bx - ax) * t[1];
    const qz = az + (bz - az) * t[1];
    w.flatTri([px + nx, pz + nz], [qx + nx, qz + nz], [qx - nx, qz - nz], y);
    w.flatTri([px + nx, pz + nz], [qx - nx, qz - nz], [px - nx, pz - nz], y);
  }
}

/** LOD colour of a content id (`base:asphalt`…). */
function contentColor(id: string): string {
  return LOD_GROUND[id] ?? STRUCTURE_GREYS.wall;
}

/** Areas (non-grass: grass is the ground already) and roads of a generated chunk. */
function writeVectorGround(w: MeshWriter, chunk: WorldChunk, _palette: TilePalette): void {
  for (const a of chunk.areas ?? []) {
    if (a.surface === 'base:grass') continue;
    w.setColor(contentColor(a.surface));
    fillRings(w, a.rings, 0, 0, VLOD.area + a.order * VLOD.areaStep);
  }
  for (const r of chunk.roads ?? []) {
    const dy = r.bridge ? VLOD.bridge : 0;
    if (r.rs > 0) {
      w.setColor(contentColor('base:sidewalk'));
      ribbon(w, r.pts, r.rs, VLOD.sidewalk + dy);
    }
    w.setColor(contentColor(r.surface));
    ribbon(w, r.pts, r.r, (r.surface === 'base:asphalt' ? VLOD.road : VLOD.sidewalk) + dy);
  }
}

/** Outlined buildings: walls on the outline (both faces) and a flat roof, clipped to the chunk. */
function writeOutlined(
  w: MeshWriter,
  chunk: WorldChunk,
  outlined: ReadonlyMap<BuildingId, BuildingMeta>,
): void {
  const dx = chunk.cx * CHUNK_SIZE;
  const dz = chunk.cy * CHUNK_SIZE;
  for (const b of outlined.values()) {
    const top = (Math.max(1, b.floors) - 1) * LEVEL_HEIGHT + WALL_HEIGHT;
    const rings = [b.outline!, ...(b.holes ?? [])];
    w.setColor(b.wallColor ?? STRUCTURE_GREYS.wall);
    for (const r of rings) {
      const n = r.length >> 1;
      for (let i = 0; i < n; i++) {
        const ax = r[2 * i]! - dx;
        const az = r[2 * i + 1]! - dz;
        const bx = r[(2 * i + 2) % (2 * n)]! - dx;
        const bz = r[(2 * i + 3) % (2 * n)]! - dz;
        const t = clipSeg(ax, az, bx, bz);
        if (!t) continue;
        const p: V = [ax + (bx - ax) * t[0], 0, az + (bz - az) * t[0]];
        const q: V = [ax + (bx - ax) * t[1], 0, az + (bz - az) * t[1]];
        const pu: V = [p[0], top, p[2]];
        const qu: V = [q[0], top, q[2]];
        w.quad(p, q, qu, pu);
        w.quad(q, p, pu, qu);
      }
    }
    w.setColor(b.roofColor ?? STRUCTURE_GREYS.roof);
    fillRings(w, rings, dx, dz, top);
  }
}

/**
 * Far LOD of a generated chunk with vector ground: coarse ground runs (with the ground under
 * areas / roads), smooth areas and roads, outlined buildings as prisms, the other buildings as
 * blocks per built-up cell.
 */
export function buildFarVectorGeometry(
  chunk: WorldChunk,
  tilePalette?: TilePalette,
): LodGeometry | undefined {
  const outlined = outlinedOf(chunk);
  const s = summarize(
    chunk.under
      ? {
          ...chunk,
          levels: new Map(
            [...chunk.levels].map(([z, lv]) =>
              z === 0
                ? [z, { ...lv, floor: lv.floor.map((v, i) => chunk.under![i] || v) }]
                : [z, lv],
            ),
          ),
        }
      : chunk,
    new Set(outlined.keys()),
  );
  const w = farWriter(s, tilePalette);
  writeVectorGround(w, chunk, tilePalette);
  writeOutlined(w, chunk, outlined);
  return finish(w);
}
