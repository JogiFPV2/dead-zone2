import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { EdgeDef } from '../chunk.js';
import { LOD_MID, LOD_NEAR, type Lod } from './rings.js';
import type { BuiltChunk, ChunkBuilder } from './streamer.js';
import { DecorLayer } from './decor.js';
import { buildFarGeometry, buildMidGeometry, summarize } from './lod-meshes.js';
import type { ChunkSummary, WorldChunk } from './source.js';

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
  private readonly near = new Map<string, { cx: number; cy: number; levels: number[] }>();
  private readonly material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });

  constructor(private readonly edgePalette: readonly (EdgeDef | null)[] | undefined) {
    this.root.name = 'streamed-lod';
    this.root.add(this.decor.root);
  }

  /** Adds a near layer; it gets every near chunk that is already built. */
  addNearLayer(layer: NearLayer): void {
    this.layers.push(layer);
    for (const { cx, cy, levels } of this.near.values()) {
      for (const z of levels) layer.loadChunk(cx, cy, z);
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
      return this.mesh(buildMidGeometry(data, this.edgePalette), `mid@${cx},${cy}`, true);
    }
    const s = summary ?? (data ? summarize(data) : undefined);
    return this.mesh(s ? buildFarGeometry(s) : undefined, `far@${cx},${cy}`, false);
  }

  dispose(): void {
    this.material.dispose();
    this.decor.dispose();
  }

  private buildNear(cx: number, cy: number, data: WorldChunk): BuiltChunk {
    const levels = [...data.levels.keys()];
    let bytes = 0;
    let triangles = 0;
    for (const z of levels) {
      for (const l of this.layers) {
        const s = l.loadChunk(cx, cy, z);
        if (s) {
          bytes += s.bytes;
          triangles += s.triangles;
        }
      }
    }
    if (data.decor?.length) {
      const s = this.decor.load(cx, cy, data.decor);
      bytes += s.bytes;
      triangles += s.triangles;
    }
    const key = `${cx},${cy}`;
    this.near.set(key, { cx, cy, levels });
    return {
      bytes,
      triangles,
      dispose: () => {
        this.near.delete(key);
        for (const z of levels) for (const l of this.layers) l.unloadChunk(cx, cy, z);
        this.decor.unload(cx, cy);
      },
    };
  }

  private mesh(
    lod: ReturnType<typeof buildMidGeometry>,
    name: string,
    receiveShadow: boolean,
  ): BuiltChunk {
    if (!lod) return { bytes: 0, triangles: 0, dispose: () => {} };
    const mesh = new Mesh(lod.geometry, this.material);
    mesh.name = name;
    mesh.receiveShadow = receiveShadow;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    return {
      bytes: lod.bytes,
      triangles: lod.triangles,
      dispose: () => {
        this.root.remove(mesh);
        lod.geometry.dispose();
      },
    };
  }
}
