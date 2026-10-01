import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  type AnimationClip,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { CharacterRig } from '../models/character-rig.js';
import { placeholderMaterial } from '../lighting/materials.js';
import { PLAYER_RADIUS } from '@deadzone/sim';
import { facingToRotationY, simToWorld } from '../sim/coords.js';
import type { EntityState } from '../sim/snapshot.js';
import { approachAngle, gaitClip, targetYaw } from './locomotion.js';

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
      placeholderMaterial(BODY_GREY),
    );
    body.position.y = PLAYER_HEIGHT / 2;
    const nose = new Mesh(new BoxGeometry(0.22, 0.12, 0.14), placeholderMaterial(INDICATOR_GREY));
    nose.position.set(PLAYER_RADIUS + 0.05, PLAYER_HEIGHT * 0.75, 0);
    for (const m of [body, nose]) m.castShadow = m.receiveShadow = true;
    this.meshes.push(body, nose);
    this.root.add(body, nose);
  }

  private rig: CharacterRig | undefined;
  private last: { x: number; y: number; t: number } | undefined;
  /** Smoothed velocity (tiles/s; snapshots arrive at 20 Hz, frames faster). */
  private vx = 0;
  private vy = 0;
  /** Rendered body yaw (sim angle); turns smoothly towards movement or the cursor. */
  private yaw: number | undefined;
  /** Aiming (set by the game from input): the body faces the cursor instead of the movement. */
  aiming = false;

  /** Replaces the capsule with an animated character (model faces +Z). */
  setModel(object: Object3D, clips: readonly AnimationClip[]): void {
    for (const m of this.meshes) m.visible = false;
    object.rotation.y = Math.PI / 2;
    this.root.add(object);
    this.rig = new CharacterRig(object, clips);
    this.rig.play('idle');
  }

  /** Places the view at a sim state (x, y floor, z level, facing). */
  apply(state: EntityState, nowMs = performance.now()): void {
    const p = simToWorld(state.x, state.y, state.z);
    this.root.position.set(p.x, p.y, p.z);
    const l = this.last;
    const dtMs = l ? nowMs - l.t : 0;
    if (l && dtMs > 0) {
      const k = 0.2;
      this.vx += ((state.x - l.x) / (dtMs / 1000) - this.vx) * k;
      this.vy += ((state.y - l.y) / (dtMs / 1000) - this.vy) * k;
    }
    this.last = { x: state.x, y: state.y, t: nowMs };
    // Without a model the capsule nose keeps showing the raw sim facing (aim).
    if (!this.rig) {
      this.root.rotation.y = facingToRotationY(state.facing);
      return;
    }
    const input = { facing: state.facing, vx: this.vx, vy: this.vy, aiming: this.aiming };
    const prev = this.yaw ?? state.facing;
    this.yaw = this.dead ? prev : approachAngle(prev, targetYaw(input, prev), dtMs);
    this.root.rotation.y = facingToRotationY(this.yaw);
    if (dtMs > 0) this.rig.update(dtMs / 1000);
    this.rig.play(this.dead ? 'dead' : gaitClip(this.yaw, this.vx, this.vy));
  }

  dead = false;

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
  }
}
