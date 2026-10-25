import type { RoadKind } from '../osm/types.js';
import { chunkInfra, HV_SAG, LV_SAG, type GenPole, type GenSpan } from './infra.js';
import type { PlanIndex } from './plan-index.js';

/**
 * Placement check of power line poles (hv110/220/400 towers, lv poles) as `chunkInfra` places
 * them: a pole stands off the carriageway, off pedestrian crossings and outside buildings, and
 * the spans of one line are of similar length. Test helper (pole-placement.test.ts).
 */
export interface PoleStats {
  poles: number;
  lines: number;
  /** Pole centre on a carriageway (car road, distance to the axis < half width). */
  road: number;
  /** On a car road's sidewalk (between the carriageway edge and the sidewalk outer radius). */
  sidewalk: number;
  /** Within `CROSSING_M` of a footway / path / cycleway where it crosses a car road's sidewalk. */
  crossing: number;
  /** Pole centre inside a building ring. */
  building: number;
  /** Lines (≥ 3 spans) with a span off the line's mean by more than `SPAN_TOLERANCE`. */
  uneven: number;
}

/** Silnik's rules (25.10): 1.5 m from a crossing, spans ±30 % along one line. */
export const CROSSING_M = 1.5;
export const SPAN_TOLERANCE = 0.3;
const PED: ReadonlySet<RoadKind> = new Set(['path', 'footway', 'cycleway', 'steps', 'track']);
const C = 32;

function dist(px: number, py: number, pts: Float64Array): number {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k]!;
    const ay = pts[k + 1]!;
    const dx = pts[k + 2]! - ax;
    const dy = pts[k + 3]! - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return best;
}

function inRings(px: number, py: number, rings: readonly Float64Array[]): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 2; i + 1 < r.length; j = i, i += 2) {
      const [xi, yi, xj, yj] = [r[i]!, r[i + 1]!, r[j]!, r[j + 1]!];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

const isPole = (p: GenPole) => /^(hv|lv)/.test(p.m);
const pkey = (p: { x: number; y: number }) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;

/** Power poles and spans of every chunk under a power line, deduped. */
function collect(idx: PlanIndex): { poles: GenPole[]; spans: GenSpan[] } {
  const chunks = new Set<string>();
  for (const w of idx.power.items)
    for (let k = 0; k + 1 < w.pts.length; k += 2) {
      const [x, y] = [w.pts[k]!, w.pts[k + 1]!];
      chunks.add(`${Math.floor(x / C)},${Math.floor(y / C)}`);
    }
  const poles = new Map<string, GenPole>();
  const spans = new Map<string, GenSpan>();
  for (const c of chunks) {
    const [cx, cy] = c.split(',').map(Number) as [number, number];
    const g = chunkInfra(idx, cx, cy, C);
    for (const p of g?.poles ?? []) if (isPole(p)) poles.set(pkey(p), p);
    for (const s of g?.spans ?? [])
      if (s.sag === HV_SAG || s.sag === LV_SAG) spans.set(`${pkey(s.a)}|${pkey(s.b)}`, s);
  }
  return { poles: [...poles.values()], spans: [...spans.values()] };
}

/** Violation counts of one map (and samples for the failure message). */
export function poleStats(idx: PlanIndex, samples: string[] = []): PoleStats {
  const { poles, spans } = collect(idx);
  const s: PoleStats = {
    poles: poles.length,
    lines: 0,
    road: 0,
    sidewalk: 0,
    crossing: 0,
    building: 0,
    uneven: 0,
  };
  const note = (what: string, p: GenPole) => {
    if (samples.length < 10) samples.push(`${what} ${p.m} @ ${p.x},${p.y}`);
  };
  for (const p of poles) {
    const q = { x0: p.x - 30, y0: p.y - 30, x1: p.x + 30, y1: p.y + 30 };
    const roads = idx.roads.query(q).map((i) => idx.roads.items[i]!);
    const car = roads.filter((r) => !PED.has(r.kind) && !r.bridge);
    if (car.some((r) => dist(p.x, p.y, r.pts) < r.r)) {
      s.road++;
      note('jezdnia', p);
    } else if (car.some((r) => r.rs > r.r && dist(p.x, p.y, r.pts) < r.rs)) {
      s.sidewalk++;
      note('chodnik', p);
    } else if (
      roads.some(
        (f) => f.kind !== 'track' && PED.has(f.kind) && dist(p.x, p.y, f.pts) < CROSSING_M,
      ) &&
      car.some((r) => dist(p.x, p.y, r.pts) < Math.max(r.rs, r.r + 1.5))
    ) {
      s.crossing++;
      note('przejście', p);
    }
    const inB = idx.buildings
      .query({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      .some((i) => inRings(p.x, p.y, idx.buildings.items[i]!.rings));
    if (inB) {
      s.building++;
      note('budynek', p);
    }
  }
  for (const w of idx.power.items) {
    const mine = spans.filter(
      (sp) => dist(sp.a.x, sp.a.y, w.pts) < 0.1 && dist(sp.b.x, sp.b.y, w.pts) < 0.1,
    );
    if (!mine.length) continue;
    s.lines++;
    if (mine.length < 3) continue;
    const len = mine.map((sp) => Math.hypot(sp.b.x - sp.a.x, sp.b.y - sp.a.y));
    const mean = len.reduce((a, b) => a + b, 0) / len.length;
    if (len.some((l) => Math.abs(l - mean) > SPAN_TOLERANCE * mean)) s.uneven++;
  }
  return s;
}
