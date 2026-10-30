import { shearAlong } from './crossing-band.js';
import type { PlanIndex } from './plan-index.js';

/** Plain 2D point / direction (plan metres). */
export interface V {
  x: number;
  y: number;
}

/** Road kinds without a carriageway (no level crossing furniture, no deck over the track). */
export const PED = new Set(['path', 'footway', 'cycleway', 'steps', 'track', 'pedestrian']);
/** Road width (along the rail) one `przejazd-kat-a` model covers with its plates (m). */
export const CROSSING_PLATES_M = 7.2;
/** Half length (along the rail) of the crossing model at scale 1 (m). */
export const CROSSING_HALF = 6;
/** Crossing furniture (signs, barrier) stands this far from the track axis (m). */
const FURN_X = 5.6;

/** Distance from p to the polyline `pts` (flat x, y) and the direction of the nearest segment. */
export function nearest(p: V, pts: Float64Array): { dist: number; d: V } {
  let best = Infinity;
  let d: V = { x: 1, y: 0 };
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!;
    const ay = pts[k + 1]!;
    const dx = pts[k + 2]! - ax;
    const dy = pts[k + 3]! - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2));
    const dist = Math.hypot(ax + t * dx - p.x, ay + t * dy - p.y);
    if (dist < best) {
      best = dist;
      const l = Math.sqrt(l2);
      d = { x: dx / l, y: dy / l };
    }
  }
  return { dist: best, d };
}

/**
 * Length scale (model z, along the rail) of a level crossing at `n` on a rail running along `d`:
 * the plates cover the whole carriageway of the road through the crossing, also when it is wide
 * or crosses at an angle. 1 = the model as built (7.2 m of road); capped at 2.5.
 */
export function crossingScale(idx: PlanIndex, n: V, d: V): number {
  let width = 0;
  const q = { x0: n.x - 2, y0: n.y - 2, x1: n.x + 2, y1: n.y + 2 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (r.bridge || PED.has(r.kind)) continue;
    const { dist, d: rd } = nearest(n, r.pts);
    if (dist > r.r + 1) continue;
    const sin = Math.max(0.4, Math.abs(rd.x * d.y - rd.y * d.x));
    width = Math.max(width, (2 * r.r) / sin + 0.6);
  }
  return Math.round(Math.max(1, Math.min(2.5, width / CROSSING_PLATES_M)) * 100) / 100;
}

/**
 * Crossing furniture (signs, barrier) sides of a crossing at `n` (model +x = `side`): bit 1 = −x,
 * bit 2 = +x. A side is dropped when another level crossing (a parallel track on the same road)
 * lies that way within a few metres: one set of signs and barriers per road side, not one between
 * every pair of tracks.
 */
export function crossingSides(
  n: V,
  d: V,
  side: V,
  others: readonly V[],
  scale: number,
  shear = 0,
): 0 | 1 | 2 | 3 {
  let bits = 3;
  for (const o of others) {
    const dx = o.x - n.x;
    const dy = o.y - n.y;
    // Along the track, measured from the (sheared) road band through n.
    const v = dx * side.x + dy * side.y;
    const u = dx * d.x + dy * d.y - shear * v;
    // The same track, plates overlapping (two roads meeting on it): one crossing; the set at the
    // end facing the other one goes (−x set at model +z, +x set at −z).
    if (Math.abs(v) < 0.5 && Math.abs(dx * d.x + dy * d.y) < 2 * CROSSING_HALF * scale) {
      bits &= dx * d.x + dy * d.y > 0 ? ~1 : ~2;
      continue;
    }
    if (Math.abs(u) > CROSSING_HALF * scale || Math.abs(v) < 0.5 || Math.abs(v) > 2 * FURN_X + 2)
      continue;
    bits &= v < 0 ? ~1 : ~2;
  }
  return bits as 0 | 1 | 2 | 3;
}

/** True when p lies under the deck of a road bridge (carriageway or sidewalk). */
export function underRoadDeck(idx: PlanIndex, p: V): boolean {
  const q = { x0: p.x - 1, y0: p.y - 1, x1: p.x + 1, y1: p.y + 1 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (!r.bridge) continue;
    if (nearest(p, r.pts).dist < Math.max(r.r, r.rs) + 0.3) return true;
  }
  return false;
}

/** True when p is on any road's carriageway or sidewalk (bridge decks too), `clear` m to spare. */
export function onRoad(idx: PlanIndex, p: V, clear: number): boolean {
  const q = { x0: p.x - 1, y0: p.y - 1, x1: p.x + 1, y1: p.y + 1 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (PED.has(r.kind) && !r.bridge) continue;
    if (nearest(p, r.pts).dist < Math.max(r.r, r.rs) + clear) return true;
  }
  return false;
}

/**
 * Centre of a level crossing on the track through `n` along `d` (Designer 27.10: plates of
 * parallel tracks stepped across the road): where the track line meets the axis of the nearest
 * at-grade carriageway, so every track on one road puts its plates on the same line, one band
 * across the road. `n` itself when no carriageway axis is crossed within `SNAP_M`.
 */
export function snapToRoad(idx: PlanIndex, n: V, d: V): V {
  const SNAP_M = 6;
  let best: V = n;
  let bestT = SNAP_M;
  const q = { x0: n.x - 20, y0: n.y - 20, x1: n.x + 20, y1: n.y + 20 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (r.bridge || PED.has(r.kind)) continue;
    const p = r.pts;
    for (let k = 0; k + 3 < p.length; k += 2) {
      const ex = p[k + 2]! - p[k]!;
      const ey = p[k + 3]! - p[k + 1]!;
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-6) continue;
      const wx = p[k]! - n.x;
      const wy = p[k + 1]! - n.y;
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * d.y - wy * d.x) / den;
      if (u < 0 || u > 1 || Math.abs(t) >= bestT) continue;
      bestT = Math.abs(t);
      best = {
        x: Math.round((n.x + t * d.x) * 100) / 100,
        y: Math.round((n.y + t * d.y) * 100) / 100,
      };
    }
  }
  return best;
}

/**
 * Shear of a level crossing model (local z += shear × x; x across the track, z along it, yaw
 * `rot`) that lays its plates along the road through `n` (Designer 27.10: rectangular plates on
 * an oblique road step across the tracks). 0 = road at right angles; clamped to ±1.5 (≈ 34°).
 */
export function crossingShear(idx: PlanIndex, n: V, rot: number): number {
  const r = crossingRoad(idx, n);
  return r ? shearAlong(r.d, rot) : 0;
}

/**
 * Nearest at-grade carriageway through `n` (index and unit direction there), if any. With the
 * track direction `d`: only a road that crosses it (≥ 30°), not one running alongside the track.
 */
export function crossingRoad(idx: PlanIndex, n: V, d?: V): { i: number; d: V } | undefined {
  let best = Infinity;
  let out: { i: number; d: V } | undefined;
  const q = { x0: n.x - 2, y0: n.y - 2, x1: n.x + 2, y1: n.y + 2 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (r.bridge || PED.has(r.kind)) continue;
    const near = nearest(n, r.pts);
    if (d && Math.abs(d.x * near.d.y - d.y * near.d.x) < 0.5) continue;
    if (near.dist <= r.r + 1 && near.dist < best) {
      best = near.dist;
      out = { i, d: near.d };
    }
  }
  return out;
}
