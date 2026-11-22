import type { IRoad, PlanIndex } from './plan-index.js';
import { nearest, PED } from './rail-crossing.js';

/** Level crossing to draw: centre on the track axis, `d` = unit direction along the track. */
export interface LevelCrossing {
  x: number;
  y: number;
  d: { x: number; y: number };
  /** Added where OSM has no `level_crossing` node (track × carriageway at grade). */
  synth?: true;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A node counts for a track × road intersection this far beyond the carriageway half width (m). */
export const CROSSING_REACH_M = 4;

const carriageway = (r: IRoad) => !PED.has(r.kind) && !r.bridge && !r.fill;

function hits(
  a: Float64Array,
  b: Float64Array,
  out: { x: number; y: number; d: { x: number; y: number } }[],
) {
  for (let i = 0; i + 3 < a.length; i += 2) {
    const [ax, ay, bx, by] = [a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!];
    for (let j = 0; j + 3 < b.length; j += 2) {
      const [cx, cy, dx, dy] = [b[j]!, b[j + 1]!, b[j + 2]!, b[j + 3]!];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (!den) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const l = Math.hypot(bx - ax, by - ay) || 1;
      out.push({
        x: ax + t * (bx - ax),
        y: ay + t * (by - ay),
        d: { x: (bx - ax) / l, y: (by - ay) / l },
      });
    }
  }
}

/** At-grade carriageways (no bridge, no footpath) within `CROSSING_REACH_M` of their edge from p. */
function roadsNear(idx: PlanIndex, p: { x: number; y: number }): IRoad[] {
  const q = { x0: p.x - 30, y0: p.y - 30, x1: p.x + 30, y1: p.y + 30 };
  return idx.roads
    .query(q)
    .map((i) => idx.roads.items[i]!)
    .filter((r) => carriageway(r) && nearest(p, r.pts).dist <= r.r + CROSSING_REACH_M);
}

/** Whether an OSM `level_crossing` node lies on an at-grade carriageway (else: OSM leftover). */
export function onCarriageway(idx: PlanIndex, n: { x: number; y: number }): boolean {
  return roadsNear(idx, n).length > 0;
}

/**
 * Level crossings OSM does not mark (Paweł 27.10): every at-grade track × carriageway intersection
 * in box `q` with no `level_crossing` node on a carriageway within the road half width +
 * `CROSSING_REACH_M`. Ordered by position (same output for any window or tile load order).
 */
export function syntheticCrossings(idx: PlanIndex, q: Box): LevelCrossing[] {
  const out: LevelCrossing[] = [];
  const m = 40;
  const wide = { x0: q.x0 - m, y0: q.y0 - m, x1: q.x1 + m, y1: q.y1 + m };
  const osm: { x: number; y: number }[] = [];
  for (const i of idx.railNodes.query(wide)) {
    const n = idx.railNodes.items[i]!;
    if (n.kind === 'level_crossing' && onCarriageway(idx, n)) osm.push(n);
  }
  const inQ = (p: { x: number; y: number }) =>
    p.x >= q.x0 && p.x <= q.x1 && p.y >= q.y0 && p.y <= q.y1;
  const seen = new Set<string>();
  for (const ai of idx.rails.query(q)) {
    const rail = idx.rails.items[ai]!;
    if (rail.bridge) continue;
    const rb = idx.rails.boxes[ai]!;
    const near = {
      x0: Math.max(q.x0, rb.x0),
      y0: Math.max(q.y0, rb.y0),
      x1: Math.min(q.x1, rb.x1),
      y1: Math.min(q.y1, rb.y1),
    };
    for (const ri of idx.roads.query(near)) {
      const road = idx.roads.items[ri]!;
      if (!carriageway(road)) continue;
      const hs: LevelCrossing[] = [];
      hits(rail.pts, road.pts, hs);
      for (const h of hs) {
        const k = `${Math.round(h.x * 10)},${Math.round(h.y * 10)}`;
        if (!inQ(h) || seen.has(k)) continue;
        seen.add(k);
        const reach = road.r + CROSSING_REACH_M;
        if (osm.some((n) => Math.hypot(n.x - h.x, n.y - h.y) <= reach)) continue;
        out.push({
          x: Math.round(h.x * 100) / 100,
          y: Math.round(h.y * 100) / 100,
          d: h.d,
          synth: true,
        });
      }
    }
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
