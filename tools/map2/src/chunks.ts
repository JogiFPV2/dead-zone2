/** Edges per 32 m chunk (client chunk size), keyed "cx,cy" in the local frame. */
import type { Edge } from './graph.js';

export const CHUNK = 32;

export function chunkIndex(edges: readonly Edge[]): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (const e of edges) {
    const pad = e.p.width / 2 + Math.max(...e.p.sidewalk);
    const keys = new Set<string>();
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1]!;
      const b = e.pts[i]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CHUNK / 2)));
      for (let k = 0; k <= steps; k++) {
        const x = a[0] + ((b[0] - a[0]) * k) / steps;
        const y = a[1] + ((b[1] - a[1]) * k) / steps;
        for (let cx = Math.floor((x - pad) / CHUNK); cx <= Math.floor((x + pad) / CHUNK); cx++)
          for (let cy = Math.floor((y - pad) / CHUNK); cy <= Math.floor((y + pad) / CHUNK); cy++)
            keys.add(`${cx},${cy}`);
      }
    }
    for (const k of keys) {
      const l = idx.get(k) ?? [];
      l.push(e.id);
      idx.set(k, l);
    }
  }
  return idx;
}
