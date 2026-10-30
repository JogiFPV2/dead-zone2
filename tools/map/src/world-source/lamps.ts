import type { IRoad, PlanIndex } from './plan-index.js';

/**
 * Street lamps of a chunk from the plan (Paweł 27.10: lamps in the right places, no random
 * scatter). OSM `highway=street_lamp` nodes are snapped to the nearest carriageway, on their
 * side, just behind the sidewalk; carriageways without OSM lamps nearby get evenly spaced lamps
 * along the road (one side; wide roads both sides, staggered). World metres, render only; a lamp
 * belongs to the chunk holding its pole.
 */
export interface GenLamp {
  x: number;
  y: number;
  /** Unit direction of the arm (towards the carriageway). */
  ax: number;
  ay: number;
  /** From an OSM `street_lamp` node. */
  osm?: 1;
}

/** Spacing of generated lamps along a carriageway (m). */
export const LAMP_SPACING = 20;
/** An OSM lamp this close to a carriageway axis is snapped to it (m). */
export const OSM_SNAP = 15;
/** No generated lamp within this distance of an OSM lamp (the road is mapped there, m). */
export const OSM_COVER = 25;
/** Gap between the pole and the sidewalk's outer edge / the carriageway edge (m). */
export const LAMP_GAP = 0.4;
/** Carriageways get lamps: car roads at least this half width (m). */
const MIN_R = 2;
/** No generated lamps: pedestrian ways, tracks and service ways (yards, parking aisles). */
const UNLIT = new Set(['path', 'footway', 'cycleway', 'steps', 'track', 'service']);

/** Main roads: lamps on both curbs. */
const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

/** Streets that get lamps (bridges and viaducts included). */
export const isLitRoad = (r: IRoad): boolean => !UNLIT.has(r.kind) && r.r >= MIN_R;

/** Offset of the pole from the road axis: behind the sidewalk, or on the verge. */
export const lampOffset = (r: IRoad): number => (r.rs > r.r ? r.rs : r.r) + LAMP_GAP;

type V = { x: number; y: number };

/** Nearest point of a polyline: distance, unit direction there, signed side (+ = left). */
export function nearestOn(pts: ArrayLike<number>, x: number, y: number) {
  let d = Infinity;
  let px = 0;
  let py = 0;
  let ux = 1;
  let uy = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!;
    const ay = pts[k + 1]!;
    const dx = pts[k + 2]! - ax;
    const dy = pts[k + 3]! - ay;
    const l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const e = Math.hypot(ax + t * dx - x, ay + t * dy - y);
    if (e < d) {
      d = e;
      px = ax + t * dx;
      py = ay + t * dy;
      ux = dx / Math.sqrt(l2);
      uy = dy / Math.sqrt(l2);
    }
  }
  const side = (x - px) * -uy + (y - py) * ux >= 0 ? 1 : -1;
  return { d, px, py, ux, uy, side };
}

function inRings(x: number, y: number, rings: readonly Float64Array[]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i + 1 < r.length; j = i, i += 2) {
      const yi = r[i + 1]!;
      const yj = r[j + 1]!;
      if (yi > y !== yj > y && x < ((r[j]! - r[i]!) * (y - yi)) / (yj - yi) + r[i]!)
        inside = !inside;
    }
  return inside;
}

/** Inside a building ring. */
export function inBuilding(idx: PlanIndex, p: V): boolean {
  for (const i of idx.buildings.query({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }))
    if (inRings(p.x, p.y, idx.buildings.items[i]!.rings)) return true;
  return false;
}

/** On a carriageway or sidewalk of any road (`self` excepted: its own curb side is checked). */
export function onRoad(idx: PlanIndex, p: V, self = -1): boolean {
  for (const i of idx.roads.query({ x0: p.x - 1, y0: p.y - 1, x1: p.x + 1, y1: p.y + 1 })) {
    const r = idx.roads.items[i]!;
    if (r.bridge) continue;
    const d = nearestOn(r.pts, p.x, p.y).d;
    if (d < (i === self ? r.r : Math.max(r.r, r.rs)) + 0.05) return true;
  }
  return false;
}

/** Deterministic 0..1 of a road (its first vertex): side and phase stay put across chunks. */
function roadHash(r: IRoad, salt: number): number {
  let h =
    Math.imul(Math.round(r.pts[0]! * 10), 0x27d4eb2d) ^
    Math.imul(Math.round(r.pts[1]! * 10), 0x165667b1);
  h = Math.imul(h ^ salt ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pole beside road `i` at axis point (px, py), direction u, side s; undefined when blocked. */
function poleAt(idx: PlanIndex, i: number, px: number, py: number, u: V, s: number) {
  const r = idx.roads.items[i]!;
  const nx = -u.y * s;
  const ny = u.x * s;
  for (const off of [lampOffset(r), r.r + LAMP_GAP]) {
    const p = { x: px + nx * off, y: py + ny * off };
    // Inner side of a tight bend: the pole would stand right at the next segment's curb.
    const h = nearestOn(r.pts, p.x, p.y);
    if (h.d < off - 0.3 || (h.px - p.x) * -nx + (h.py - p.y) * -ny < 0.8 * h.d) continue;
    if (!inBuilding(idx, p) && !onRoad(idx, p, off > r.r + LAMP_GAP ? -1 : i))
      return { x: p.x, y: p.y, ax: -nx, ay: -ny };
  }
  return undefined;
}

const round = (v: number) => Math.round(v * 100) / 100;
const pack = (l: GenLamp): GenLamp => ({
  ...l,
  x: round(l.x),
  y: round(l.y),
  ax: round(l.ax),
  ay: round(l.ay),
});

/** Lamps whose pole stands in the chunk square [X0, X0 + C) × [Y0, Y0 + C). */
export function chunkLamps(idx: PlanIndex, X0: number, Y0: number, C: number): GenLamp[] {
  const inChunk = (p: V) => p.x >= X0 && p.x < X0 + C && p.y >= Y0 && p.y < Y0 + C;
  const out: GenLamp[] = [];
  const M = OSM_COVER + OSM_SNAP + 2;
  const osm: V[] = [];
  for (const k of idx.pois.query({ x0: X0 - M, y0: Y0 - M, x1: X0 + C + M, y1: Y0 + C + M })) {
    const p = idx.pois.items[k]!;
    if (p.kind !== 'street_lamp') continue;
    const snapped = snapOsm(idx, p);
    osm.push(snapped ?? { x: p.x, y: p.y });
    if (snapped && inChunk(snapped)) out.push(pack({ ...snapped, osm: 1 }));
    else if (!snapped && inChunk(p) && !inBuilding(idx, p) && !onRoad(idx, p))
      out.push(pack({ x: p.x, y: p.y, ax: 1, ay: 0, osm: 1 })); // park / yard lamp
  }
  const covered = (p: V) => osm.some((o) => (o.x - p.x) ** 2 + (o.y - p.y) ** 2 < OSM_COVER ** 2);
  const q = { x0: X0 - 12, y0: Y0 - 12, x1: X0 + C + 12, y1: Y0 + C + 12 };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (!isLitRoad(r)) continue;
    // Wide or main roads (incl. one carriageway of a dual road / viaduct): both sides, staggered.
    const both = r.r >= 4 || MAIN.has(r.kind);
    const side = roadHash(r, 7) < 0.5 ? 1 : -1;
    const step = both ? LAMP_SPACING / 2 : LAMP_SPACING;
    let s = roadHash(r, 3) * step;
    let n = 0;
    let base = 0;
    for (let k = 0; k + 3 < r.pts.length; k += 2) {
      const ax = r.pts[k]!;
      const ay = r.pts[k + 1]!;
      const dx = r.pts[k + 2]! - ax;
      const dy = r.pts[k + 3]! - ay;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const u = { x: dx / len, y: dy / len };
      for (; s <= base + len; s += step, n++) {
        const t = s - base;
        const px = ax + u.x * t;
        const py = ay + u.y * t;
        if (px < q.x0 || px > q.x1 || py < q.y0 || py > q.y1) continue;
        const l = poleAt(idx, i, px, py, u, both && n % 2 ? -side : side);
        // Median of a dual carriageway: one pole for both, not two side by side.
        const twin = (o: V) => (o.x - l!.x) ** 2 + (o.y - l!.y) ** 2 < 36;
        if (l && inChunk(l) && !covered(l) && !out.some(twin)) out.push(pack(l));
      }
      base += len;
    }
  }
  return out;
}

/** An OSM lamp moved onto its carriageway's curb line (same side); undefined = off-street. */
function snapOsm(idx: PlanIndex, p: V): GenLamp | undefined {
  let best: { i: number; h: ReturnType<typeof nearestOn> } | undefined;
  const q = { x0: p.x - OSM_SNAP, y0: p.y - OSM_SNAP, x1: p.x + OSM_SNAP, y1: p.y + OSM_SNAP };
  for (const i of idx.roads.query(q)) {
    const r = idx.roads.items[i]!;
    if (!isLitRoad(r)) continue;
    const h = nearestOn(r.pts, p.x, p.y);
    if (h.d <= OSM_SNAP && (!best || h.d < best.h.d)) best = { i, h };
  }
  if (!best) return undefined;
  const { h } = best;
  return poleAt(idx, best.i, h.px, h.py, { x: h.ux, y: h.uy }, h.side);
}
