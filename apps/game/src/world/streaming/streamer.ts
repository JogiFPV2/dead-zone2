import { CHUNK_SIZE } from '../chunk.js';
import {
  LOD_FAR,
  LOD_NEAR,
  chunkKey,
  planChunks,
  type ChunkXY,
  type Lod,
  type PlannedChunk,
  type StreamConfig,
} from './rings.js';
import {
  LoadedChunks,
  inBounds,
  type ChunkSummary,
  type WorldChunk,
  type WorldChunkSource,
} from './source.js';

/** GPU-side result of building one chunk at one LOD. */
export interface BuiltChunk {
  /** Estimated GPU bytes of geometry owned by this chunk (shared caches excluded). */
  readonly bytes: number;
  readonly triangles: number;
  /** Removes it from the scene and frees everything it owns (not shared caches). */
  dispose(): void;
}

/** Builds render objects for a chunk; `data` is undefined only for summary-only far chunks. */
export interface ChunkBuilder {
  build(
    cx: number,
    cy: number,
    lod: Lod,
    data: WorldChunk | undefined,
    summary: ChunkSummary | undefined,
  ): BuiltChunk;
  /**
   * Deferred work of earlier builds (e.g. upper storeys of near chunks), done within `budgetMs`
   * after the frame's builds. Returns whether work is left.
   */
  step?(budgetMs: number): boolean;
}

interface Rec {
  readonly cx: number;
  readonly cy: number;
  readonly key: string;
  dist: number;
  want: Lod;
  /** undefined = not fetched, null = outside the world (nothing to build). */
  data?: WorldChunk | null;
  summary?: ChunkSummary;
  fetch?: AbortController;
  built?: { lod: Lod; chunk: BuiltChunk };
  /** Data changed (`invalidate`): rebuild at the same LOD once the new data is in. */
  rebuild?: boolean;
}

export interface StreamStats {
  /** Built chunks per LOD [near, mid, far]. */
  built: [number, number, number];
  /** Chunks wanted (planned) per LOD. */
  wanted: [number, number, number];
  /** Wanted chunks still waiting for data or a build. */
  pending: number;
  fetching: number;
  /** Chunk columns held in memory (data). */
  dataChunks: number;
  bytes: number;
  triangles: number;
  /** Lifetime counters (leak checks: created - disposed = built total). */
  created: number;
  disposed: number;
  fetched: number;
  overBudget: boolean;
  /** Last frame's build time (ms). */
  buildMs: number;
}

export interface StreamerOptions {
  now?: () => number;
  /** Called after a chunk's data arrives / before it is dropped (sync view consumers). */
  onData?: (chunk: WorldChunk) => void;
  onDrop?: (cx: number, cy: number) => void;
}

/**
 * Ring-based chunk streaming around one or more centres (player, camera target): plans wanted
 * chunks with hysteresis, fetches them by priority (bounded concurrency, cancellable), builds /
 * swaps LOD meshes within a per-frame time budget and disposes everything that leaves the rings.
 * Three.js-free: rendering is the builder's job, so the bookkeeping is unit-tested.
 */
export class ChunkStreamer {
  readonly loaded: LoadedChunks;
  private readonly recs = new Map<string, Rec>();
  private centers: ChunkXY[] = [];
  private centersKey = '';
  private dirty = true;
  private fetching = 0;
  private readonly now: () => number;
  private counters = { created: 0, disposed: 0, fetched: 0 };
  private bytes = 0;
  private triangles = 0;
  private buildMs = 0;
  private disposed = false;

  constructor(
    readonly source: WorldChunkSource,
    private readonly builder: ChunkBuilder,
    private cfg: StreamConfig,
    private readonly opts: StreamerOptions = {},
  ) {
    if (source.chunkSize !== CHUNK_SIZE) {
      throw new Error(`chunk size ${source.chunkSize} ≠ ${CHUNK_SIZE} (one grid with the sim)`);
    }
    this.loaded = new LoadedChunks(source);
    this.now = opts.now ?? (() => performance.now());
  }

  get config(): StreamConfig {
    return this.cfg;
  }

  setConfig(cfg: StreamConfig): void {
    this.cfg = cfg;
    this.dirty = true;
  }

  /** Built LOD of a chunk (tests, debugging). */
  lodOf(cx: number, cy: number): Lod | undefined {
    return this.recs.get(chunkKey(cx, cy))?.built?.lod;
  }

  /**
   * The chunk's source data changed (e.g. a sim `chunkChanged` diff applied by the source):
   * refetch it and rebuild at the current LOD; the old meshes stay until the new ones exist.
   */
  invalidate(cx: number, cy: number): void {
    const r = this.recs.get(chunkKey(cx, cy));
    if (!r) return;
    r.fetch?.abort();
    delete r.fetch;
    delete r.data;
    r.rebuild = true;
  }

  /** Points in tile coordinates (sim x, y), e.g. player and camera target. */
  setCenters(points: readonly { x: number; y: number }[]): void {
    const centers = points.map((p) => ({
      cx: Math.floor(p.x / CHUNK_SIZE),
      cy: Math.floor(p.y / CHUNK_SIZE),
    }));
    const key = centers.map((c) => chunkKey(c.cx, c.cy)).join('|');
    if (key === this.centersKey) return;
    this.centersKey = key;
    this.centers = centers;
    this.dirty = true;
  }

  /** One frame: replan if needed, start fetches, build within the time budget. */
  update(points?: readonly { x: number; y: number }[]): void {
    if (this.disposed) return;
    if (points) this.setCenters(points);
    if (this.dirty) this.replan();
    this.pump();
    this.buildSome(this.cfg.buildBudgetMs);
  }

  /** Fetches and builds the near ring completely (initial load, teleport); resolves when done. */
  async warmup(points: readonly { x: number; y: number }[]): Promise<void> {
    this.setCenters(points);
    this.replan();
    for (;;) {
      this.pump();
      // Near chunks and their neighbours (edge ownership across chunk borders).
      const r0 = this.cfg.radii[LOD_NEAR] + 1;
      const waiting = [...this.recs.values()].filter((r) => r.dist <= r0 && r.data === undefined);
      if (waiting.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.disposed) return;
    }
    this.buildSome(Infinity, LOD_NEAR);
  }

  stats(): StreamStats {
    const built: [number, number, number] = [0, 0, 0];
    const wanted: [number, number, number] = [0, 0, 0];
    let pending = 0;
    for (const r of this.recs.values()) {
      wanted[r.want]++;
      if (r.built) built[r.built.lod]++;
      if (r.data !== null && r.built?.lod !== r.want) pending++;
    }
    return {
      built,
      wanted,
      pending,
      fetching: this.fetching,
      dataChunks: this.loaded.size,
      bytes: this.bytes,
      triangles: this.triangles,
      ...this.counters,
      overBudget: this.bytes > this.cfg.gpuBudgetBytes,
      buildMs: this.buildMs,
    };
  }

  dispose(): void {
    for (const r of [...this.recs.values()]) this.drop(r);
    this.disposed = true;
  }

  private replan(): void {
    this.dirty = false;
    if (this.centers.length === 0) return;
    const plan = planChunks(
      this.centers,
      (key) => this.recs.get(key)?.built?.lod,
      this.recs.values(),
      this.cfg,
      this.source.bounds,
    );
    const keep = new Set<string>();
    for (const p of plan) {
      keep.add(p.key);
      const r = this.recs.get(p.key);
      if (r) {
        r.dist = p.dist;
        r.want = p.lod;
      } else this.recs.set(p.key, this.rec(p));
    }
    for (const r of [...this.recs.values()]) if (!keep.has(r.key)) this.drop(r);
  }

  private rec(p: PlannedChunk): Rec {
    return { cx: p.cx, cy: p.cy, key: p.key, dist: p.dist, want: p.lod };
  }

  /** Far chunks can build from the macro-plan summary alone. */
  private summaryOnly(r: Rec): boolean {
    if (r.want !== LOD_FAR || !this.source.getSummary) return false;
    if (r.summary === undefined) {
      const s = this.source.getSummary(r.cx, r.cy);
      if (!s) return false;
      r.summary = s;
    }
    return true;
  }

  private pump(): void {
    if (this.fetching >= this.cfg.maxFetches) return;
    const todo = [...this.recs.values()]
      .filter((r) => r.data === undefined && !r.fetch && !this.summaryOnly(r))
      .sort((a, b) => a.dist - b.dist || a.want - b.want);
    for (const r of todo) {
      if (this.fetching >= this.cfg.maxFetches) break;
      this.startFetch(r);
    }
  }

  private startFetch(r: Rec): void {
    const ctrl = new AbortController();
    r.fetch = ctrl;
    this.fetching++;
    const done = () => {
      this.fetching--;
      if (r.fetch === ctrl) delete r.fetch;
    };
    this.source.getChunk(r.cx, r.cy, ctrl.signal).then(
      (chunk) => {
        done();
        // Dropped (left the rings) while loading: discard.
        if (ctrl.signal.aborted || this.recs.get(r.key) !== r) return;
        this.counters.fetched++;
        r.data = chunk ?? null;
        if (chunk) {
          this.loaded.set(chunk);
          this.opts.onData?.(chunk);
        }
        this.pump();
      },
      (err: unknown) => {
        done();
        if (!ctrl.signal.aborted) console.warn(`chunk ${r.key} failed to load`, err);
      },
    );
  }

  /** Data needed by `want` is there; near also needs its N / W neighbours (edge ownership). */
  private ready(r: Rec): boolean {
    if (r.data === null) return false;
    if (r.data === undefined) return r.want === LOD_FAR && r.summary !== undefined;
    if (r.want !== LOD_NEAR) return true;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = r.cx + dx;
      const ny = r.cy + dy;
      if (!inBounds(this.source.bounds, nx, ny)) continue;
      const n = this.recs.get(chunkKey(nx, ny));
      if (n && n.data === undefined) return false;
    }
    return true;
  }

  private buildSome(budgetMs: number, onlyLod?: Lod): void {
    const t0 = this.now();
    const todo = [...this.recs.values()]
      .filter(
        (r) =>
          (r.built?.lod !== r.want || r.rebuild === true) &&
          (onlyLod === undefined || r.want === onlyLod),
      )
      .filter((r) => this.ready(r))
      .sort((a, b) => a.dist - b.dist || a.want - b.want);
    let n = 0;
    for (const r of todo) {
      // The chunks right around the centre are visible: they never wait (teleport, first frame).
      const urgent = r.want === LOD_NEAR && r.dist <= 1;
      if (n > 0 && !urgent && this.now() - t0 >= budgetMs) break;
      if (r.want !== LOD_NEAR && this.bytes > this.cfg.gpuBudgetBytes) continue;
      const chunk = this.builder.build(r.cx, r.cy, r.want, r.data ?? undefined, r.summary);
      this.counters.created++;
      this.bytes += chunk.bytes;
      this.triangles += chunk.triangles;
      // New LOD first, then the old one goes: no holes while swapping.
      if (r.built) this.release(r.built.chunk);
      r.built = { lod: r.want, chunk };
      r.rebuild = false;
      n++;
    }
    // Deferred builder work with what is left of the budget (at least a slice per frame).
    if (this.builder.step) this.builder.step(Math.max(1, budgetMs - (this.now() - t0)));
    this.buildMs = this.now() - t0;
  }

  private release(chunk: BuiltChunk): void {
    chunk.dispose();
    this.counters.disposed++;
    this.bytes -= chunk.bytes;
    this.triangles -= chunk.triangles;
  }

  private drop(r: Rec): void {
    r.fetch?.abort();
    if (r.built) this.release(r.built.chunk);
    delete r.built;
    if (r.data) {
      this.opts.onDrop?.(r.cx, r.cy);
      this.loaded.delete(r.cx, r.cy);
    }
    this.recs.delete(r.key);
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [0, -1],
];
