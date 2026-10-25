import type { VectorRoad } from '../streaming/source.js';

/** A zebra crossing on a vector road: centre (chunk-local tiles) and the road's direction. */
export interface Zebra {
  readonly x: number;
  readonly z: number;
  /** Unit direction of the crossed road (stripes run along it). */
  readonly ux: number;
  readonly uz: number;
  /** Half width across the road (carriageway half width) and half length along it. */
  readonly halfWidth: number;
  readonly halfLength: number;
  readonly bridge: boolean;
}

/** Roads that get zebras: asphalt carriageways at least this half width (tiles). */
const MIN_HALF_WIDTH = 2;
/** A vertex of one road this close to another road's centre line is a junction (tiles). */
const JOIN_EPS = 0.05;
/** Zebra length along the road (tiles). */
const LENGTH = 3;

const isCarriageway = (r: VectorRoad): boolean =>
  r.surface === 'base:asphalt' && r.r >= MIN_HALF_WIDTH;

/** Distance from (x, z) to the polyline `pts` (flat x, z pairs) and the unit direction there. */
function distToLine(
  pts: readonly number[],
  x: number,
  z: number,
): { d: number; ux: number; uz: number } {
  let best = Infinity;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i]!;
    const az = pts[i + 1]!;
    const dx = pts[i + 2]! - ax;
    const dz = pts[i + 3]! - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best && l2 > 0) {
      best = d;
      ux = dx / Math.sqrt(l2);
      uz = dz / Math.sqrt(l2);
    }
  }
  return { d: best, ux, uz };
}

/** Unit direction of the polyline at vertex `i` (its next segment, the last one at the end). */
function dirAt(pts: readonly number[], i: number): { ux: number; uz: number } {
  const n = pts.length >> 1;
  const k = Math.min(i, n - 2);
  const dx = pts[2 * k + 2]! - pts[2 * k]!;
  const dz = pts[2 * k + 3]! - pts[2 * k + 1]!;
  const l = Math.hypot(dx, dz) || 1;
  return { ux: dx / l, uz: dz / l };
}

/** Roads meeting at less than this angle are one road split into ways, not a junction. */
const MIN_SIN = Math.sin((30 * Math.PI) / 180);

/**
 * Point `dist` along the polyline from vertex `i` towards `dir` (+1 / −1) with the local unit
 * direction, or undefined if the run ends earlier.
 */
function along(
  pts: readonly number[],
  i: number,
  dir: 1 | -1,
  dist: number,
): { x: number; z: number; ux: number; uz: number } | undefined {
  const n = pts.length >> 1;
  let left = dist;
  for (let k = i; k + dir >= 0 && k + dir < n; k += dir) {
    const ax = pts[2 * k]!;
    const az = pts[2 * k + 1]!;
    const bx = pts[2 * (k + dir)]!;
    const bz = pts[2 * (k + dir) + 1]!;
    const len = Math.hypot(bx - ax, bz - az);
    if (len === 0) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    if (left <= len) return { x: ax + ux * left, z: az + uz * left, ux, uz };
    left -= len;
  }
  return undefined;
}

/**
 * A footway really crosses the carriageway at (jx, jz) (direction d, half width r): it has points
 * beyond the carriageway on both sides. A path that only ends at the road (sidewalk link, yard
 * path) gets no zebra.
 */
function crossesBoth(
  pts: readonly number[],
  jx: number,
  jz: number,
  d: { ux: number; uz: number },
  r: number,
): boolean {
  let left = false;
  let right = false;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const side = (pts[i]! - jx) * -d.uz + (pts[i + 1]! - jz) * d.ux;
    if (side > r) left = true;
    else if (side < -r) right = true;
  }
  return left && right;
}

/** Zebras on the same road closer than this (tiles, along it) are merged: the first one stays. */
export const MIN_ZEBRA_SPACING = 25;

/**
 * Zebra crossings of a chunk's vector roads (all coordinates chunk-local). A junction is a vertex
 * of a carriageway that lies on another road (OSM ways share nodes there):
 * - another carriageway: a zebra on every leg of the road, just past the crossing road's
 *   carriageway (in line with its sidewalk), like the tile renderer drew them;
 * - a footway (sidewalk surface, no sidewalks of its own): a zebra right on the junction.
 * `owns(x, z)` picks the chunk that draws a junction (its own square), so each zebra is drawn once.
 */
export function zebraSpots(
  roads: readonly VectorRoad[],
  owns: (x: number, z: number) => boolean,
): Zebra[] {
  const out: Zebra[] = [];
  const seen = new Set<string>();
  /** Junction of each zebra in `out` (legs of one junction do not thin each other). */
  const from: string[] = [];
  for (let a = 0; a < roads.length; a++) {
    const A = roads[a]!;
    if (!isCarriageway(A)) continue;
    const n = A.pts.length >> 1;
    for (let i = 0; i < n; i++) {
      const jx = A.pts[2 * i]!;
      const jz = A.pts[2 * i + 1]!;
      if (!owns(jx, jz)) continue;
      let offset = -1;
      let foot = false;
      const da = dirAt(A.pts, i);
      for (let b = 0; b < roads.length; b++) {
        const B = roads[b]!;
        if (b === a || B.bridge !== A.bridge) continue;
        const hit = distToLine(B.pts, jx, jz);
        if (hit.d > JOIN_EPS) continue;
        if (Math.abs(da.ux * hit.uz - da.uz * hit.ux) < MIN_SIN) continue;
        if (isCarriageway(B)) {
          const side = B.rs > B.r ? (B.r + B.rs) / 2 : B.r + 1.5;
          offset = Math.max(offset, side + LENGTH / 2);
        } else if (
          B.surface === 'base:sidewalk' &&
          B.rs === 0 &&
          crossesBoth(B.pts, jx, jz, da, A.r)
        )
          foot = true;
      }
      const junction = `${Math.round(jx * 4)},${Math.round(jz * 4)}`;
      const add = (p: { x: number; z: number; ux: number; uz: number }) => {
        const key = `${Math.round(p.x * 4)},${Math.round(p.z * 4)}`;
        if (seen.has(key)) return;
        seen.add(key);
        // One zebra per MIN_ZEBRA_SPACING on a road: skip a parallel one close along the road.
        for (const [k, q] of out.entries()) {
          if (from[k] === junction) continue;
          if (Math.abs(q.ux * p.uz - q.uz * p.ux) > 0.26) continue;
          const dx = p.x - q.x;
          const dz = p.z - q.z;
          const across = Math.abs(dx * -p.uz + dz * p.ux);
          if (across < A.r + 1 && Math.hypot(dx, dz) < MIN_ZEBRA_SPACING) return;
        }
        from.push(junction);
        out.push({
          x: p.x,
          z: p.z,
          ux: p.ux,
          uz: p.uz,
          halfWidth: A.r - 0.2,
          halfLength: LENGTH / 2,
          bridge: A.bridge,
        });
      };
      if (offset > 0) {
        for (const dir of [1, -1] as const) {
          const p = along(A.pts, i, dir, offset);
          if (p) add(p);
        }
      } else if (foot) {
        const p = along(A.pts, i, i + 1 < n ? 1 : -1, 0);
        if (p) add(p);
      }
    }
  }
  return out;
}
