import type { ChunkRange } from '../world/chunk.js';

/** Animals per 32 m chunk at the start of a new world, and the limits. */
const PER_CHUNK = 0.4;
const MIN = 6;
const MAX = 300;

/** Start animal count for a new world on `range` (`?animals=N` overrides). */
export function startAnimalCount(range: ChunkRange, override?: number): number {
  if (override !== undefined) return override;
  const chunks = (range.cx1 - range.cx0 + 1) * (range.cy1 - range.cy0 + 1);
  return Math.max(MIN, Math.min(MAX, Math.round(chunks * PER_CHUNK)));
}
