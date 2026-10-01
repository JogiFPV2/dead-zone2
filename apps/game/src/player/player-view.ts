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
import { PLAYER_RADIUS, TICKS_PER_SECOND } from '@deadzone/sim';
import { facingToRotationY, simToWorld } from '../sim/coords.js';
import type { EntityState } from '../sim/snapshot.js';
import type { PhysState } from '../anim/contract.js';
import { BodyMotion, PLAYER_MOTION } from '../anim/motion.js';
import { PoseTracker, newPose, type WeaponClass } from '../anim/pose.js';
import type { WeaponInfo } from '../weapons/weapon-kinds.js';
import type { WeaponModels } from '../weapons/weapon-models.js';
import { createWeaponMounts, type WeaponMounts } from './weapon-mount.js';
import { gaitClip, targetYaw } from './locomotion.js';

/** Grey-box placeholder sizes (world units). */
export const PLAYER_HEIGHT = 1.6;
const BODY_GREY = '#8a9098';
const INDICATOR_GREY = '#3a3f45';
/** Lean per tiles/s^2 of forward acceleration (rad), capped. */
const ACCEL_LEAN = 0.012;
const MAX_ACCEL_LEAN = 0.12;
/** Firearm kick of the held gun (rad at recoil 1). */
const RECOIL_KICK = 0.7;
/** Turn rate while falling to face the hit (rad/s). */
const FALL_TURN = 14;

/** Player body: grey capsule placeholder, then an animated character with held / slung weapons. */
export class PlayerView {
  readonly root = new Group();
  /** Tilt pivot (lean / stagger / fall offsets) between the root and the body. */
  private readonly body = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly motion = new BodyMotion();
  private readonly tracker = new PoseTracker();
  private readonly animPose = newPose();
  private loopTime = 0;
  private lastMs: number | undefined;
  private mounts: WeaponMounts | undefined;
  private held: { key: string; object: Object3D; parent: Group } | undefined;
  private slung: { key: string; object: Object3D } | undefined;
  private weapon: WeaponClass = 'unarmed';
  /** Aiming (set by the game from input): the body faces the cursor instead of the movement. */
  aiming = false;
  /** Fallback state when no physics state is passed (mock / tests). */
  private readonly own: PhysState = {
    facing: 0,
    vel: { x: 0, y: 0 },
    maxSpeed: 0,
    state: 'idle',
    stateStartTick: 0,
    stateDuration: 0,
    knockback: { dirX: 0, dirY: 0, strength: 0 },
    lastHitTick: -1,
    hitFromDir: 0,
    gaitSeed: 0,
  };

  constructor() {
    this.root.name = 'player';
    this.body.rotation.order = 'YZX';
    this.root.add(this.body);
    const body = new Mesh(
      new CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 4, 12),
      placeholderMaterial(BODY_GREY),
    );
    body.position.y = PLAYER_HEIGHT / 2;
    const nose = new Mesh(new BoxGeometry(0.22, 0.12, 0.14), placeholderMaterial(INDICATOR_GREY));
    nose.position.set(PLAYER_RADIUS + 0.05, PLAYER_HEIGHT * 0.75, 0);
    for (const m of [body, nose]) m.castShadow = m.receiveShadow = true;
    this.meshes.push(body, nose);
    this.body.add(body, nose);
  }

  private rig: CharacterRig | undefined;

  /** Replaces the capsule with an animated character (model faces +Z). */
  setModel(object: Object3D, clips: readonly AnimationClip[]): void {
    for (const m of this.meshes) m.visible = false;
    object.rotation.y = Math.PI / 2;
    this.body.add(object);
    this.rig = new CharacterRig(object, clips);
    this.rig.pose('idle', 0, true);
    // Mounts are placed from the first animated pose (clips rescale some bones vs. bind pose).
    this.mounts = undefined;
    this.held = this.slung = undefined;
  }

  /**
   * Weapon in the right hand (`hand`) and slung on the back (`back`); undefined = none. Models
   * come from `models` (placeholder shapes until they load).
   */
  setWeapons(
    hand: WeaponInfo | undefined,
    back: WeaponInfo | undefined,
    models: WeaponModels,
  ): void {
    this.weapon = hand?.cls ?? 'unarmed';
    const m = this.mounts;
    if (!m) return;
    const handKey = hand?.id ?? '';
    if (this.held?.key !== handKey) {
      this.held?.object.removeFromParent();
      this.held = undefined;
      if (hand) {
        // Guns and stabbing weapons point along the fingers; swung weapons out of the fist.
        const parent = hand.cls === 'firearm' || hand.cls === 'stab' ? m.handGun : m.hand;
        const object = models.create(hand);
        parent.add(object);
        this.held = { key: handKey, object, parent };
        void models.load(hand).then(() => {
          if (this.held?.key !== handKey) return;
          this.held.object.removeFromParent();
          this.held.object = models.create(hand);
          parent.add(this.held.object);
        });
      }
    }
    const backKey = back?.id ?? '';
    if (this.slung?.key !== backKey) {
      this.slung?.object.removeFromParent();
      this.slung = undefined;
      if (back) {
        const place = (o: Object3D): Object3D => {
          // Centre the weapon on the back (weapon space origin is the grip).
          o.position.y = -back.length * 0.4;
          m.back.add(o);
          return o;
        };
        this.slung = { key: backKey, object: place(models.create(back)) };
        void models.load(back).then(() => {
          if (this.slung?.key !== backKey) return;
          this.slung.object.removeFromParent();
          this.slung.object = place(models.create(back));
        });
      }
    }
  }

  /**
   * Places the view at a sim state (x, y floor, z level, facing) with the physics / animation
   * state `phys` at fractional tick `tickF` (contract, `anim/phys-adapter.ts`).
   */
  apply(state: EntityState, nowMs = performance.now(), phys?: PhysState, tickF = 0): void {
    const dt = this.lastMs === undefined ? 0 : Math.max(0, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    const p = phys ?? this.ownState(state, dt);
    const shown = this.dead && p.state !== 'dead' ? { ...p, state: 'dead' as const } : p;
    const mo = this.motion;
    const pose = this.tracker.pose(
      shown,
      phys ? tickF : nowMs / (1000 / TICKS_PER_SECOND),
      {
        weapon: this.weapon,
        speed: mo.speed,
        clipLen: (a) => this.rig?.length(a) ?? 1,
        loopTime: this.loopTime,
      },
      this.animPose,
    );
    const turning = !Number.isNaN(pose.faceTo);
    // PZ-like (player/locomotion.ts): the body turns to the movement, or to the sim facing
    // (cursor, turned by the sim at a capped rate) while aiming / attacking / holding a gun aim.
    const aiming = this.aiming || pose.state === 'attack' || pose.anim === 'aim';
    const face = turning
      ? pose.faceTo
      : targetYaw({ facing: state.facing, vx: mo.vx, vy: mo.vy, aiming }, mo.facing);
    mo.update(
      state.x,
      state.y,
      state.z,
      face,
      p.vel.x * TICKS_PER_SECOND,
      p.vel.y * TICKS_PER_SECOND,
      dt,
      PLAYER_MOTION,
      turning ? FALL_TURN : PLAYER_MOTION.turnRate,
      pose.lockFacing,
    );
    // Movement direction (position deltas) vs. the body: forward, backwards or sideways gait.
    if (pose.anim === 'walk' || pose.anim === 'run') {
      const g = gaitClip(mo.facing, mo.vx, mo.vy);
      if (g === 'back' || g === 'strafeLeft' || g === 'strafeRight') pose.anim = g;
    }
    this.loopTime += dt * PoseTracker.loopRate(pose.anim, mo.speed);
    const w = simToWorld(mo.x, mo.y, state.z);
    this.root.position.set(w.x, w.y, w.z);
    this.root.rotation.y = facingToRotationY(mo.facing + pose.twist);
    const lean = Math.max(-MAX_ACCEL_LEAN, Math.min(MAX_ACCEL_LEAN, mo.accel * ACCEL_LEAN));
    // Body local +X is the facing: -Z rotation leans forward, X rotation rolls.
    this.body.rotation.set(pose.roll, 0, -(pose.pitch + lean));
    if (this.held) this.held.object.rotation.x = -pose.recoil * RECOIL_KICK;
    if (!this.rig) return;
    this.rig.pose(pose.anim, pose.time, pose.loop);
    this.rig.update(dt);
    if (!this.mounts) {
      this.root.updateMatrixWorld(true);
      this.mounts = createWeaponMounts(this.rig.object);
    }
  }

  /** Minimal state from the snapshot alone (no adapter): locomotion from position deltas. */
  private last: { x: number; y: number } | undefined;
  private ownState(state: EntityState, dt: number): PhysState {
    const o = this.own;
    const l = this.last;
    if (l && dt > 0) {
      o.vel.x = (state.x - l.x) / dt / TICKS_PER_SECOND;
      o.vel.y = (state.y - l.y) / dt / TICKS_PER_SECOND;
    }
    this.last = { x: state.x, y: state.y };
    o.facing = state.facing;
    o.state = Math.hypot(o.vel.x, o.vel.y) > 0.01 ? 'walk' : 'idle';
    return o;
  }

  dead = false;

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as MeshStandardMaterial).dispose();
    }
  }
}
