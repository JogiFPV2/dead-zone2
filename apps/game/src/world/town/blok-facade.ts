import { BufferAttribute, BufferGeometry } from 'three';
import type { SimWallSegment } from '@deadzone/protocol';
import { CHUNK_SIZE, NO_BUILDING, type BuildingId } from '../chunk.js';
import { WALL_HEIGHT, WALL_THICKNESS } from '../structure-instances.js';
import type { TownEdge } from './layout.js';

/**
 * Facade of a block of flats (Designer's `blok-p4` / `blok-p10` / `blok-p4-docieplony`,
 * `dz-html/bldg/t_blok.js`) on the generated block: balconies on the long sides (from the first
 * floor up), panel joints at every slab, an entrance canopy with a step and the klatka sign over
 * every outer door, vents and lift machine rooms on the roof. Walls, windows, klatki (stairs on
 * every floor) and flats stay the generated ones, so the block follows the OSM outline 1:1 and
 * its storeys `building:levels` / floor(height / 2.8). Works on tile walls and on the vector
 * walls of slanted blocks (outline segments).
 */
export interface BlokInfo {
  floors: number;
  /** Footprint (world tiles, inclusive). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Slanted block: outline (x, y pairs, world metres). */
  outline?: readonly number[] | undefined;
  /** Docieplony (styrofoam + plaster, after 2000): light rails, no panel joints. */
  insulated: boolean;
  /** Variant seed (balcony colours). */
  seed: number;
}

/** One merged facade piece of a building in a chunk. */
export interface BlokPiece {
  building: BuildingId;
  /** Anchor (world x, z) of the piece: the chunk it is drawn with. */
  x: number;
  z: number;
  geo: BufferGeometry;
  /** On the roof (hidden with the roof), else hidden with the level. */
  roof: boolean;
}

/** Klatka module along the block (Designer: 14.4 m per stairwell). */
export const KLATKA_SEG = 14.4;
/** Balcony spacing along a long wall (m): two flats per klatka side. */
export const BALCONY_STEP = 4;

const P10_BALC = ['blok-balc-e', 'blok-balc-e', 'blok-balc-a'];
const P4_BALC = ['blok-balc-a', 'blok-balc-b', 'blok-balc-c', 'blok-balc-a', 'blok-balc-d'];
const INS_BALC = ['blok-balc-f'];
const ACCENTS = ['blok-accent-a', 'blok-accent-b', 'blok-accent-c'];

/**
 * A box in a wall frame: origin (ox, oz), unit direction along the wall (dx, dz), unit outward
 * normal (nx, nz); extents u along, y up, n out (world metres).
 */
export interface FrameBox {
  ox: number;
  oz: number;
  dx: number;
  dz: number;
  nx: number;
  nz: number;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  n0: number;
  n1: number;
  cell: string;
}

/** Centre (world x, z) of a frame box. */
export function boxCentre(b: FrameBox): [number, number] {
  const u = (b.u0 + b.u1) / 2;
  const n = (b.n0 + b.n1) / 2;
  return [b.ox + u * b.dx + n * b.nx, b.oz + u * b.dz + n * b.nz];
}

/** Geometry of frame boxes, every vertex at its atlas cell (flat colour). Pure (tests). */
export function boxesGeometry(
  boxes: readonly FrameBox[],
  uv: (cell: string) => [number, number],
): BufferGeometry {
  const pos = new Float32Array(boxes.length * 24 * 3);
  const nor = new Float32Array(boxes.length * 24 * 3);
  const uvs = new Float32Array(boxes.length * 24 * 2);
  const idx = new Uint32Array(boxes.length * 36);
  let v = 0;
  let i = 0;
  for (const b of boxes) {
    const c = uv(b.cell);
    // Local (u, y, n) → world; a left-handed frame flips the winding.
    const flip = b.dx * b.nz - b.dz * b.nx < 0;
    const w = (u: number, y: number, n: number): [number, number, number] => [
      b.ox + u * b.dx + n * b.nx,
      y,
      b.oz + u * b.dz + n * b.nz,
    ];
    const dirOf = (lu: number, ly: number, ln: number): [number, number, number] => [
      lu * b.dx + ln * b.nx,
      ly,
      lu * b.dz + ln * b.nz,
    ];
    const { u0, u1, y0, y1, n0, n1 } = b;
    const faces: [[number, number, number], [number, number, number][]][] = [
      [
        [0, 1, 0],
        [
          [u0, y1, n0],
          [u0, y1, n1],
          [u1, y1, n1],
          [u1, y1, n0],
        ],
      ],
      [
        [0, -1, 0],
        [
          [u0, y0, n0],
          [u1, y0, n0],
          [u1, y0, n1],
          [u0, y0, n1],
        ],
      ],
      [
        [1, 0, 0],
        [
          [u1, y0, n0],
          [u1, y1, n0],
          [u1, y1, n1],
          [u1, y0, n1],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [u0, y0, n0],
          [u0, y0, n1],
          [u0, y1, n1],
          [u0, y1, n0],
        ],
      ],
      [
        [0, 0, 1],
        [
          [u0, y0, n1],
          [u1, y0, n1],
          [u1, y1, n1],
          [u0, y1, n1],
        ],
      ],
      [
        [0, 0, -1],
        [
          [u0, y0, n0],
          [u0, y1, n0],
          [u1, y1, n0],
          [u1, y0, n0],
        ],
      ],
    ];
    for (const [ln, corners] of faces) {
      const n = dirOf(ln[0], ln[1], ln[2]);
      for (const p of corners) {
        pos.set(w(p[0], p[1], p[2]), v * 3);
        nor.set(n, v * 3);
        uvs.set(c, v * 2);
        v++;
      }
      const s = v - 4;
      idx.set(flip ? [s, s + 2, s + 1, s, s + 3, s + 2] : [s, s + 1, s + 2, s, s + 2, s + 3], i);
      i += 6;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uvs, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

type Out = { building: BuildingId; roof: boolean; box: FrameBox }[];

/** Long axis of a building: unit direction (x, z), its start and length along it, centre. */
function longAxis(b: BlokInfo): {
  dx: number;
  dz: number;
  a0: number;
  len: number;
  cx: number;
  cz: number;
} {
  const o = b.outline;
  if (o && o.length >= 6) {
    let best = 0;
    let dx = 1;
    let dz = 0;
    let cx = 0;
    let cz = 0;
    const n = o.length / 2;
    for (let k = 0; k < n; k++) {
      const x0 = o[2 * k]!;
      const y0 = o[2 * k + 1]!;
      const x1 = o[(2 * k + 2) % o.length]!;
      const y1 = o[(2 * k + 3) % o.length]!;
      cx += x0 / n;
      cz += y0 / n;
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (l > best) {
        best = l;
        dx = (x1 - x0) / l;
        dz = (y1 - y0) / l;
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n; k++) {
      const p = (o[2 * k]! - cx) * dx + (o[2 * k + 1]! - cz) * dz;
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    return { dx, dz, a0: lo, len: hi - lo, cx, cz };
  }
  const longX = b.x1 - b.x0 >= b.y1 - b.y0;
  const cx = (b.x0 + b.x1 + 1) / 2;
  const cz = (b.y0 + b.y1 + 1) / 2;
  const len = (longX ? b.x1 - b.x0 : b.y1 - b.y0) + 1;
  return { dx: longX ? 1 : 0, dz: longX ? 0 : 1, a0: -len / 2, len, cx, cz };
}

/** Balcony on the wall frame at u (centre) on level base y: slab, front and side rails. */
function balcony(
  push: (
    f: Partial<FrameBox> & Pick<FrameBox, 'u0' | 'u1' | 'y0' | 'y1' | 'n0' | 'n1' | 'cell'>,
  ) => void,
  u: number,
  baseY: number,
  rail: string,
  insulated: boolean,
): void {
  const y = baseY + 0.05;
  push({ u0: u - 1.4, u1: u + 1.4, y0: y - 0.15, y1: y, n0: 0, n1: 1.2, cell: 'blok-slab' });
  push({ u0: u - 1.4, u1: u + 1.4, y0: y, y1: y + 1.05, n0: 1.12, n1: 1.2, cell: rail });
  push({ u0: u - 1.4, u1: u - 1.34, y0: y, y1: y + 1.05, n0: 0, n1: 1.2, cell: rail });
  push({ u0: u + 1.34, u1: u + 1.4, y0: y, y1: y + 1.05, n0: 0, n1: 1.2, cell: rail });
  if (insulated)
    push({
      u0: u - 1.4,
      u1: u + 1.4,
      y0: y + 1.0,
      y1: y + 1.08,
      n0: 0,
      n1: 1.22,
      cell: 'blok-balc-a',
    });
}

function railOf(b: BlokInfo, k: number, z: number): string {
  const pal = b.insulated ? INS_BALC : b.floors >= 9 ? P10_BALC : P4_BALC;
  return pal[(((b.seed + k * 7 + z * 3) % pal.length) + pal.length) % pal.length]!;
}

/**
 * Facade boxes of level `z` (world metres). Tile walls: `outward(e)` is +1 / -1 when the outside
 * of outer edge `e` is on the + / - side of the edge line, 0 when it is not an outer wall.
 * Vector walls: the outline segments of slanted blocks. `inRange(x, z)` keeps the pieces of
 * this range only (a building spans several streamed ranges). Pure (tests).
 */
export function blokBoxes(
  edges: readonly TownEdge[],
  segments: readonly SimWallSegment[],
  z: number,
  baseY: number,
  info: (b: BuildingId) => BlokInfo | undefined,
  outward: (e: TownEdge) => number,
  inRange: (x: number, z: number) => boolean,
): Out {
  const out: Out = [];
  const half = WALL_THICKNESS / 2;
  const frame =
    (
      building: BuildingId,
      roof: boolean,
      f: Omit<FrameBox, 'u0' | 'u1' | 'y0' | 'y1' | 'n0' | 'n1' | 'cell'>,
    ) =>
    (p: Pick<FrameBox, 'u0' | 'u1' | 'y0' | 'y1' | 'n0' | 'n1' | 'cell'>) =>
      out.push({
        building,
        roof,
        box: { ...f, ...p, n0: p.n0 + (roof ? 0 : half), n1: p.n1 + (roof ? 0 : half) },
      });
  // Rectangular blocks: one balcony per BALCONY_STEP tiles of a long wall, on its first window.
  const cellKey = (e: TownEdge) => {
    const b = info(e.building)!;
    const along = e.axis === 'N' ? e.tx - b.x0 : e.ty - b.y0;
    const line = e.axis === 'N' ? e.ty : e.tx;
    return `${e.building},${e.axis},${line},${Math.floor(along / BALCONY_STEP)}`;
  };
  const firstWindow = new Map<string, number>();
  for (const e of edges) {
    if (e.interior || e.kind !== 'window') continue;
    const b = info(e.building);
    if (!b || b.outline) continue;
    const along = e.axis === 'N' ? e.tx - b.x0 : e.ty - b.y0;
    const k = cellKey(e);
    const was = firstWindow.get(k);
    if (was === undefined || along < was) firstWindow.set(k, along);
  }
  // Tile walls (rectangular blocks, and the doors / windows of slanted ones).
  for (const e of edges) {
    if (e.interior || (e.kind !== 'wall' && e.kind !== 'window' && e.kind !== 'door')) continue;
    const b = info(e.building);
    if (!b) continue;
    const dir = outward(e);
    if (dir === 0) continue;
    const put = frame(e.building, false, {
      ox: e.tx,
      oz: e.ty,
      dx: e.axis === 'N' ? 1 : 0,
      dz: e.axis === 'N' ? 0 : 1,
      nx: e.axis === 'N' ? 0 : dir,
      nz: e.axis === 'N' ? dir : 0,
    });
    if (e.kind === 'door' && z === 0) {
      // Entrance: canopy on two posts, step, klatka number.
      put({ u0: -1.2, u1: 2.2, y0: 2.55, y1: 2.7, n0: 0, n1: 1.6, cell: 'blok-canopy' });
      put({ u0: -1.15, u1: -1.0, y0: 0, y1: 2.55, n0: 1.4, n1: 1.55, cell: 'blok-canopy' });
      put({ u0: 2.0, u1: 2.15, y0: 0, y1: 2.55, n0: 1.4, n1: 1.55, cell: 'blok-canopy' });
      put({ u0: -0.9, u1: 1.9, y0: 0, y1: 0.12, n0: 0, n1: 0.9, cell: 'blok-slab' });
      put({ u0: 0.3, u1: 0.7, y0: 2.75, y1: 3.0, n0: 0, n1: 0.04, cell: 'blok-sign' });
      if (b.insulated) {
        const accent = ACCENTS[(b.seed + e.tx + e.ty) % ACCENTS.length]!;
        put({ u0: -0.8, u1: 1.8, y0: 2.72, y1: WALL_HEIGHT, n0: 0, n1: 0.02, cell: accent });
      }
    }
    if (b.outline) continue; // slanted: walls, joints and balconies follow the outline below
    const ax = longAxis(b);
    const longSide = (e.axis === 'N') === (ax.dx === 1);
    if (!b.insulated && z > 0 && e.kind !== 'door')
      put({
        u0: 0,
        u1: 1,
        y0: baseY - 0.04,
        y1: baseY + 0.04,
        n0: 0,
        n1: 0.03,
        cell: 'blok-joint',
      });
    const along = e.axis === 'N' ? e.tx - b.x0 : e.ty - b.y0;
    if (z > 0 && longSide && e.kind === 'window' && firstWindow.get(cellKey(e)) === along) {
      balcony(put, 0.5, baseY, railOf(b, Math.floor(along / BALCONY_STEP), z), b.insulated);
    }
  }
  // Vector walls of slanted blocks: joints along every outline piece, balconies on the long sides.
  for (const s of segments) {
    const id = s.building ?? NO_BUILDING;
    const b = info(id);
    if (!b?.outline) continue;
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    if (len < 0.5) continue;
    const dx = (s.x1 - s.x0) / len;
    const dz = (s.y1 - s.y0) / len;
    const ax = longAxis(b);
    let nx = -dz;
    let nz = dx;
    if (((s.x0 + s.x1) / 2 - ax.cx) * nx + ((s.y0 + s.y1) / 2 - ax.cz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const put = frame(id, false, { ox: s.x0, oz: s.y0, dx, dz, nx, nz });
    if (!b.insulated && z > 0)
      put({
        u0: 0,
        u1: len,
        y0: baseY - 0.04,
        y1: baseY + 0.04,
        n0: 0,
        n1: 0.03,
        cell: 'blok-joint',
      });
    if (z === 0 || Math.abs(dx * ax.dx + dz * ax.dz) < 0.9) continue;
    // Balcony centres on a grid along the long axis (continuous over chunk-split pieces).
    const p0 = (s.x0 - ax.cx) * ax.dx + (s.y0 - ax.cz) * ax.dz;
    const sign = dx * ax.dx + dz * ax.dz > 0 ? 1 : -1;
    const lo = Math.min(p0, p0 + sign * len);
    const hi = Math.max(p0, p0 + sign * len);
    const kHi = Math.floor((hi - ax.a0 - 2) / BALCONY_STEP);
    for (let k = Math.ceil((lo - ax.a0 - 2) / BALCONY_STEP); k <= kHi; k++) {
      const a = ax.a0 + 2 + k * BALCONY_STEP;
      const u = (a - p0) * sign;
      if (u < 0 || u > len) continue;
      // Clear of the ends (corners) of the block.
      if (a - ax.a0 < 2 || ax.a0 + ax.len - a < 2) continue;
      balcony(put, u, baseY, railOf(b, k, z), b.insulated);
    }
  }
  // Roof: two vents per klatka module, a lift machine room on tall blocks.
  const seen = new Set<BuildingId>();
  const ids = [...edges.map((e) => e.building), ...segments.map((s) => s.building ?? NO_BUILDING)];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const b = info(id);
    if (!b || z !== b.floors - 1) continue;
    const ax = longAxis(b);
    const y = baseY + WALL_HEIGHT;
    const k = Math.max(1, Math.round(ax.len / KLATKA_SEG));
    const seg = ax.len / k;
    const put = frame(id, true, {
      ox: ax.cx,
      oz: ax.cz,
      dx: ax.dx,
      dz: ax.dz,
      nx: -ax.dz,
      nz: ax.dx,
    });
    const box = (a0: number, a1: number, m0: number, m1: number, h: number) => {
      const p = { u0: a0, u1: a1, y0: y, y1: y + h, n0: m0, n1: m1, cell: 'blok-vent' };
      const u = (a0 + a1) / 2;
      const n = (m0 + m1) / 2;
      if (inRange(ax.cx + u * ax.dx - n * ax.dz, ax.cz + u * ax.dz + n * ax.dx)) put(p);
    };
    for (let i = 0; i < k; i++) {
      const a = ax.a0 + (i + 0.5) * seg;
      for (const d of [-4.5, 4.5]) {
        if (a + d < ax.a0 + 1 || a + d > ax.a0 + ax.len - 1) continue;
        box(a + d - 0.5, a + d + 0.5, -1.6, -0.8, 1.0);
        box(a + d - 0.5, a + d + 0.5, 0.8, 1.6, 1.0);
      }
      if (b.floors >= 9) box(a - 2.4, a + 2.4, -1.8, 1.8, 3.0);
      else box(a - 0.6, a + 0.6, -0.6, 0.6, 0.7);
    }
  }
  return out;
}

/** Facade boxes merged per building, role and chunk (one BatchedMesh geometry each). */
export function blokFacade(
  edges: readonly TownEdge[],
  segments: readonly SimWallSegment[],
  z: number,
  baseY: number,
  info: (b: BuildingId) => BlokInfo | undefined,
  outward: (e: TownEdge) => number,
  inRange: (x: number, z: number) => boolean,
  uv: (cell: string) => [number, number],
): BlokPiece[] {
  const groups = new Map<
    string,
    { building: BuildingId; roof: boolean; x: number; z: number; boxes: FrameBox[] }
  >();
  for (const it of blokBoxes(edges, segments, z, baseY, info, outward, inRange)) {
    const [x, zz] = boxCentre(it.box);
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(zz / CHUNK_SIZE);
    const k = `${it.building},${it.roof ? 1 : 0},${cx},${cz}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { building: it.building, roof: it.roof, x, z: zz, boxes: [] }));
    g.boxes.push(it.box);
  }
  return [...groups.values()].map((g) => ({
    building: g.building,
    roof: g.roof,
    x: g.x,
    z: g.z,
    geo: boxesGeometry(g.boxes, uv),
  }));
}
