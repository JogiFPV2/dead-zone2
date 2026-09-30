import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { NearbyContainerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';

const GEOMETRY = new BoxGeometry(0.4, 0.2, 0.4);
const MATERIAL = new MeshStandardMaterial({ color: 0x8a8f93, roughness: 0.9 });

/**
 * PLACEHOLDER: ground item piles in reach (`view.nearby`, kind `ground`) as small grey boxes.
 * Only piles near the player are known to the client; F opens them like any container.
 */
export class GroundPiles {
  readonly root = new Group();
  private readonly meshes = new Map<number, Mesh>();
  private last: readonly NearbyContainerView[] | undefined;

  update(nearby: readonly NearbyContainerView[] | undefined): void {
    if (nearby === this.last) return;
    this.last = nearby;
    const seen = new Set<number>();
    for (const c of nearby ?? []) {
      if (c.kind !== 'ground') continue;
      seen.add(c.id);
      let m = this.meshes.get(c.id);
      if (!m) {
        m = new Mesh(GEOMETRY, MATERIAL);
        m.castShadow = true;
        this.meshes.set(c.id, m);
        this.root.add(m);
      }
      const p = simToWorld(c.x + 0.5, c.y + 0.5, c.z);
      m.position.set(p.x, p.y + 0.1, p.z);
    }
    for (const [id, m] of this.meshes) {
      if (seen.has(id)) continue;
      this.root.remove(m);
      this.meshes.delete(id);
    }
  }
}
