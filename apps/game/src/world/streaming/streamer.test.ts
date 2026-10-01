import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../chunk.js';
import {
  LOD_FAR,
  LOD_MID,
  LOD_NEAR,
  STREAM_PRESETS,
  type Lod,
  type StreamConfig,
} from './rings.js';
import type { WorldChunk, WorldChunkSource } from './source.js';
import { ChunkStreamer, type BuiltChunk, type ChunkBuilder } from './streamer.js';
import { StressWorldSource } from './stress-source.js';

const cfg: StreamConfig = {
  ...STREAM_PRESETS.medium,
  radii: [1, 2, 3],
  maxChunks: [100, 100, 100],
  maxFetches: 64,
  buildBudgetMs: Infinity,
};

/** Builder that only books what is alive. */
class FakeBuilder implements ChunkBuilder {
  readonly alive = new Map<string, Lod>();
  built = 0;
  build(cx: number, cy: number, lod: Lod): BuiltChunk {
    const key = `${cx},${cy},${lod}`;
    if (this.alive.has(key)) throw new Error(`double build ${key}`);
    this.alive.set(key, lod);
    this.built++;
    return {
      bytes: 100,
      triangles: 10,
      dispose: () => {
        if (!this.alive.delete(key)) throw new Error(`double dispose ${key}`);
      },
    };
  }
  count(lod: Lod): number {
    return [...this.alive.values()].filter((l) => l === lod).length;
  }
}

function source(over: Partial<WorldChunkSource> = {}): WorldChunkSource {
  return {
    id: 'test',
    version: '1',
    seed: 1,
    chunkSize: CHUNK_SIZE,
    bounds: { cx0: -1000, cy0: -1000, cx1: 1000, cy1: 1000 },
    levels: { min: 0, max: 0 },
    tilePalette: [null],
    getChunk: (cx, cy) =>
      Promise.resolve<WorldChunk>({
        cx,
        cy,
        levels: new Map([[0, { coord: { cx, cy, z: 0 }, floor: new Uint16Array(1024) }]]),
      }),
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const at = (cx: number, cy: number) => [{ x: cx * CHUNK_SIZE + 1, y: cy * CHUNK_SIZE + 1 }];

async function settle(s: ChunkStreamer, points: { x: number; y: number }[], rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    s.update(points);
    await flush();
  }
  s.update(points);
}

describe('ChunkStreamer', () => {
  it('loads the rings around the centre at the right LODs', async () => {
    const b = new FakeBuilder();
    const s = new ChunkStreamer(source(), b, cfg);
    await settle(s, at(0, 0));
    expect([b.count(LOD_NEAR), b.count(LOD_MID), b.count(LOD_FAR)]).toEqual([9, 16, 24]);
    expect(s.lodOf(0, 0)).toBe(LOD_NEAR);
    expect(s.lodOf(2, 2)).toBe(LOD_MID);
    expect(s.lodOf(3, -3)).toBe(LOD_FAR);
    expect(s.stats()).toMatchObject({ built: [9, 16, 24], pending: 0, dataChunks: 49 });
  });

  it('warmup builds the whole near ring before the first frame', async () => {
    const b = new FakeBuilder();
    const s = new ChunkStreamer(source(), b, { ...cfg, maxFetches: 2 });
    await s.warmup(at(5, 5));
    expect(b.count(LOD_NEAR)).toBe(9);
  });

  it('does not thrash when stepping back and forth over a chunk border', async () => {
    const b = new FakeBuilder();
    const s = new ChunkStreamer(source(), b, cfg);
    await settle(s, at(0, 0));
    const before = b.built;
    await settle(s, at(1, 0));
    const afterStep = b.built;
    // Back and forth over the same border: nothing is rebuilt (hysteresis).
    await settle(s, at(0, 0));
    await settle(s, at(1, 0));
    await settle(s, at(0, 0));
    expect(b.built).toBe(afterStep);
    expect(afterStep).toBeGreaterThan(before);
  });

  it('frees everything that leaves the rings (walking 200 chunks keeps memory flat)', async () => {
    const b = new FakeBuilder();
    const s = new ChunkStreamer(source(), b, cfg);
    let maxAlive = 0;
    for (let x = 0; x < 200; x++) {
      await settle(s, at(x, 0), 3);
      maxAlive = Math.max(maxAlive, b.alive.size);
      expect(s.stats().dataChunks).toBeLessThanOrEqual(81);
    }
    const st = s.stats();
    expect(st.created - st.disposed).toBe(b.alive.size);
    expect(st.created).toBeGreaterThan(1000);
    expect(b.alive.size).toBeLessThanOrEqual(81); // (2 * (far + hysteresis) + 1)²
    expect(maxAlive).toBeLessThanOrEqual(81);
    expect(st.bytes).toBe(b.alive.size * 100);
    s.dispose();
    expect(b.alive.size).toBe(0);
    expect(s.stats()).toMatchObject({ bytes: 0, triangles: 0, dataChunks: 0 });
  });

  it('teleport drops the old area and loads the new one', async () => {
    const b = new FakeBuilder();
    const s = new ChunkStreamer(source(), b, cfg);
    await settle(s, at(0, 0));
    await settle(s, at(500, 500));
    expect(s.lodOf(0, 0)).toBeUndefined();
    expect(s.lodOf(500, 500)).toBe(LOD_NEAR);
    expect(b.alive.size).toBe(49);
  });

  it('discards fetches that finish after their chunk left the rings', async () => {
    const pending: (() => void)[] = [];
    const src = source({
      getChunk: (cx, cy) =>
        new Promise((resolve) =>
          pending.push(() =>
            resolve({
              cx,
              cy,
              levels: new Map([[0, { coord: { cx, cy, z: 0 }, floor: new Uint16Array(1024) }]]),
            }),
          ),
        ),
    });
    const b = new FakeBuilder();
    const s = new ChunkStreamer(src, b, cfg);
    s.update(at(0, 0));
    expect(s.stats().fetching).toBe(49);
    s.update(at(100, 100)); // everything aborted, new area requested
    for (const p of pending.splice(0)) p();
    await flush();
    await settle(s, at(100, 100));
    for (const p of pending.splice(0)) p();
    await settle(s, at(100, 100));
    expect(s.lodOf(0, 0)).toBeUndefined();
    expect(s.stats().dataChunks).toBe(49);
    expect(b.alive.size).toBe(49);
  });

  it('respects the per-frame build budget (but always makes progress)', async () => {
    let t = 0;
    const b = new FakeBuilder();
    const slow: ChunkBuilder = {
      build: (cx, cy, lod) => {
        t += 2;
        return b.build(cx, cy, lod);
      },
    };
    const s = new ChunkStreamer(
      source(),
      slow,
      { ...cfg, radii: [0, 2, 3], buildBudgetMs: 5 },
      { now: () => t },
    );
    s.update(at(0, 0));
    await flush();
    s.update(at(0, 0));
    expect(b.built).toBe(3); // 0, 2, 4 ms → third build ends at 6 ms
    s.update(at(0, 0));
    expect(b.built).toBe(6);
  });

  it('builds the 3 × 3 chunks around the centre in one frame regardless of the budget', async () => {
    let t = 0;
    const b = new FakeBuilder();
    const slow: ChunkBuilder = {
      build: (cx, cy, lod) => {
        t += 10;
        return b.build(cx, cy, lod);
      },
    };
    const s = new ChunkStreamer(source(), slow, { ...cfg, buildBudgetMs: 1 }, { now: () => t });
    s.update(at(0, 0));
    await flush();
    s.update(at(0, 0));
    expect(b.count(LOD_NEAR)).toBe(9);
    expect(b.built).toBe(9);
  });

  it('builds far chunks from the summary without fetching them', async () => {
    const src = new StressWorldSource(3);
    const b = new FakeBuilder();
    const s = new ChunkStreamer(src, b, cfg);
    await settle(s, at(125, 125));
    expect(b.count(LOD_FAR)).toBe(24);
    expect(src.generated).toBe(25); // near + mid only
    expect(s.stats().dataChunks).toBe(25);
  });

  it('invalidate refetches and rebuilds a chunk without a hole', async () => {
    let calls = 0;
    let live = 0;
    let builds = 0;
    const base = source();
    const s = new ChunkStreamer(
      source({
        getChunk: (cx, cy) => {
          if (cx === 0 && cy === 0) calls++;
          return base.getChunk(cx, cy);
        },
      }),
      {
        build: () => {
          live++;
          builds++;
          return { bytes: 1, triangles: 1, dispose: () => live-- };
        },
      },
      cfg,
    );
    await settle(s, at(0, 0));
    const before = builds;
    s.invalidate(0, 0);
    expect(s.lodOf(0, 0)).toBe(LOD_NEAR); // old meshes stay meanwhile
    await settle(s, at(0, 0));
    expect(calls).toBe(2);
    expect(builds).toBe(before + 1);
    expect(live).toBe(49);
  });

  it('only builds near chunks while over the GPU budget', async () => {
    const b = new FakeBuilder();
    const s = new ChunkStreamer(source(), b, { ...cfg, gpuBudgetBytes: 450 });
    await settle(s, at(0, 0));
    expect(b.count(LOD_NEAR)).toBe(9);
    expect(b.count(LOD_MID) + b.count(LOD_FAR)).toBe(0);
    expect(s.stats().overBudget).toBe(true);
  });
});
