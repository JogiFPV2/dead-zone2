import {
  BoxGeometry,
  CapsuleGeometry,
  Group,
  Mesh,
  Vector3,
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
import { createGripSockets, showSocketAxes, type GripSockets } from '../weapons/grip-sockets.js';
import { isPoolCategory, type HeldHands, type HeldInstance } from '../weapons/held-items.js';
import { gaitClip, targetYaw, wrapAngle } from './locomotion.js';
import {
  LocoBlend,
  RUN_CLIP,
  WALK_CLIP,
  clipTime,
  type LocoPose,
} from '../anim/locomotion-blend.js';
import { LegPose } from '../anim/leg-pose.js';
import { ArmPose, GRIP_SPECS, armBones } from '../anim/arm-pose.js';
import type { BodyState } from '../anim/contract.js';
import {
  FurnitureMoveAnim,
  type FurnitureMoveAction,
  type FurnitureMoveMode,
} from '../anim/furniture-move.js';

/** Body states in which the hands keep the weapon grip (else the clip owns the arms). */
const GRIP_STATES: ReadonlySet<BodyState> = new Set([
  'idle',
  'walk',
  'run',
  'attack',
  'push',
  'climb',
]);

/** Grey-box placeholder sizes (world units). */
export const PLAYER_HEIGHT = 1.6;
const BODY_GREY = '#8a9098';
const INDICATOR_GREY = '#3a3f45';
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
  private readonly loco = new LocoBlend();
  private legs: LegPose | undefined;
  private lastFacing: number | undefined;
  private yawRate = 0;
  private loopTime = 0;
  private lastMs: number | undefined;
  private mounts: WeaponMounts | undefined;
  private held: { key: string; object: Object3D; parent: Group } | undefined;
  private slung: { key: string; object: Object3D } | undefined;
  private weapon: WeaponClass = 'unarmed';
  private hand: WeaponInfo | undefined;
  private arms: ArmPose | undefined;
  private attackStartMs = NaN;
  /** Pushing / pulling / turning a piece of furniture (`moveFurniture`, `furnitureMoved`). */
  private readonly furnitureMove = new FurnitureMoveAnim();
  /** Animation v2 (`?anim=v2`, `ANIM_V2_DEFAULT`): grip sockets, items in hand, arm layer. */
  animV2 = false;
  /** Dev: draw the grip socket axes (`?anim=v2&sockets=1`). */
  showSockets = false;
  /** Grip sockets under the wrists (anim v2 only), placed with the weapon mounts. */
  sockets: GripSockets | undefined;
  /** Items in the hands (anim v2; weapons still come through `setWeapons`). */
  heldHands: HeldHands = {};
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

  /**
   * This character's running `moveFurniture` action (`ActionView.furniture` + progress), or
   * undefined; per frame. The push / pull step plays from the first tick of the action.
   */
  setFurnitureAction(a: FurnitureMoveAction | undefined): void {
    this.furnitureMove.setAction(a, { x: this.motion.x, y: this.motion.y });
  }

  /** The piece this character moved went (`furnitureMoved`): a pull ends a tile back. */
  furnitureMoved(): void {
    this.furnitureMove.completed = true;
  }

  /** Furniture move on screen, undefined = none (dev hook, tests). */
  get furnitureMoveMode(): FurnitureMoveMode | undefined {
    return this.furnitureMove.current;
  }

  /** Replaces the capsule with an animated character (model faces +Z). */
  setModel(object: Object3D, clips: readonly AnimationClip[]): void {
    for (const m of this.meshes) m.visible = false;
    object.rotation.y = Math.PI / 2;
    this.body.add(object);
    // Rest pose for the stride scaling, before any clip moves the bones.
    this.legs = new LegPose(object);
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
    this.hand = hand;
    const m = this.mounts;
    if (!m) return;
    const handKey = hand?.id ?? '';
    if (this.held?.key !== handKey) {
      this.held?.object.removeFromParent();
      this.held = undefined;
      if (hand) {
        // Guns and stabbing weapons point along the fingers; swung weapons out of the fist.
        const spec = hand.grip ? GRIP_SPECS[hand.grip] : undefined;
        const parent = spec
          ? m[spec.mount]
          : hand.cls === 'firearm' || hand.cls === 'stab'
            ? m.handGun
            : m.hand;
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
    // Locomotion from the sim's real speed / acceleration / gait (v13); older data: the drawn
    // body's own (position deltas).
    const loco = this.loco.update({
      speed: p.speed ?? mo.speed,
      accel: p.accel ?? mo.accel,
      gait: p.gait ?? (p.state === 'run' ? 'run' : 'walk'),
      yawRate: this.yawRate,
      dt,
    });
    const pose = this.tracker.pose(
      shown,
      phys ? tickF : nowMs / (1000 / TICKS_PER_SECOND),
      {
        weapon: this.weapon,
        speed: loco.speed,
        clipLen: (a) => this.rig?.length(a) ?? 1,
        loopTime: this.loopTime,
        vz: mo.vz,
      },
      this.animPose,
    );
    // Furniture move: slow push / pull step, heading held (the pull walks backwards).
    const slide = this.furnitureMove.apply(nowMs, dt, pose);
    const moving = this.furnitureMove.active || slide !== undefined;
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
    if (this.lastFacing !== undefined && dt > 0) {
      const w = wrapAngle(mo.facing - this.lastFacing) / dt;
      this.yawRate += (w - this.yawRate) * (1 - Math.exp(-8 * dt));
    }
    this.lastFacing = mo.facing;
    // Movement direction (position deltas) vs. the body: forward, backwards or sideways gait.
    let forward = false;
    if (!moving && (pose.anim === 'walk' || pose.anim === 'run')) {
      const g = gaitClip(mo.facing, mo.vx, mo.vy);
      if (g === 'back' || g === 'strafeLeft' || g === 'strafeRight') pose.anim = g;
      else forward = true;
    }
    this.loopTime += dt * PoseTracker.loopRate(pose.anim, loco.speed);
    // Height = z · floor height of the interpolated sim z (fractional on stairs / falling).
    const w = simToWorld(slide?.x ?? mo.x, slide?.y ?? mo.y, mo.z);
    this.root.position.set(w.x, w.y + pose.lift, w.z);
    this.root.rotation.y = facingToRotationY(mo.facing + pose.twist);
    // Body local +X is the facing: -Z rotation leans forward (accel lean, sprint), X rotation
    // rolls (into turns). Timed states (hits, falls, vaults) bring their own offsets.
    const free = pose.loop && pose.state !== 'climb' && pose.state !== 'driving';
    this.body.rotation.set(
      pose.roll + (free ? loco.roll : 0),
      0,
      -(pose.pitch + (free ? loco.pitch : 0)),
    );
    if (this.held) this.held.object.rotation.x = -pose.recoil * RECOIL_KICK;
    if (!this.rig) return;
    if (forward) {
      // Walk / run at one gait phase; cadence × stride = real speed (anim/locomotion-blend.ts).
      this.rig.locomote(clipTime(WALK_CLIP, loco.phase), clipTime(RUN_CLIP, loco.phase), loco.run);
    } else this.rig.pose(pose.anim, pose.time, pose.loop);
    this.rig.update(dt);
    if (this.legs) {
      this.root.updateMatrixWorld(true);
      this._right.set(0, 0, 1).transformDirection(this.body.matrixWorld);
      this.legs.apply({
        gain: forward ? loco.gain : 1,
        crouch: free ? loco.crouch : 0,
        right: this._right,
      });
    }
    if (!this.mounts) {
      this.root.updateMatrixWorld(true);
      this.mounts = createWeaponMounts(this.rig.object);
      if (this.animV2) {
        this.sockets = createGripSockets(this.rig.object);
        if (this.sockets && this.showSockets) showSocketAxes(this.sockets);
      }
      const right = armBones(this.rig.object, 'R');
      const chest =
        this.rig.object.getObjectByName('Chest') ?? this.rig.object.getObjectByName('Torso');
      this.arms =
        right && chest
          ? new ArmPose(
              right,
              armBones(this.rig.object, 'L'),
              chest,
              this.rig.object,
              this.rig.object.getObjectByName('Head') ?? undefined,
            )
          : undefined;
      return;
    }
    // Grip pose (anim/arm-pose.ts) on top of the clip: hands on the weapon, guns raised.
    if (pose.state === 'attack') {
      if (Number.isNaN(this.attackStartMs)) this.attackStartMs = nowMs;
    } else this.attackStartMs = NaN;
    const attack = Number.isNaN(this.attackStartMs)
      ? NaN
      : Math.min(1, (nowMs - this.attackStartMs) / 450);
    const grip = this.hand?.grip;
    this.lastBodyState = `${pose.state}/${pose.anim}`;
    this.root.updateMatrixWorld(true);
    this.arms?.update(grip ? GRIP_SPECS[grip] : undefined, this.held?.parent, {
      aim: aiming || pose.anim === 'aim' || pose.anim === 'shoot',
      attack,
      active: GRIP_STATES.has(pose.state) && !this.dead,
      dt,
    });
  }

  /**
   * Non-weapon items in the hands this frame for the shared pool (`weapons/held-items.ts`):
   * the grip socket world matrix per item (anim v2 only, empty before the sockets exist).
   */
  heldInstances(out: HeldInstance[] = []): HeldInstance[] {
    const s = this.sockets;
    if (!s || this.dead) return out;
    for (const side of ['R', 'L'] as const) {
      const c = this.heldHands[side];
      if (!isPoolCategory(c)) continue;
      const sock = s.socket(c, side);
      if (!sock) continue;
      sock.updateWorldMatrix(true, false);
      out.push({ category: c, matrix: sock.matrixWorld.clone() });
    }
    return out;
  }

  /**
   * Grip diagnostics (dev hook, tests): held weapon barrel (+Y of its mount) vs the facing (body
   * +X), in degrees, plus the body state and grip blend.
   */
  debugGrip(): { state: string; grip?: string; blend: number; barrelVsFacingDeg: number } {
    this.root.updateMatrixWorld(true);
    const m = this.held?.parent;
    const barrel = m
      ? new Vector3(0, 1, 0).transformDirection(m.matrixWorld)
      : new Vector3(Number.NaN, 0, 0);
    const face = new Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
    return {
      state: this.lastBodyState,
      ...(this.hand?.grip ? { grip: this.hand.grip } : {}),
      blend: this.arms?.blend ?? 0,
      barrelVsFacingDeg: (barrel.angleTo(face) * 180) / Math.PI,
    };
  }
  private lastBodyState = '';
  private readonly _right = new Vector3();

  /** Locomotion blend of the last frame (dev hook, tests, screenshots). */
  debugLoco(): Readonly<LocoPose> {
    return this.loco.pose;
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
