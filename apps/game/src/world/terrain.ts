import { Group, InstancedMesh, PlaneGeometry, type BufferGeometry, type Material } from 'three';
import { placeholderMaterial } from '../lighting/materials.js';
import type { ChunkRange, ChunkSource, TileId } from './chunk.js';
import { buildTileInstances } from './instances.js';

/** Neutral grey placeholder shades (grey-box stage), cycled by TileId. */
const PLACEHOLDER_GREYS = ['#2b3036', '#353b42', '#40464e', '#4b525b'];

/** Placeholder colour of a floor TileId (shared with the merged mid / far LOD meshes). */
export const tileGrey = (tileId: TileId): string =>
  PLACEHOLDER_GREYS[tileId % PLACEHOLDER_GREYS.length] ?? '#40464e';

/** GPU-side size of a built chunk part (streaming budget, perf overlay). */
export interface PartStats {
  bytes: number;
  triangles: number;
}

export class Terrain {
  readonly root = new Group();
  private readonly geometry: BufferGeometry;
  private readonly materials = new Map<TileId, Material>();
  private readonly chunks = new Map<string, Group>();

  constructor(private readonly source: ChunkSource) {
    this.geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.root.name = 'terrain';
  }

  /** Builds one Group per chunk with one InstancedMesh per tile type. */
  loadRange(range: ChunkRange): void {
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) this.loadChunk(cx, cy, range.z);
    }
  }

  loadChunk(cx: number, cy: number, z: number): Group | undefined {
    const chunk = this.source.getChunk(cx, cy, z);
    if (!chunk) return undefined;
    this.unloadChunk(cx, cy, z);
    const group = new Group();
    group.name = `chunk:${cx},${cy},${z}`;
    for (const { tileId, count, matrices } of buildTileInstances(chunk)) {
      const mesh = new InstancedMesh(this.geometry, this.material(tileId), count);
      mesh.instanceMatrix.array.set(matrices);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = this.source.tilePalette[tileId] ?? `tile:${tileId}`;
      // Flat floor: receives shadows, never casts.
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.root.add(group);
    this.chunks.set(`${cx},${cy},${z}`, group);
    return group;
  }

  /** Instance buffers of a loaded chunk (the tile geometry is shared). */
  statsOf(cx: number, cy: number, z: number): PartStats {
    const out = { bytes: 0, triangles: 0 };
    for (const m of this.chunks.get(`${cx},${cy},${z}`)?.children ?? []) {
      if (m instanceof InstancedMesh) {
        out.bytes += m.count * 64;
        out.triangles += m.count * 2;
      }
    }
    return out;
  }

  /** Removes a chunk and frees its instance buffers (geometry / materials are shared). */
  unloadChunk(cx: number, cy: number, z: number): void {
    const key = `${cx},${cy},${z}`;
    const group = this.chunks.get(key);
    if (!group) return;
    this.chunks.delete(key);
    for (const m of group.children) if (m instanceof InstancedMesh) m.dispose();
    this.root.remove(group);
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.root.clear();
    this.chunks.clear();
  }

  private material(tileId: TileId): Material {
    let m = this.materials.get(tileId);
    if (!m) {
      m = placeholderMaterial(tileGrey(tileId));
      this.materials.set(tileId, m);
    }
    return m;
  }
}
