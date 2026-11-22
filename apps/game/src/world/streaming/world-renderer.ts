import { BatchedMesh, type BufferGeometry, Group, Matrix4, MeshStandardMaterial } from 'three';
import { CHUNK_SIZE, type EdgeDef } from '../chunk.js';
import { LOD_MID, LOD_NEAR, type Lod } from './rings.js';
import type { BuiltChunk, ChunkBuilder } from './streamer.js';
import { DecorLayer } from './decor.js';
import {
  buildFarGeometry,
  buildFarVectorGeometry,
  buildMidGeometry,
  hasVector,
  summarize,
  type TilePalette,
} from './lod-meshes.js';
import type { ChunkSummary, WorldChunk } from './source.js';

/**
 * Mid / far chunks of one LOD in ONE BatchedMesh (per-chunk frustum culling inside): a draw call
 * per LOD instead of one per chunk (~200 calls at a zoomed-out view). Grows on demand, repacks
 * (`optimize`) before growing; dropped when the last chunk leaves (nothing left on the GPU).
 */
class LodBatch {
  private mesh: BatchedMesh | undefined;
  private verts = 0;
  private instances = 0;
  private live = 0;
  private readonly m = new Matrix4();

  constructor(
    private readonly root: Group,
    private readonly material: MeshStandardMaterial,
    private readonly name: string,
    private readonly receiveShadow: boolean,
  ) {}

  add(g: BufferGeometry, x: number, z: number): number {
    const n = g.getAttribute('position').count;
    if (!this.mesh) {
      this.verts = Math.max(65536, n * 2);
      this.instances = 64;
      const mesh = new BatchedMesh(this.instances, this.verts, 0, this.material);
      mesh.name = this.name;
      mesh.receiveShadow = this.receiveShadow;
      mesh.castShadow = false;
      // Culled per chunk (perObjectFrustumCulled); the batch's own bounds would go stale.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.mesh = mesh;
    }
    const mesh = this.mesh;
    if (n > mesh.unusedVertexCount) {
      mesh.optimize();
      if (n > mesh.unusedVertexCount) {
        this.verts = Math.max(this.verts * 2, this.verts + n);
        mesh.setGeometrySize(this.verts, 0);
      }
    }
    if (mesh.instanceCount >= this.instances) {
      this.instances *= 2;
      mesh.setInstanceCount(this.instances);
    }
    const gid = mesh.addGeometry(g);
    const id = mesh.addInstance(gid);
    mesh.setMatrixAt(id, this.m.makeTranslation(x, 0, z));
    this.live++;
    return gid;
  }

  remove(gid: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    mesh.deleteGeometry(gid);
    if (--this.live > 0) return;
    this.root.remove(mesh);
    mesh.dispose();
    this.mesh = undefined;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.root.remove(this.mesh);
    this.mesh.dispose();
    this.mesh = undefined;
    this.live = 0;
  }
}

/** A full-detail per-chunk layer (terrain, structures, map objects); reads the loaded chunks. */
export interface NearLayer {
  loadChunk(cx: number, cy: number, z: number): { bytes: number; triangles: number } | void;
  unloadChunk(cx: number, cy: number, z: number): void;
}

/**
 * Builds streamed chunks: near = the game's own per-chunk layers (unchanged visuals) + instanced
 * decor; mid = one merged vertex-coloured mesh; far = one coarse impostor mesh. Mid / far share
 * one material, so the GPU cost is one draw call per mid / far chunk (frustum-culled).
 */
export class StreamedWorldRenderer implements ChunkBuilder {
  readonly root = new Group();
  readonly decor = new DecorLayer();
  private readonly layers: NearLayer[] = [];
  /** Near chunks currently built: key → levels. */
  private readonly near = new Map<
    string,
    { cx: number; cy: number; levels: number[]; built: [NearLayer, number][] }
  >();
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });

  private readonly midBatch: LodBatch;
  private readonly farBatch: LodBatch;

  constructor(
    private readonly edgePalette: readonly (EdgeDef | null)[] | undefined,
    private readonly drawDecor = true,
    /** Floor palette: distant ground in its real colours (water, grass, roads); else greys. */
    private readonly tilePalette?: TilePalette,
  ) {
    this.root.name = 'streamed-lod';
    this.midBatch = new LodBatch(this.root, this.material, 'lod-mid', true);
    this.farBatch = new LodBatch(this.root, this.material, 'lod-far', false);
    this.root.add(this.decor.root);
  }

  /** Adds a near layer; it gets every near chunk that is already built. */
  addNearLayer(layer: NearLayer): void {
    this.layers.push(layer);
    for (const [key, e] of this.near) {
      for (const z of e.levels) {
        if (z > 0) {
          this.jobs.push({ key, cx: e.cx, cy: e.cy, z, layer });
          continue;
        }
        layer.loadChunk(e.cx, e.cy, z);
        e.built.push([layer, z]);
      }
    }
  }

  build(
    cx: number,
    cy: number,
    lod: Lod,
    data: WorldChunk | undefined,
    summary: ChunkSummary | undefined,
  ): BuiltChunk {
    if (lod === LOD_NEAR && data) return this.buildNear(cx, cy, data);
    if (lod === LOD_MID && data) {
      return this.mesh(
        buildMidGeometry(data, this.edgePalette, this.tilePalette),
        cx,
        cy,
        this.midBatch,
      );
    }
    if (data && hasVector(data))
      return this.mesh(buildFarVectorGeometry(data, this.tilePalette), cx, cy, this.farBatch);
    const s = summary ?? (data ? summarize(data) : undefined);
    return this.mesh(s ? buildFarGeometry(s, this.tilePalette) : undefined, cx, cy, this.farBatch);
  }

  dispose(): void {
    this.midBatch.dispose();
    this.farBatch.dispose();
    this.material.dispose();
    this.decor.dispose();
  }

  /**
   * Upper storeys (z > 0) of near chunks still to build, one (layer, level) per job: the ground
   * level replaces the mid LOD at once, the storeys follow over the next frames within the
   * streamer's build budget (`step`).
   */
  private readonly jobs: { key: string; cx: number; cy: number; z: number; layer: NearLayer }[] =
    [];

  step(budgetMs: number): boolean {
    const t0 = performance.now();
    let n = 0;
    while (this.jobs.length > 0) {
      if (n > 0 && performance.now() - t0 >= budgetMs) break;
      const j = this.jobs.shift()!;
      const e = this.near.get(j.key);
      if (!e) continue;
      j.layer.loadChunk(j.cx, j.cy, j.z);
      e.built.push([j.layer, j.z]);
      n++;
    }
    return this.jobs.length > 0;
  }

  /** Deferred storeys waiting (tests / perf). */
  get pendingJobs(): number {
    return this.jobs.length;
  }

  private buildNear(cx: number, cy: number, data: WorldChunk): BuiltChunk {
    const levels = [...data.levels.keys()].sort((a, b) => a - b);
    const key = `${cx},${cy}`;
    const entry = { cx, cy, levels, built: [] as [NearLayer, number][] };
    this.near.set(key, entry);
    let bytes = 0;
    let triangles = 0;
    for (const z of levels) {
      for (const l of this.layers) {
        if (z > 0) {
          this.jobs.push({ key, cx, cy, z, layer: l });
          continue;
        }
        const s = l.loadChunk(cx, cy, z);
        entry.built.push([l, z]);
        if (s) {
          bytes += s.bytes;
          triangles += s.triangles;
        }
      }
    }
    if (this.drawDecor && data.decor?.length) {
      const s = this.decor.load(cx, cy, data.decor);
      bytes += s.bytes;
      triangles += s.triangles;
    }
    return {
      bytes,
      triangles,
      dispose: () => {
        if (this.near.get(key) === entry) this.near.delete(key);
        for (let i = this.jobs.length - 1; i >= 0; i--)
          if (this.jobs[i]!.key === key) this.jobs.splice(i, 1);
        for (const [l, z] of entry.built) l.unloadChunk(cx, cy, z);
        this.decor.unload(cx, cy);
      },
    };
  }

  private mesh(
    lod: ReturnType<typeof buildMidGeometry>,
    cx: number,
    cy: number,
    batch: LodBatch,
  ): BuiltChunk {
    if (!lod) return { bytes: 0, triangles: 0, dispose: () => {} };
    // Chunk-relative geometry: the instance sits at the chunk origin. Copied into the batch.
    const gid = batch.add(lod.geometry, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
    lod.geometry.dispose();
    return {
      bytes: lod.bytes,
      triangles: lod.triangles,
      dispose: () => batch.remove(gid),
    };
  }
}
