import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2 } from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TownCells } from './kit.js';

/** Inclusive tile footprint of a building (world tiles; x = sim x, z = sim y). */
export interface Footprint {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export const EAVE = 0.35;
export const HIP_PITCH_DEG = 28;
export const GABLE_PITCH_DEG = 32;

/**
 * Pitched roof over a rectangular footprint (port of the mockup's `pitchedRoof`): eave overhang
 * 0.35, ridge along the longer axis, hip 28° or gable 32° (gable ends in the wall colour), fascia
 * strip in `gutter`. UVs point into the palette atlas. `y0` = top of the walls.
 */
export function pitchedRoof(
  f: Footprint,
  style: 'hip' | 'gable',
  colour: string,
  wallCell: string,
  cells: TownCells,
  y0: number,
): BufferGeometry {
  const o = EAVE;
  const pitch = Math.tan(((style === 'hip' ? HIP_PITCH_DEG : GABLE_PITCH_DEG) * Math.PI) / 180);
  const x0 = f.x0 - o;
  const x1 = f.x1 + 1 + o;
  const z0 = f.z0 - o;
  const z1 = f.z1 + 1 + o;
  const alongX = x1 - x0 >= z1 - z0;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const yr = y0 + half * pitch;
  const P: number[] = [];
  const UV: number[] = [];
  type V = [number, number, number];
  const tri = (a: V, b: V, c: V, cell: string) => {
    P.push(...a, ...b, ...c);
    const u = cells.uv(cell);
    UV.push(...u, ...u, ...u);
  };
  const quad = (a: V, b: V, c: V, d: V, cell: string) => {
    tri(a, b, c, cell);
    tri(a, c, d, cell);
  };
  const rc = colour;
  const rcd = `${colour}-dark`;
  const inset = style === 'hip' ? half : 0;
  if (alongX) {
    const zm = (z0 + z1) / 2;
    const r0: V = [x0 + inset, yr, zm];
    const r1: V = [x1 - inset, yr, zm];
    quad([x0, y0, z1], [x1, y0, z1], r1, r0, rc);
    quad([x1, y0, z0], [x0, y0, z0], r0, r1, rcd);
    if (style === 'hip') {
      tri([x0, y0, z0], [x0, y0, z1], r0, rcd);
      tri([x1, y0, z1], [x1, y0, z0], r1, rc);
    } else {
      const gx0 = f.x0;
      const gx1 = f.x1 + 1;
      tri([gx0, y0, f.z0], [gx0, y0, f.z1 + 1], [gx0, yr, zm], wallCell);
      tri([gx1, y0, f.z1 + 1], [gx1, y0, f.z0], [gx1, yr, zm], wallCell);
    }
  } else {
    const xm = (x0 + x1) / 2;
    const r0: V = [xm, yr, z0 + inset];
    const r1: V = [xm, yr, z1 - inset];
    quad([x1, y0, z0], [x1, y0, z1], r1, r0, rc);
    quad([x0, y0, z1], [x0, y0, z0], r0, r1, rcd);
    if (style === 'hip') {
      tri([x0, y0, z0], [x1, y0, z0], r0, rcd);
      tri([x1, y0, z1], [x0, y0, z1], r1, rc);
    } else {
      tri([f.x1 + 1, y0, f.z0], [f.x0, y0, f.z0], [xm, yr, f.z0], wallCell);
      tri([f.x0, y0, f.z1 + 1], [f.x1 + 1, y0, f.z1 + 1], [xm, yr, f.z1 + 1], wallCell);
    }
  }
  const fy = y0 - 0.12;
  quad([x0, fy, z1], [x1, fy, z1], [x1, y0, z1], [x0, y0, z1], 'gutter');
  quad([x1, fy, z0], [x0, fy, z0], [x0, y0, z0], [x1, y0, z0], 'gutter');
  quad([x1, fy, z1], [x1, fy, z0], [x1, y0, z0], [x1, y0, z1], 'gutter');
  quad([x0, fy, z0], [x0, fy, z1], [x0, y0, z1], [x0, y0, z0], 'gutter');
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(UV), 2));
  const m = mergeVertices(g);
  m.computeVertexNormals();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

/** Ridge height above the wall top for a footprint (tests, camera framing). */
export function ridgeHeight(f: Footprint, style: 'hip' | 'gable'): number {
  const w = f.x1 - f.x0 + 1 + 2 * EAVE;
  const d = f.z1 - f.z0 + 1 + 2 * EAVE;
  const pitch = Math.tan(((style === 'hip' ? HIP_PITCH_DEG : GABLE_PITCH_DEG) * Math.PI) / 180);
  return (Math.min(w, d) / 2) * pitch;
}

/** Parapet of a vector (outline) roof: height above the slab and thickness (m). */
const OUTLINE_PARAPET_H = 0.35;
const OUTLINE_PARAPET_T = 0.16;

/**
 * Flat roof of a slanted building drawn on its OSM outline (`outline` = x, y pairs in world
 * metres, sim y → world Z), with a low parapet along the outline: matches the vector walls
 * instead of the tile stair-steps. Atlas-coloured like the other roofs.
 */
export function outlineRoof(
  outline: readonly number[],
  colour: string,
  wallCell: string,
  cells: TownCells,
  y0: number,
  clip?: { x0: number; y0: number; x1: number; y1: number },
  holes: readonly (readonly number[])[] = [],
): BufferGeometry | undefined {
  const toRing = (flat: readonly number[]) => {
    const n = flat.length >> 1;
    const r: Vector2[] = [];
    for (let i = 0; i < n; i++) r.push(new Vector2(flat[2 * i], flat[2 * i + 1]));
    if (r.length > 1 && r[0]!.equals(r[r.length - 1]!)) r.pop();
    return r;
  };
  const outer = toRing(outline);
  if (outer.length < 3) return undefined;
  const holeRings = holes.map(toRing).filter((h) => h.length >= 3);
  const box = clip ?? { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
  const pts = clipPolygon(outer, box);
  const holePts = holeRings.map((h) => clipPolygon(h, box)).filter((h) => h.length >= 3);
  // Signed area in (x, y): > 0 = counter-clockwise.
  const isCcw = (r: Vector2[]) => {
    let area = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      area += a.x * b.y - b.x * a.y;
    }
    return area > 0;
  };
  const P: number[] = [];
  const UV: number[] = [];
  type V = [number, number, number];
  // Triangle facing `want` (winding flipped when needed).
  const tri = (a: V, b: V, c: V, cell: string, want: V = [0, 1, 0]) => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) P.push(...a, ...c, ...b);
    else P.push(...a, ...b, ...c);
    const u = cells.uv(cell);
    UV.push(...u, ...u, ...u);
  };
  const quad = (a: V, b: V, c: V, d: V, cell: string, want: V) => {
    tri(a, b, c, cell, want);
    tri(a, c, d, cell, want);
  };
  const ys = y0 + 0.02;
  // Slab: up-facing triangles (x, y → X, Z; counter-clockwise seen from +Y).
  const all = [...pts, ...holePts.flat()];
  for (const [a, b, c] of pts.length >= 3 ? ShapeUtils.triangulateShape(pts, holePts) : []) {
    const A = all[a!]!;
    const B = all[b!]!;
    const C = all[c!]!;
    tri([A.x, ys, A.y], [B.x, ys, B.y], [C.x, ys, C.y], colour);
  }
  // Parapet along every edge (outline and courtyards): outer, inner and top faces.
  const t = OUTLINE_PARAPET_T / 2;
  const yt = y0 + OUTLINE_PARAPET_H;
  for (const [ring, hole] of [
    [outer, false] as const,
    ...holeRings.map((h) => [h, true] as const),
  ]) {
    // Away from the roof: outside the outline, into a courtyard.
    const ccw = isCcw(ring) !== hole;
    for (let i = 0; i < ring.length; i++) {
      const ra = ring[i]!;
      const rb = ring[(i + 1) % ring.length]!;
      const full = ra.distanceTo(rb);
      if (full < 1e-3) continue;
      const dx = (rb.x - ra.x) / full;
      const dy = (rb.y - ra.y) / full;
      const c = clipSegment(ra, rb, box);
      if (!c) continue;
      const [a, b] = c;
      // Corner overlap only at the outline's own vertices, not at the clip border.
      const sa = a.equals(ra) ? 1 : 0;
      const sb = b.equals(rb) ? 1 : 0;
      // Outward normal: right of the edge for a counter-clockwise ring (in x, y), left otherwise.
      const nx = ccw ? dy : -dy;
      const ny = ccw ? -dx : dx;
      const ex = dx * t;
      const ey = dy * t;
      const o0: [number, number] = [a.x + nx * t - ex * sa, a.y + ny * t - ey * sa];
      const o1: [number, number] = [b.x + nx * t + ex * sb, b.y + ny * t + ey * sb];
      const i0: [number, number] = [a.x - nx * t - ex * sa, a.y - ny * t - ey * sa];
      const i1: [number, number] = [b.x - nx * t + ex * sb, b.y - ny * t + ey * sb];
      const face = (p: [number, number], q: [number, number], out: boolean) => {
        const v: V[] = [
          [p[0], y0, p[1]],
          [q[0], y0, q[1]],
          [q[0], yt, q[1]],
          [p[0], yt, p[1]],
        ];
        quad(v[0]!, v[1]!, v[2]!, v[3]!, wallCell, out ? [nx, 0, ny] : [-nx, 0, -ny]);
      };
      face(o0, o1, true);
      face(i0, i1, false);
      // top
      tri([o0[0], yt, o0[1]], [i1[0], yt, i1[1]], [o1[0], yt, o1[1]], wallCell);
      tri([o0[0], yt, o0[1]], [i0[0], yt, i0[1]], [i1[0], yt, i1[1]], wallCell);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(UV), 2));
  // Indexed like every other batched piece (BatchedMesh needs one layout).
  const m = mergeVertices(g);
  m.computeVertexNormals();
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Sutherland–Hodgman clip of a polygon to an axis-aligned box. */
export function clipPolygon(poly: Vector2[], b: Box): Vector2[] {
  let out = poly;
  const planes: [(p: Vector2) => number][] = [
    [(p) => p.x - b.x0],
    [(p) => b.x1 - p.x],
    [(p) => p.y - b.y0],
    [(p) => b.y1 - p.y],
  ];
  for (const [d] of planes) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!;
      const q = input[(i + 1) % input.length]!;
      const dp = d(p);
      const dq = d(q);
      if (dp >= 0) out.push(p);
      if (dp >= 0 !== dq >= 0 && Number.isFinite(dp) && Number.isFinite(dq))
        out.push(p.clone().lerp(q, dp / (dp - dq)));
    }
  }
  return out;
}

/** Liang–Barsky clip of segment a–b to a box (undefined = outside). */
function clipSegment(a: Vector2, b: Vector2, box: Box): [Vector2, Vector2] | undefined {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return undefined;
  }
  if (t1 - t0 < 1e-6) return undefined;
  return [
    t0 === 0 ? a : new Vector2(a.x + dx * t0, a.y + dy * t0),
    t1 === 1 ? b : new Vector2(a.x + dx * t1, a.y + dy * t1),
  ];
}
