import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { PLAYER_RADIUS } from '@deadzone/sim';
import { facingToRotationY, simToWorld } from '../sim/coords.js';
import type { EntityState } from '../sim/snapshot.js';

/** Grey-box placeholder sizes (world units). */
export const PLAYER_HEIGHT = 1.6;
const BODY_GREY = '#8a9098';
const INDICATOR_GREY = '#3a3f45';

/** Neutral grey capsule with a darker nose on local +X showing facing. */
export class PlayerView {
  readonly root = new Group();
  private readonly meshes: Mesh[] = [];

  constructor() {
    this.root.name = 'player';
    const body = new Mesh(
      new CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 4, 12),
      new MeshStandardMaterial({ color: BODY_GREY, roughness: 1, metalness: 0 }),
    );
    body.position.y = PLAYER_HEIGHT / 2;
    const nose = new Mesh(
      new BoxGeometry(0.22, 0.12, 0.14),
      new MeshStandardMaterial({ color: INDICATOR_GREY, roughness: 1, metalness: 0 }),
    );
    nose.position.set(PLAYER_RADIUS + 0.05, PLAYER_HEIGHT * 0.75, 0);
    this.meshes.push(body, nose);
    this.root.add(body, nose);
  }

  /** Places the view at a sim state (x, y floor, z level, facing). */
  apply(state: EntityState): void {
    const p = simToWorld(state.x, state.y, state.z);
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = facingToRotationY(state.facing);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
  }
}
