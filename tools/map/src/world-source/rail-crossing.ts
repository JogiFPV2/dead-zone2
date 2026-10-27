import type { PlanIndex } from './plan-index.js';

/** Plain 2D point / direction (plan metres). */
interface V {
  x: number;
  y: number;
}

/** Road kinds without a carriageway (no level crossing furniture, no deck over the track). */
const PED = new Set(['path', 'footway', 'cycleway', 'steps', 'track', 'pedestrian']);
/** Road width (along the rail) one `przejazd-kat-a` model covers with its plates (m). */
export const CROSSING_PLATES_M = 7.2;
/** Half length (along the rail) of the crossing model at scale 1 (m). */
export const CROSSING_HALF = 6;
/** Crossing furniture (signs, barrier) stands this far from the track axis (m). */
const FURN_X = 5.6;

/** Distance from p to the polyline `pts` (flat x, y) and the direction of the nearest segment. */
function nearest(p: V, pts: Float64Array): { dist: number; d: V } {
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
): 0 | 1 | 2 | 3 {
  let bits = 3;
  for (const o of others) {
    const dx = o.x - n.x;
    const dy = o.y - n.y;
    const u = dx * d.x + dy * d.y;
    const v = dx * side.x + dy * side.y;
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
