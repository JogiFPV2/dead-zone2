import type { IRail, IRoad, PlanIndex } from './plan-index.js';

/**
 * Level crossings (Paweł 27.10: rail × road crossings drawn wrong). Every intersection of a
 * track axis with a carriageway axis (both at grade) must carry an OSM `level_crossing` rail
 * node (`idx.railNodes`, drawn as `przejazd-kat-a`); a road or rail bridge passes over instead.
 * Test helper (level-crossing-*.test.ts). Counts:
 * - `missing`: at-grade intersection without a `level_crossing` node within reach;
 * - `inBuilding`: subset of `missing` inside an OSM building outline (depot tracks, known case);
 * - `orphan`: `level_crossing` node with no carriageway within reach.
 */
export interface LevelCrossingStats {
  intersections: number;
  bridged: number;
  marked: number;
  missing: number;
  inBuilding: number;
  orphan: number;
}

/** Roads without a carriageway (no level crossing needed). */
const PED = new Set(['path', 'footway', 'cycleway', 'steps', 'track', 'pedestrian']);
/** A marker counts for an intersection this far beyond the carriageway half width (m). */
const REACH_M = 4;

type Hit = { x: number; y: number };

function segHits(a: Float64Array, b: Float64Array): Hit[] {
  const out: Hit[] = [];
  for (let i = 0; i + 3 < a.length; i += 2) {
    const [ax, ay, bx, by] = [a[i]!, a[i + 1]!, a[i + 2]!, a[i + 3]!];
    for (let j = 0; j + 3 < b.length; j += 2) {
      const [cx, cy, dx, dy] = [b[j]!, b[j + 1]!, b[j + 2]!, b[j + 3]!];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (!den) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      out.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay) });
    }
  }
  return out;
}

const boxOf = (p: Float64Array, m = 0) => {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let k = 0; k + 1 < p.length; k += 2) {
    x0 = Math.min(x0, p[k]!);
    x1 = Math.max(x1, p[k]!);
    y0 = Math.min(y0, p[k + 1]!);
    y1 = Math.max(y1, p[k + 1]!);
  }
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
};

function inRing(p: Hit, r: Float64Array): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 2; i + 1 < r.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [r[i]!, r[i + 1]!, r[j]!, r[j + 1]!];
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inBuilding(idx: PlanIndex, p: Hit): boolean {
  for (const i of idx.buildings.query({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })) {
    const b = idx.buildings.items[i]!;
    if (b.rings[0] && inRing(p, b.rings[0])) return true;
  }
  return false;
}

const carriageway = (r: IRoad) => !PED.has(r.kind);

/** Violation counts of one map; `samples` gets "kind @x,y" notes. */
export function levelCrossingStats(idx: PlanIndex, samples: string[] = []): LevelCrossingStats {
  const s: LevelCrossingStats = {
    intersections: 0,
    bridged: 0,
    marked: 0,
    missing: 0,
    inBuilding: 0,
    orphan: 0,
  };
  const nodes = idx.railNodes.items.filter((n) => n.kind === 'level_crossing');
  const seen = new Set<string>();
  idx.rails.items.forEach((rail: IRail) => {
    for (const ri of idx.roads.query(boxOf(rail.pts))) {
      const road = idx.roads.items[ri]!;
      if (!carriageway(road)) continue;
      for (const h of segHits(rail.pts, road.pts)) {
        const key = `${Math.round(h.x)},${Math.round(h.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        s.intersections++;
        if (rail.bridge || road.bridge) {
          s.bridged++;
          continue;
        }
        const reach = road.r + REACH_M;
        const q = { x0: h.x - reach, y0: h.y - reach, x1: h.x + reach, y1: h.y + reach };
        const ok = idx.railNodes.query(q).some((i) => {
          const n = idx.railNodes.items[i]!;
          return n.kind === 'level_crossing' && Math.hypot(n.x - h.x, n.y - h.y) <= reach;
        });
        if (ok) {
          s.marked++;
          continue;
        }
        s.missing++;
        const dep = inBuilding(idx, h);
        if (dep) s.inBuilding++;
        samples.push(`${dep ? 'zajezdnia' : 'brak'} @${h.x.toFixed(0)},${h.y.toFixed(0)}`);
      }
    }
  });
  for (const n of nodes) {
    const q = { x0: n.x - 20, y0: n.y - 20, x1: n.x + 20, y1: n.y + 20 };
    const near = idx.roads.query(q).some((i) => {
      const r = idx.roads.items[i]!;
      if (!carriageway(r)) return false;
      const p = r.pts;
      for (let k = 0; k + 3 < p.length; k += 2) {
        const [ax, ay, dx, dy] = [p[k]!, p[k + 1]!, p[k + 2]! - p[k]!, p[k + 3]! - p[k + 1]!];
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((n.x - ax) * dx + (n.y - ay) * dy) / l2));
        if (Math.hypot(ax + t * dx - n.x, ay + t * dy - n.y) <= r.r + REACH_M) return true;
      }
      return false;
    });
    if (!near) {
      s.orphan++;
      samples.push(`sierota @${n.x.toFixed(0)},${n.y.toFixed(0)}`);
    }
  }
  return s;
}
