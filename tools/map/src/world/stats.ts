import { GroundField } from './ground.js';
import { polyLength } from './geom.js';
import type { RoadClass, WorldPlan } from './plan.js';
import { RoadIndex } from './plan.js';

export interface PlanStats {
  size: number;
  chunks: string;
  settlements: Record<string, number>;
  buildings: Record<string, number>;
  roadKm: Partial<Record<RoadClass, number>>;
  complexes: Record<string, number>;
  /** Share of the land cover sample (forest, fields, water, urban). */
  cover: Record<string, number>;
  /** Share of 512 m cells with no building, road or forest path at all. */
  emptyCells: number;
  /** 95th percentile distance (m) from a random point to the nearest road / track / path. */
  p95RoadDist: number;
}

export function planStats(plan: WorldPlan): PlanStats {
  const count = <T extends string>(xs: readonly T[]) => {
    const o: Record<string, number> = {};
    for (const x of xs) o[x] = (o[x] ?? 0) + 1;
    return o;
  };
  const roadKm: Partial<Record<RoadClass, number>> = {};
  for (const r of plan.roads)
    roadKm[r.cls] = Math.round(((roadKm[r.cls] ?? 0) + polyLength(r.pts) / 1000) * 10) / 10;
  const field = new GroundField(plan);
  const cover: Record<string, number> = {};
  const N = 6000;
  let s = plan.seed * 7 + 1;
  const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
  const index = new RoadIndex(plan.size, plan.roads);
  for (let i = 0; i < plan.roads.length; i++) index.add(i);
  const dists: number[] = [];
  for (let i = 0; i < N; i++) {
    const x = rnd() * plan.size;
    const y = rnd() * plan.size;
    const g = field.at(x, y);
    const k = g === 'forest' || g === 'water' || g === 'urban' ? g : 'fields/meadows';
    cover[k] = (cover[k] ?? 0) + 1 / N;
    dists.push(index.nearest(x, y, 3000)?.d ?? 3000);
  }
  for (const k of Object.keys(cover)) cover[k] = Math.round((cover[k] ?? 0) * 1000) / 1000;
  dists.sort((a, b) => a - b);
  // Empty cells: 512 m cells with nothing built and no road inside.
  const C = 512;
  const n = Math.ceil(plan.size / C);
  const used = new Uint8Array(n * n);
  const mark = (x: number, y: number) => {
    const cx = Math.floor(x / C);
    const cy = Math.floor(y / C);
    if (cx >= 0 && cy >= 0 && cx < n && cy < n) used[cy * n + cx] = 1;
  };
  for (const b of plan.buildings) mark(b.x, b.y);
  for (const r of plan.roads)
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1];
      const b = r.pts[i];
      if (!a || !b) continue;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 64);
      for (let k = 0; k <= steps; k++)
        mark(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps);
    }
  for (const a of plan.areas) if (a.kind === 'lake') mark(a.x, a.y);
  let empty = 0;
  for (const u of used) if (!u) empty++;
  return {
    size: plan.size,
    chunks: `${plan.chunks}×${plan.chunks}`,
    settlements: count(plan.settlements.map((x) => x.kind)),
    buildings: { total: plan.buildings.length, ...count(plan.buildings.map((b) => b.kind)) },
    roadKm,
    complexes: count(plan.complexes.map((c) => c.kind)),
    cover,
    emptyCells: Math.round((empty / (n * n)) * 1000) / 1000,
    p95RoadDist: Math.round(dists[Math.floor(N * 0.95)] ?? 0),
  };
}
