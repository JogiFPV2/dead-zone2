import { inBounds, type ChunkBounds } from './source.js';

/** Level of detail of a streamed chunk: near = full detail, mid = merged, far = impostor. */
export const LOD_NEAR = 0;
export const LOD_MID = 1;
export const LOD_FAR = 2;
export type Lod = typeof LOD_NEAR | typeof LOD_MID | typeof LOD_FAR;
export const LODS: readonly Lod[] = [LOD_NEAR, LOD_MID, LOD_FAR];
export const LOD_NAMES = ['near', 'mid', 'far'] as const;

export type ViewDistance = 'low' | 'medium' | 'high';
export const VIEW_DISTANCES: readonly ViewDistance[] = ['low', 'medium', 'high'];

export interface StreamConfig {
  /** Ring radii in chunks (Chebyshev distance to the nearest centre), near ≤ mid ≤ far. */
  radii: readonly [number, number, number];
  /** Extra chunks a loaded chunk may drift past its ring before it is downgraded / unloaded. */
  hysteresis: number;
  /** Hard caps of built chunks per ring; overflow is demoted to the next ring (or dropped). */
  maxChunks: readonly [number, number, number];
  /** CPU time per frame for building chunk meshes (at least one build always runs). */
  buildBudgetMs: number;
  /** Concurrent `getChunk` calls. */
  maxFetches: number;
  /** Cap for the estimated GPU bytes of streamed geometry; above it only near chunks build. */
  gpuBudgetBytes: number;
}

const MB = 1024 * 1024;

/**
 * Presets per graphics setting `viewDistance`. At the default zoom the isometric view shows
 * about ±1.5 chunks around the target (±2 at max zoom-out), so the near ring alone covers
 * everything on screen; mid and far are prefetch / zoom-out headroom.
 */
export const STREAM_PRESETS: Readonly<Record<ViewDistance, StreamConfig>> = {
  low: {
    radii: [2, 3, 5],
    hysteresis: 1,
    maxChunks: [36, 49, 120],
    buildBudgetMs: 3,
    maxFetches: 2,
    gpuBudgetBytes: 48 * MB,
  },
  medium: {
    radii: [2, 4, 7],
    hysteresis: 1,
    maxChunks: [36, 100, 240],
    buildBudgetMs: 4,
    maxFetches: 4,
    gpuBudgetBytes: 96 * MB,
  },
  high: {
    radii: [3, 5, 9],
    hysteresis: 1,
    maxChunks: [64, 140, 400],
    buildBudgetMs: 5,
    maxFetches: 6,
    gpuBudgetBytes: 160 * MB,
  },
};

export interface ChunkXY {
  cx: number;
  cy: number;
}

export const chunkKey = (cx: number, cy: number): string => `${cx},${cy}`;

/** Chebyshev distance (chunks) from (cx, cy) to the nearest centre. */
export function chunkDistance(cx: number, cy: number, centers: readonly ChunkXY[]): number {
  let d = Infinity;
  for (const c of centers) d = Math.min(d, Math.max(Math.abs(cx - c.cx), Math.abs(cy - c.cy)));
  return d;
}

/**
 * Wanted LOD at distance `dist` given the currently built LOD (hysteresis): upgrades happen at
 * the ring radius, downgrades / unloads only `hysteresis` chunks further out.
 */
export function ringLod(
  dist: number,
  current: Lod | undefined,
  cfg: StreamConfig,
): Lod | undefined {
  for (const lod of LODS) {
    const keep = current !== undefined && current <= lod ? cfg.hysteresis : 0;
    if (dist <= cfg.radii[lod] + keep) return lod;
  }
  return undefined;
}

export interface PlannedChunk extends ChunkXY {
  key: string;
  dist: number;
  lod: Lod;
}

/**
 * Chunks wanted around `centers`, with their LOD, sorted by priority (distance, then LOD).
 * `current` = built LOD per key (for hysteresis). Ring caps demote the farthest overflow.
 */
export function planChunks(
  centers: readonly ChunkXY[],
  current: (key: string) => Lod | undefined,
  currentKeys: Iterable<ChunkXY>,
  cfg: StreamConfig,
  bounds: ChunkBounds,
): PlannedChunk[] {
  const seen = new Map<string, PlannedChunk>();
  const consider = (cx: number, cy: number) => {
    const key = chunkKey(cx, cy);
    if (seen.has(key) || !inBounds(bounds, cx, cy)) return;
    const dist = chunkDistance(cx, cy, centers);
    const lod = ringLod(dist, current(key), cfg);
    if (lod !== undefined) seen.set(key, { key, cx, cy, dist, lod });
  };
  const r = cfg.radii[LOD_FAR];
  for (const c of centers) {
    for (let cy = c.cy - r; cy <= c.cy + r; cy++) {
      for (let cx = c.cx - r; cx <= c.cx + r; cx++) consider(cx, cy);
    }
  }
  for (const c of currentKeys) consider(c.cx, c.cy);
  const out = [...seen.values()].sort((a, b) => a.dist - b.dist || a.lod - b.lod);
  // Caps: walk by priority, demote overflow to coarser rings, drop what fits nowhere.
  const used = [0, 0, 0];
  const kept: PlannedChunk[] = [];
  for (const p of out) {
    let lod: number = p.lod;
    while (lod <= LOD_FAR && (used[lod] ?? 0) >= cfg.maxChunks[lod as Lod]) lod++;
    if (lod > LOD_FAR) continue;
    used[lod] = (used[lod] ?? 0) + 1;
    kept.push(lod === p.lod ? p : { ...p, lod: lod as Lod });
  }
  return kept;
}
