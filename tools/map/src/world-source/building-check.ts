import type { SolvedBuilding } from './building.js';
import { EDGE_PALETTE } from './palette.js';
import type { IBuilding } from './plan-index.js';

/**
 * Shape and window density of building outlines (Paweł 26.10: "krzaczki i zawijasy", too few
 * windows). Test helper (building-shape.suite.ts). Counts are buildings, not edges.
 */
export interface BuildingStats {
  buildings: number;
  /** Ground-floor exterior windows of the judged (sampled) residential buildings. */
  windows: number;
  /** An outline edge shorter than `SHORT_EDGE_M` (zigzag step). */
  short: number;
  /** More than `MAX_VERTS_PER_M` vertices per perimeter metre (≥ 8 vertices). */
  dense: number;
  /** Corner sharper than `ACUTE_DEG` (spike, or edge folding back onto its neighbour). */
  acute: number;
  /** Two non-adjacent outline edges cross or touch. */
  selfX: number;
  /** Residential: fewer than 1 ground-floor window per `WALL_PER_WINDOW_M` of walls > `LONG_WALL_M`. */
  fewWindows: number;
}

export const SHORT_EDGE_M = 0.5;
export const MAX_VERTS_PER_M = 0.5;
export const ACUTE_DEG = 30;
export const WALL_PER_WINDOW_M = 6;
export const LONG_WALL_M = 4;
export const RESIDENTIAL: ReadonlySet<string> = new Set(['house', 'block', 'kostka']);

/** Ring as points without the closing duplicate. */
function points(r: Float64Array): [number, number][] {
  const p: [number, number][] = [];
  for (let k = 0; k + 1 < r.length; k += 2) p.push([r[k]!, r[k + 1]!]);
  const [a, b] = [p[0], p[p.length - 1]];
  if (p.length > 1 && a && b && a[0] === b[0] && a[1] === b[1]) p.pop();
  return p;
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

function segHit(
  p: [number, number],
  q: [number, number],
  r: [number, number],
  s: [number, number],
): boolean {
  const d1 = cross(q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1]);
  const d2 = cross(q[0] - p[0], q[1] - p[1], s[0] - p[0], s[1] - p[1]);
  const d3 = cross(s[0] - r[0], s[1] - r[1], p[0] - r[0], p[1] - r[1]);
  const d4 = cross(s[0] - r[0], s[1] - r[1], q[0] - r[0], q[1] - r[1]);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0);
}

/** Shape flags of one outline (every ring judged). */
export function shapeIssues(rings: readonly Float64Array[]): {
  short: boolean;
  dense: boolean;
  acute: boolean;
  selfX: boolean;
  longWalls: number;
} {
  const o = { short: false, dense: false, acute: false, selfX: false, longWalls: 0 };
  for (const r of rings) {
    const p = points(r);
    const n = p.length;
    if (n < 3) continue;
    let per = 0;
    for (let i = 0; i < n; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % n]!;
      const c = p[(i + 2) % n]!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      per += len;
      if (len < SHORT_EDGE_M) o.short = true;
      if (len > LONG_WALL_M) o.longWalls += len;
      const u = [a[0] - b[0], a[1] - b[1]];
      const v = [c[0] - b[0], c[1] - b[1]];
      const lu = Math.hypot(u[0]!, u[1]!);
      const lv = Math.hypot(v[0]!, v[1]!);
      if (lu > 0 && lv > 0) {
        const cos = (u[0]! * v[0]! + u[1]! * v[1]!) / (lu * lv);
        if ((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI < ACUTE_DEG) o.acute = true;
      }
      if (!o.selfX)
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          if (segHit(a, b, p[j]!, p[(j + 1) % n]!)) {
            o.selfX = true;
            break;
          }
        }
    }
    if (n >= 8 && n / per > MAX_VERTS_PER_M) o.dense = true;
  }
  return o;
}

/** Ground-floor exterior window edges (room on one side, outside on the other). */
export function groundWindows(s: SolvedBuilding): number {
  const L = s.levels.get(0);
  if (!L) return 0;
  const W = s.w + 1;
  const H = s.h + 1;
  const roomAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= W || y >= H ? 0 : (L.room[y * W + x] ?? 0);
  let n = 0;
  for (let i = 0; i < L.edgeN.length; i++) {
    const x = i % W;
    const y = (i - x) / W;
    for (const v of [L.edgeN[i]!, L.edgeW[i]!]) {
      if (EDGE_PALETTE[v]?.kind !== 'window') continue;
      const b = v === L.edgeN[i] ? roomAt(x, y - 1) : roomAt(x - 1, y);
      if ((roomAt(x, y) === 0) !== (b === 0)) n++;
    }
  }
  return n;
}

/** Violation counts over a map's buildings (`solve` = generator.building). */
export function buildingStats(
  items: readonly IBuilding[],
  solve: (ib: IBuilding) => SolvedBuilding | undefined,
  samples: string[] = [],
  /** Judge windows of every n-th residential building only (by gid; solving is the slow part). */
  windowSample = 1,
): BuildingStats {
  const s: BuildingStats = {
    buildings: items.length,
    windows: 0,
    short: 0,
    dense: 0,
    acute: 0,
    selfX: 0,
    fewWindows: 0,
  };
  const note = (what: string, ib: IBuilding) => {
    if (samples.length < 10) samples.push(`${what} #${ib.gid} @ ${ib.box.x0 | 0},${ib.box.y0 | 0}`);
  };
  for (const ib of items) {
    const f = shapeIssues(ib.rings);
    for (const k of ['short', 'dense', 'acute', 'selfX'] as const)
      if (f[k]) {
        s[k]++;
        note(k, ib);
      }
    if (!RESIDENTIAL.has(ib.b.kind) || f.longWalls <= 0 || ib.gid % windowSample) continue;
    const sb = solve(ib);
    if (!sb) continue;
    const win = groundWindows(sb);
    s.windows += win;
    if (win < f.longWalls / WALL_PER_WINDOW_M) {
      s.fewWindows++;
      note('fewWindows', ib);
    }
  }
  return s;
}
