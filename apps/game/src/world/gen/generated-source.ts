import { TILE_PALETTE, EDGE_PALETTE } from '@deadzone/map/world-source';
import { CHUNK_SIZE } from '../chunk.js';
import type { ContentId, EdgeDef } from '../chunk.js';
import type { WorldChunk, WorldChunkSource } from '../streaming/source.js';
import { columnToWorldChunk } from './convert.js';
import type { GeneratedMapSpec } from './maps.js';
import type { FromChunkWorker, GenWorldInfo, ToChunkWorker } from './protocol.js';

/** Minimal worker surface (tests drive the generator in-process). */
export interface ChunkWorkerLike {
  postMessage(m: ToChunkWorker): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<FromChunkWorker>) => void): void;
  terminate(): void;
}

/** Client chunk timing (perf overlay / report): generation in the worker, round trip here. */
export interface GenChunkStats {
  count: number;
  /** Worker generation ms per chunk (ring buffer of the last 512). */
  genMs: number[];
  /** Request → data ms per chunk (queueing included). */
  roundMs: number[];
}

/** Percentile of a sample (p in 0..1). */
export function percentile(a: readonly number[], p: number): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

/**
 * `WorldChunkSource` of a generated map (docs/streaming.md): chunks are generated lazily in a
 * worker from the world plan (deterministic; same seed + version = same chunk), returned with
 * chunk-local geometry. Tile / edge ids index the generator's fixed palettes.
 */
export class GeneratedWorldSource implements WorldChunkSource {
  readonly chunkSize = CHUNK_SIZE;
  readonly id: string;
  readonly version: string;
  readonly seed: number;
  readonly tilePalette: readonly (ContentId | null)[];
  readonly edgePalette: readonly (EdgeDef | null)[];
  readonly bounds: { cx0: number; cy0: number; cx1: number; cy1: number };
  readonly levels: { min: number; max: number };
  readonly stats: GenChunkStats = { count: 0, genMs: [], roundMs: [] };
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (c: WorldChunk | undefined) => void; t0: number }
  >();

  private constructor(
    readonly info: GenWorldInfo,
    private readonly worker: ChunkWorkerLike,
  ) {
    this.id = `gen:${info.id}`;
    this.version = info.version;
    this.seed = info.seed;
    this.tilePalette = TILE_PALETTE as readonly (ContentId | null)[];
    this.edgePalette = EDGE_PALETTE as readonly (EdgeDef | null)[];
    this.bounds = { ...info.bounds };
    this.levels = { min: 0, max: info.maxLevel };
    worker.addEventListener('message', (e) => this.onMessage(e.data));
  }

  /** Starts the chunk worker and waits for the plan (OSM file fetch + index, or plan-4). */
  static async open(
    spec: GeneratedMapSpec,
    worker: ChunkWorkerLike,
  ): Promise<GeneratedWorldSource> {
    const info = await new Promise<GenWorldInfo>((resolve, reject) => {
      const on = (e: MessageEvent<FromChunkWorker>) => {
        if (e.data.t === 'ready') resolve(e.data.info);
        else if (e.data.t === 'error') reject(new Error(e.data.message));
      };
      worker.addEventListener('message', on);
      worker.postMessage({ t: 'init', spec });
    });
    return new GeneratedWorldSource(info, worker);
  }

  getChunk(cx: number, cy: number, signal?: AbortSignal): Promise<WorldChunk | undefined> {
    const b = this.bounds;
    if (cx < b.cx0 || cy < b.cy0 || cx > b.cx1 || cy > b.cy1) return Promise.resolve(undefined);
    if (signal?.aborted) return Promise.reject(signal.reason as Error);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, t0: performance.now() });
      // The worker cannot cancel a running chunk; an aborted fetch just drops the answer.
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.delete(id)) reject(signal.reason as Error);
        },
        { once: true },
      );
      this.worker.postMessage({ t: 'chunk', id, cx, cy });
    });
  }

  private onMessage(m: FromChunkWorker): void {
    if (m.t !== 'chunk') return;
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    const s = this.stats;
    s.genMs[s.count % 512] = m.ms;
    s.roundMs[s.count % 512] = performance.now() - p.t0;
    s.count++;
    p.resolve(m.col ? columnToWorldChunk(m.col) : undefined);
  }

  dispose(): void {
    for (const p of this.pending.values()) p.resolve(undefined);
    this.pending.clear();
    this.worker.terminate();
  }
}
