import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { InstancedMesh, Mesh, type Object3D } from 'three';
import { LOD_FAR, LOD_MID, LOD_NEAR } from './rings.js';
import { createWorldStreaming } from './setup.js';
import { STREAM_PRESETS } from './rings.js';
import { STRESS_WORLD_CHUNKS, StressWorldSource } from './stress-source.js';
import { buildFarGeometry, buildMidGeometry, summarize } from './lod-meshes.js';

/** Counts live BufferGeometries via their dispose events. */
function trackGeometries() {
  let created = 0;
  let disposed = 0;
  const live = new Set<BufferGeometry>();
  return {
    note(root: Object3D) {
      root.traverse((o) => {
        if (!(o instanceof Mesh) || o instanceof InstancedMesh) return;
        const g = o.geometry as BufferGeometry;
        if (live.has(g)) return;
        live.add(g);
        created++;
        g.addEventListener('dispose', () => disposed++);
      });
    },
    get created() {
      return created;
    },
    get disposed() {
      return disposed;
    },
  };
}

describe('LOD meshes', () => {
  const src = new StressWorldSource(1);
  const mid = STRESS_WORLD_CHUNKS / 2;
  const chunk = src.generate(mid, mid)!;

  it('mid LOD is one merged mesh, far LOD is much cheaper', () => {
    const m = buildMidGeometry(chunk, src.edgePalette)!;
    const f = buildFarGeometry(summarize(chunk))!;
    expect(m.triangles).toBeGreaterThan(100);
    expect(f.triangles).toBeLessThan(m.triangles / 4);
    expect(f.triangles).toBeLessThan(400);
    expect(m.geometry.getAttribute('color').count).toBe(m.triangles * 3);
  });
});

describe('StreamedWorldRenderer disposal', () => {
  it('builds and frees near / mid / far chunks without leaking scene objects', async () => {
    const src = new StressWorldSource(1);
    const w = createWorldStreaming(src, {
      ...STREAM_PRESETS.low,
      radii: [1, 2, 3],
      buildBudgetMs: Infinity,
      maxFetches: 64,
    });
    const tracker = trackGeometries();
    const c = src.centre;
    const step = async (x: number) => {
      for (let i = 0; i < 5; i++) {
        w.streamer.update([{ x: c.x + x * 32, y: c.y }]);
        await new Promise((r) => setTimeout(r, 0));
      }
      tracker.note(w.lod.root);
    };
    await step(0);
    const st = w.streamer.stats();
    expect(st.built[LOD_NEAR]).toBe(9);
    expect(st.built[LOD_MID]).toBe(16);
    expect(st.built[LOD_FAR]).toBe(24);
    expect(w.terrain.loadedChunks).toBeGreaterThanOrEqual(9);
    const lodMeshes = w.lod.root.children.filter((o) => o instanceof Mesh).length;
    expect(lodMeshes).toBeLessThanOrEqual(40);
    for (let x = 1; x <= 30; x++) await step(x);
    // Scene stays bounded while walking 30 chunks.
    expect(w.terrain.loadedChunks).toBeLessThanOrEqual(2 * 16);
    expect(w.lod.root.children.filter((o) => o instanceof Mesh).length).toBeLessThanOrEqual(
      (2 * 4 + 1) ** 2,
    );
    expect(tracker.disposed).toBeGreaterThan(0);
    w.streamer.dispose();
    expect(w.terrain.loadedChunks).toBe(0);
    expect(w.structures.partCount).toBe(0);
    expect(w.mapObjects.count).toBe(0);
    expect(w.lod.decor.loadedChunks).toBe(0);
    expect(w.lod.root.children.filter((o) => o instanceof Mesh)).toHaveLength(0);
    // Every per-chunk LOD geometry that was created got disposed.
    expect(tracker.disposed).toBe(tracker.created);
  });
});
