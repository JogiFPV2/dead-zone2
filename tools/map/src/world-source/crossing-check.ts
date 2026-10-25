import type { PlanIndex } from './plan-index.js';

/**
 * Placement check of zebra crossings as the game draws them (`zebraSpots` in
 * apps/game/src/world/town/zebras.ts, fed with the plan's road polylines in world metres).
 * Test helper (crossing-placement.test.ts). Rules (Szef sztabu, 25.10):
 * - `duplicate`: pairs of zebras on the same road over the same footway (one per crossing);
 * - `spacing`: pairs of zebras on the same road closer than `MIN_SPACING_M`;
 * - `angle`: stripes off the road direction by more than `MAX_ANGLE_DEG` (crossing not
 *   perpendicular to the carriageway);
 * - `offRoad`: zebra centre farther than half a carriageway from every carriageway axis.
 */
/** The game's zebra (apps/game/src/world/town/zebras.ts), world metres here. */
interface Zebra {
  x: number;
  z: number;
  ux: number;
  uz: number;
  bridge: boolean;
}
type ZebraSpots = (roads: readonly object[], owns: () => boolean) => Zebra[];
/** Loaded by path at runtime so tsc does not pull the game's types into tools/map. */
const ZEBRAS: string = new URL('../../../../apps/game/src/world/town/zebras.ts', import.meta.url)
  .href;

export interface CrossingStats {
  crossings: number;
  duplicate: number;
  spacing: number;
  angle: number;
  offRoad: number;
}

export const MIN_SPACING_M = 10;
export const MAX_ANGLE_DEG = 20;
/** A footway counts as crossed by a zebra when it passes this close to the zebra centre. */
const FOOT_M = 2;
const SIN_MAX = Math.sin((MAX_ANGLE_DEG * Math.PI) / 180);
const PED = new Set(['footway', 'cycleway', 'steps']);
const surface = (k: string) =>
  k === 'path' || k === 'track' ? 'base:dirt' : PED.has(k) ? 'base:sidewalk' : 'base:asphalt';

function near(px: number, py: number, pts: ArrayLike<number>) {
  let d = Infinity;
  let ux = 1;
  let uy = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const [ax, ay] = [pts[k]!, pts[k + 1]!];
    const [dx, dy] = [pts[k + 2]! - ax, pts[k + 3]! - ay];
    const l2 = dx * dx + dy * dy;
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    const e = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (e < d) [d, ux, uy] = [e, dx / Math.sqrt(l2), dy / Math.sqrt(l2)];
  }
  return { d, ux, uy };
}

interface Spot {
  z: Zebra;
  host: number;
  feet: number[];
}

/** Violation counts of one map (and samples for the failure message). */
export async function crossingStats(
  idx: PlanIndex,
  samples: string[] = [],
): Promise<CrossingStats> {
  const { zebraSpots } = (await import(ZEBRAS)) as { zebraSpots: ZebraSpots };
  const items = idx.roads.items;
  const roads = items.map((r) => ({
    surface: surface(r.kind),
    r: r.r,
    rs: r.rs,
    bridge: r.bridge,
    pts: Array.from(r.pts),
    d0: 0,
  }));
  const zebras = zebraSpots(roads, () => true);
  const s: CrossingStats = {
    crossings: zebras.length,
    duplicate: 0,
    spacing: 0,
    angle: 0,
    offRoad: 0,
  };
  const note = (what: string, z: Zebra) => {
    if (samples.length < 10) samples.push(`${what} @ ${z.x.toFixed(1)},${z.z.toFixed(1)}`);
  };
  const spots: Spot[] = [];
  for (const z of zebras) {
    const q = { x0: z.x - 20, y0: z.z - 20, x1: z.x + 20, y1: z.z + 20 };
    let host = -1;
    let gap = Infinity;
    let dir = { ux: 1, uy: 0 };
    const feet: number[] = [];
    for (const i of idx.roads.query(q)) {
      const R = items[i]!;
      if (R.bridge !== z.bridge) continue;
      const h = near(z.x, z.z, R.pts);
      if (roads[i]!.surface === 'base:asphalt') {
        if (h.d - R.r < gap) [host, gap, dir] = [i, h.d - R.r, h];
      } else if (PED.has(R.kind) && R.rs === 0 && h.d < FOOT_M) feet.push(i);
    }
    if (gap > 0) {
      s.offRoad++;
      note('poza jezdnią', z);
    }
    if (host >= 0 && Math.abs(z.ux * dir.uy - z.uz * dir.ux) > SIN_MAX) {
      s.angle++;
      note('krzywo', z);
    }
    spots.push({ z, host, feet });
  }
  countPairs(spots, s, note);
  return s;
}

/** Pairs on the same road: over the same footway (`duplicate`), closer than 10 m (`spacing`). */
function countPairs(spots: Spot[], s: CrossingStats, note: (w: string, z: Zebra) => void) {
  const cell = (v: number) => Math.floor(v / MIN_SPACING_M);
  const grid = new Map<string, number[]>();
  spots.forEach((p, i) => {
    const k = `${cell(p.z.x)},${cell(p.z.z)}`;
    grid.set(k, [...(grid.get(k) ?? []), i]);
  });
  spots.forEach((a, i) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of grid.get(`${cell(a.z.x) + dx},${cell(a.z.z) + dy}`) ?? []) {
          const b = spots[j]!;
          if (j <= i || a.host < 0 || a.host !== b.host) continue;
          if (a.feet.some((f) => b.feet.includes(f))) {
            s.duplicate++;
            note('podwójne', a.z);
          }
          if (Math.hypot(a.z.x - b.z.x, a.z.z - b.z.z) < MIN_SPACING_M) {
            s.spacing++;
            note('za blisko', a.z);
          }
        }
  });
}
