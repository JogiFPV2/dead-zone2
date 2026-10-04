import { oRectBounds } from './geom.js';
import { GroundField, isFarmland, type GroundPlan } from './ground.js';
import type { Area, Footprint, TreeLine } from './plan.js';

/** Open-land grid cell (m): a cell is open when it's farmland with nothing on it. */
export const OPEN_CELL = 50;

/** 1 per cell of farmland (by the land cover at the cell centre), before any features. */
export function farmlandMask(plan: GroundPlan): Uint8Array {
  const n = Math.ceil(plan.size / OPEN_CELL);
  const ground = new GroundField(plan);
  const mask = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      mask[y * n + x] = isFarmland(ground.at((x + 0.5) * OPEN_CELL, (y + 0.5) * OPEN_CELL)) ? 1 : 0;
  return mask;
}

/** Clears the cells a building, an area or a tree / shrub stands in (they're not open). */
export function clearFeatures(
  mask: Uint8Array,
  size: number,
  buildings: readonly Footprint[],
  areas: readonly Area[],
  trees: readonly TreeLine[],
): void {
  const n = Math.ceil(size / OPEN_CELL);
  const rect = (r: Footprint | Area) => {
    const b = oRectBounds(r);
    const x0 = Math.max(0, Math.floor(b.x0 / OPEN_CELL));
    const x1 = Math.min(n - 1, Math.floor(b.x1 / OPEN_CELL));
    const y0 = Math.max(0, Math.floor(b.y0 / OPEN_CELL));
    const y1 = Math.min(n - 1, Math.floor(b.y1 / OPEN_CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * n + x] = 0;
  };
  for (const b of buildings) rect(b);
  for (const a of areas) rect(a);
  for (const t of trees)
    for (const p of t.pts) {
      const x = Math.floor(p.x / OPEN_CELL);
      const y = Math.floor(p.y / OPEN_CELL);
      if (x >= 0 && y >= 0 && x < n && y < n) mask[y * n + x] = 0;
    }
}

/** Largest all-open square in the mask: side in cells and its centre (m). */
export function largestOpenSquare(
  mask: Uint8Array,
  size: number,
): { side: number; x: number; y: number } {
  const n = Math.ceil(size / OPEN_CELL);
  const dp = new Uint16Array(n * n);
  let best = { side: 0, x: 0, y: 0 };
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!mask[i]) continue;
      const v =
        x > 0 && y > 0 ? 1 + Math.min(dp[i - 1] ?? 0, dp[i - n] ?? 0, dp[i - n - 1] ?? 0) : 1;
      dp[i] = v;
      if (v > best.side)
        best = { side: v, x: (x + 1 - v / 2) * OPEN_CELL, y: (y + 1 - v / 2) * OPEN_CELL };
    }
  return best;
}
