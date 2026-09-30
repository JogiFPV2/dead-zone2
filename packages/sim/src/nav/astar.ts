import type { TileGrid } from '../world/grid.js';
import { DIRS, stepMask } from './grid-nav.js';

/**
 * A* on tiles (docs 2.5 `nav`): 8 directions, costs 10 / 14, octile heuristic, ties broken by
 * (f, h, tile index) so the result never depends on heap internals. The search runs in a window
 * around start and goal; it stops after `maxNodes` expansions (then the caller moves straight).
 */
const MARGINS = [24, 64] as const;
const MAX_SIDE = 256;

let cap = 0;
let gArr = new Int32Array(0);
let parent = new Int32Array(0);
let stamp = new Uint32Array(0);
let closed = new Uint32Array(0);
let gen = 0;
// Binary heap of node indices keyed by (f, h, idx).
let heap = new Int32Array(0);
let heapF = new Int32Array(0);
let heapH = new Int32Array(0);
let heapLen = 0;

function ensure(n: number): void {
  if (n <= cap) return;
  cap = n;
  gArr = new Int32Array(n);
  parent = new Int32Array(n);
  stamp = new Uint32Array(n);
  closed = new Uint32Array(n);
  // Every relaxation pushes (no decrease-key): at most 8 per node, plus the start.
  heap = new Int32Array(n * 8 + 1);
  heapF = new Int32Array(n * 8 + 1);
  heapH = new Int32Array(n * 8 + 1);
}

const less = (i: number, j: number): boolean =>
  heapF[i]! < heapF[j]! ||
  (heapF[i] === heapF[j] &&
    (heapH[i]! < heapH[j]! || (heapH[i] === heapH[j] && heap[i]! < heap[j]!)));

function swap(i: number, j: number): void {
  const a = heap[i]!,
    f = heapF[i]!,
    h = heapH[i]!;
  heap[i] = heap[j]!;
  heapF[i] = heapF[j]!;
  heapH[i] = heapH[j]!;
  heap[j] = a;
  heapF[j] = f;
  heapH[j] = h;
}

function push(idx: number, f: number, h: number): void {
  let i = heapLen++;
  heap[i] = idx;
  heapF[i] = f;
  heapH[i] = h;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!less(i, p)) break;
    swap(i, p);
    i = p;
  }
}

function pop(): number {
  const top = heap[0]!;
  heapLen--;
  if (heapLen > 0) {
    heap[0] = heap[heapLen]!;
    heapF[0] = heapF[heapLen]!;
    heapH[0] = heapH[heapLen]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heapLen && less(l, m)) m = l;
      if (r < heapLen && less(r, m)) m = r;
      if (m === i) break;
      swap(i, m);
      i = m;
    }
  }
  return top;
}

const octile = (dx: number, dy: number): number => {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  return ax > ay ? 14 * ay + 10 * (ax - ay) : 14 * ax + 10 * (ay - ax);
};

export interface AStarResult {
  /** Tiles from the first step to the goal as x, y pairs; undefined = no path within limits. */
  tiles: Int32Array | undefined;
  expanded: number;
}

/**
 * Path from tile (sx, sy) to (gx, gy). The window is the bounding box plus 24 tiles; when that
 * window is exhausted (not the node limit) the search is retried once with 64 tiles.
 */
export function findPath(
  grid: TileGrid,
  z: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  maxNodes: number,
): AStarResult {
  if (sx === gx && sy === gy) return { tiles: new Int32Array(0), expanded: 0 };
  let expanded = 0;
  for (const margin of MARGINS) {
    const r = search(grid, z, sx, sy, gx, gy, maxNodes - expanded, margin);
    expanded += r.expanded;
    if (r.tiles || r.expanded >= maxNodes || expanded >= maxNodes)
      return { tiles: r.tiles, expanded };
  }
  return { tiles: undefined, expanded };
}

function search(
  grid: TileGrid,
  z: number,
  sx: number,
  sy: number,
  gx: number,
  gy: number,
  maxNodes: number,
  margin: number,
): AStarResult {
  const ox = Math.min(sx, gx) - margin;
  const oy = Math.min(sy, gy) - margin;
  const w = Math.max(sx, gx) + margin - ox + 1;
  const h = Math.max(sy, gy) + margin - oy + 1;
  if (w > MAX_SIDE || h > MAX_SIDE) return { tiles: undefined, expanded: 0 };
  ensure(w * h);
  gen = (gen + 1) >>> 0;
  if (gen === 0) {
    stamp.fill(0);
    closed.fill(0);
    gen = 1;
  }
  heapLen = 0;
  const start = (sy - oy) * w + (sx - ox);
  const goal = (gy - oy) * w + (gx - ox);
  gArr[start] = 0;
  parent[start] = -1;
  stamp[start] = gen;
  push(start, octile(gx - sx, gy - sy), octile(gx - sx, gy - sy));
  let expanded = 0;
  while (heapLen > 0) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (cur === goal) break;
    if (++expanded > maxNodes) return { tiles: undefined, expanded };
    const cx = (cur % w) + ox;
    const cy = ((cur / w) | 0) + oy;
    const gc = gArr[cur]!;
    const mask = stepMask(grid, z, cx, cy);
    for (let d = 0; d < 8; d++) {
      if ((mask & (1 << d)) === 0) continue;
      const [dx, dy, cost] = DIRS[d]!;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < ox || ny < oy || nx >= ox + w || ny >= oy + h) continue;
      const ni = (ny - oy) * w + (nx - ox);
      if (closed[ni] === gen) continue;
      const ng = gc + cost;
      if (stamp[ni] === gen && gArr[ni]! <= ng) continue;
      stamp[ni] = gen;
      gArr[ni] = ng;
      parent[ni] = cur;
      const hh = octile(gx - nx, gy - ny);
      push(ni, ng + hh, hh);
    }
  }
  if (closed[goal] !== gen) return { tiles: undefined, expanded };
  let n = 0;
  for (let i = goal; i !== start; i = parent[i]!) n++;
  const tiles = new Int32Array(n * 2);
  let k = n - 1;
  for (let i = goal; i !== start; i = parent[i]!) {
    tiles[k * 2] = (i % w) + ox;
    tiles[k * 2 + 1] = ((i / w) | 0) + oy;
    k--;
  }
  return { tiles, expanded };
}
