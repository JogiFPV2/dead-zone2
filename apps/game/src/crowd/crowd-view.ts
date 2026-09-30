import { CapsuleGeometry, DynamicDrawUsage, InstancedMesh, MeshStandardMaterial } from 'three';
import { PLAYER_HEIGHT } from '../player/player-view.js';
import { PLAYER_RADIUS } from '@deadzone/sim';
import { CROWD_SAMPLE_STRIDE, type CrowdBuffer } from './crowd-buffer.js';
import { writeCrowdMatrices } from './crowd-matrices.js';

/** Neutral grey, slightly darker than the player (#8a9098). */
const CROWD_GREY = '#6b7178';

/**
 * All non-player entities in ONE InstancedMesh. Capacity follows CrowdBuffer (grown in chunks);
 * the mesh is rebuilt only when that capacity grows. One draw call regardless of N.
 */
export class CrowdView {
  mesh: InstancedMesh;
  private readonly geometry: CapsuleGeometry;
  private readonly material = new MeshStandardMaterial({
    color: CROWD_GREY,
    roughness: 1,
    metalness: 0,
  });
  private sampled = new Float32Array(0);

  constructor(
    private readonly buffer: CrowdBuffer,
    private readonly onMeshChange: (next: InstancedMesh, prev: InstancedMesh) => void,
  ) {
    // Low-poly capsule, bottom at y = 0 (same size as the player).
    this.geometry = new CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 2, 8);
    this.geometry.translate(0, PLAYER_HEIGHT / 2, 0);
    this.mesh = this.createMesh(buffer.capacity);
  }

  /** Per frame: interpolate all entities and upload their matrices. */
  update(alpha: number): void {
    if (this.buffer.capacity > this.mesh.instanceMatrix.count) {
      const prev = this.mesh;
      this.mesh = this.createMesh(this.buffer.capacity);
      this.onMeshChange(this.mesh, prev);
      prev.dispose();
    }
    const n = this.buffer.sample(alpha, this.sampled);
    writeCrowdMatrices(this.sampled, n, this.mesh.instanceMatrix.array as Float32Array);
    this.mesh.count = n;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }

  private createMesh(capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometry, this.material, capacity);
    mesh.name = 'crowd';
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    // Entities spread over the whole map and move every frame: skip per-frame bounds.
    mesh.frustumCulled = false;
    this.sampled = new Float32Array(capacity * CROWD_SAMPLE_STRIDE);
    return mesh;
  }
}
