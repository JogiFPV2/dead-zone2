import type { IPower } from './plan-index.js';

/** Full width (m) of the tree-free strip under a high-voltage line (przecinka), by voltage. */
export const CLEARING_WIDTH = { hv110: 30, hv220: 40, hv400: 60 } as const;

/**
 * Tiles of a C×C chunk at (X0, Y0) inside a HV line clearing: tile centre within half the
 * clearing width of a line segment. Low voltage lines get none. `undefined` when no tile is hit.
 */
export function clearingMask(
  lines: readonly IPower[],
  X0: number,
  Y0: number,
  C: number,
): Uint8Array | undefined {
  let mask: Uint8Array | undefined;
  for (const w of lines) {
    if (w.kind === 'lv') continue;
    const h = CLEARING_WIDTH[w.kind] / 2;
    for (let i = 2; i + 1 < w.pts.length; i += 2) {
      const ax = w.pts[i - 2]!;
      const ay = w.pts[i - 1]!;
      const dx = w.pts[i]! - ax;
      const dy = w.pts[i + 1]! - ay;
      const l2 = dx * dx + dy * dy || 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, ax + dx) - h - X0));
      const x1 = Math.min(C - 1, Math.ceil(Math.max(ax, ax + dx) + h - X0));
      const y0 = Math.max(0, Math.floor(Math.min(ay, ay + dy) - h - Y0));
      const y1 = Math.min(C - 1, Math.ceil(Math.max(ay, ay + dy) + h - Y0));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = X0 + x + 0.5 - ax;
          const py = Y0 + y + 0.5 - ay;
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
          if (Math.hypot(px - t * dx, py - t * dy) > h) continue;
          (mask ??= new Uint8Array(C * C))[y * C + x] = 1;
        }
    }
  }
  return mask;
}
