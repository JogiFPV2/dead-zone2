import { FLOW_UNREACHABLE, type FlowField } from '../ai/state.js';
import type { TileGrid } from '../world/grid.js';
import { DIRS, stepMask } from './grid-nav.js';

/**
 * Flow field (docs 2.5 `nav`): Dijkstra distances (10 / 14) from the target tile in a square
 * window around it. Chasing zombies inside the window step to the neighbour with the smallest
 * distance, O(1) per zombie, which is what makes hordes cheap. Derived state.
 * Dial's buckets (edge costs ≤ 14): bucket `d % 15` holds nodes with tentative distance d.
 */
const BUCKETS = 15;
const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);

export function buildFlowField(
  field: FlowField | undefined,
  grid: TileGrid,
  z: number,
  tx: number,
  ty: number,
  size: number,
  tick: number,
): FlowField {
  const half = size >> 1;
  const f: FlowField =
    field && field.size === size
      ? field
      : {
          ox: 0,
          oy: 0,
          z,
          size,
          dist: new Uint16Array(size * size),
          targetTx: tx,
          targetTy: ty,
          builtTick: tick,
        };
  f.ox = tx - half;
  f.oy = ty - half;
  f.z = z;
  f.targetTx = tx;
  f.targetTy = ty;
  f.builtTick = tick;
  f.dist.fill(FLOW_UNREACHABLE);
  for (const bk of buckets) bk.length = 0;
  const start = half * size + half;
  f.dist[start] = 0;
  buckets[0]!.push(start);
  let pending = 1;
  for (let d = 0; pending > 0; d++) {
    const bk = buckets[d % BUCKETS]!;
    // Nodes appended to this bucket while it is processed have distance d + 15k (k ≥ 1): keep them.
    const cur = bk.splice(0, bk.length);
    pending -= cur.length;
    for (const node of cur) {
      if (f.dist[node] !== d) continue;
      const lx = node % size;
      const ly = (node / size) | 0;
      const wx = lx + f.ox;
      const wy = ly + f.oy;
      const mask = stepMask(grid, z, wx, wy);
      for (let di = 0; di < 8; di++) {
        if ((mask & (1 << di)) === 0) continue;
        const [dx, dy, cost] = DIRS[di]!;
        const nx = lx + dx;
        const ny = ly + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        const nd = d + cost;
        if (nd >= f.dist[ni]!) continue;
        f.dist[ni] = nd;
        buckets[nd % BUCKETS]!.push(ni);
        pending++;
      }
    }
  }
  return f;
}

/**
 * Next tile for a zombie at (tx, ty) following the field: the passable neighbour with the lowest
 * distance (ties by DIRS order). Undefined outside the window or when unreachable. Movement is
 * reversible (same edges both ways), so distances from the target equal distances to it.
 */
export function flowStep(
  f: FlowField,
  grid: TileGrid,
  tx: number,
  ty: number,
): { x: number; y: number } | undefined {
  const lx = tx - f.ox;
  const ly = ty - f.oy;
  if (lx < 0 || ly < 0 || lx >= f.size || ly >= f.size) return undefined;
  const here = f.dist[ly * f.size + lx]!;
  if (here === FLOW_UNREACHABLE) return undefined;
  let best = here;
  let bx = 0;
  let by = 0;
  const mask = stepMask(grid, f.z, tx, ty);
  for (let di = 0; di < 8; di++) {
    if ((mask & (1 << di)) === 0) continue;
    const [dx, dy] = DIRS[di]!;
    const nx = lx + dx;
    const ny = ly + dy;
    if (nx < 0 || ny < 0 || nx >= f.size || ny >= f.size) continue;
    const d = f.dist[ny * f.size + nx]!;
    if (d >= best) continue;
    best = d;
    bx = dx;
    by = dy;
  }
  if (bx === 0 && by === 0) return undefined;
  return { x: tx + bx, y: ty + by };
}
