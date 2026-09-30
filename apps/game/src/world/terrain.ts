import { Group, InstancedMesh, PlaneGeometry, type BufferGeometry, type Material } from 'three';
import { placeholderMaterial } from '../lighting/materials.js';
import type { ChunkRange, ChunkSource, TileId } from './chunk.js';
import { buildTileInstances } from './instances.js';

/** Neutral grey placeholder shades (grey-box stage), cycled by TileId. */
const PLACEHOLDER_GREYS = ['#2b3036', '#353b42', '#40464e', '#4b525b'];

export class Terrain {
  readonly root = new Group();
  private readonly geometry: BufferGeometry;
  private readonly materials = new Map<TileId, Material>();

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
    return group;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.root.clear();
  }

  private material(tileId: TileId): Material {
    let m = this.materials.get(tileId);
    if (!m) {
      const color = PLACEHOLDER_GREYS[tileId % PLACEHOLDER_GREYS.length] ?? '#40464e';
      m = placeholderMaterial(color);
      this.materials.set(tileId, m);
    }
    return m;
  }
}
