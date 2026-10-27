import { Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import type { Grip } from '../weapons/grip.js';

/**
 * Weapon grips on top of the clips (PZ-like holds): after the mixer pose, the right arm is
 * solved (two-bone IK) to the grip's hand target with the weapon pointing along the grip's
 * direction, the left hand goes onto the shaft / handguard (second grip point on the weapon).
 * Targets live in the body frame (chest origin; f = forward, u = up, r = right of the
 * character, world units); weights and targets blend over time so switching weapons, aiming
 * and attacks transition smoothly.
 */

export interface BodyVec {
  f: number;
  u: number;
  r: number;
}

export interface GripPose {
  /** Right hand (grip point) target from the chest. */
  hand: BodyVec;
  /** Weapon +Y direction (handle → head / stock → muzzle). */
  dir: BodyVec;
  /** Weapon "up" hint (+Z of the mount: back of the hand). */
  up: BodyVec;
  /** Left hand on the weapon at this distance along +Y from the grip (undefined = free). */
  left?: number;
  /** Extra body-frame offset of the left-hand target (e.g. under the handguard). */
  leftOffset?: BodyVec;
  /** `hand` is relative to the chest bone (default) or to the right shoulder. */
  anchor?: 'chest' | 'shoulderR';
  /**
   * Bladed stance: shoulder line turned by this much (rad, right shoulder back) from square to
   * the facing, whatever the clip does; the head is turned back to the facing.
   */
  twist?: number;
  /** Head tilt: forward pitch and roll towards the right shoulder (rad; cheek on the stock). */
  headPitch?: number;
  headRoll?: number;
}

export interface GripSpec {
  /** Mount the model sits in: melee fist (`hand`) or along the fingers (`handGun`). */
  mount: 'hand' | 'handGun';
  rest: GripPose;
  /** Aiming / firing (guns); default = rest. */
  aim?: GripPose;
  /** Melee attacks: right arm follows the clip swing (left hand stays on the weapon). */
  swingByClip: boolean;
  /** Thrust during an attack (stab grips): hand moves forward by this much at mid-blow. */
  thrust?: number;
}

const v = (f: number, u: number, r: number): BodyVec => ({ f, u, r });

/** Hand placement per grip (`deadzone` character, 1.6 m tall; chest ≈ 1.15 m). */
export const GRIP_SPECS: Record<Grip, GripSpec | undefined> = {
  one_hand: undefined,
  two_hand: {
    mount: 'hand',
    // Low guard: shaft up and forward across the body, left hand above the right.
    rest: { hand: v(0.22, -0.32, 0.12), dir: v(0.45, 0.85, -0.25), up: v(1, 0, 0), left: 0.16 },
    swingByClip: true,
  },
  knife: {
    mount: 'handGun',
    rest: { hand: v(0.3, -0.25, 0.2), dir: v(1, 0.35, 0), up: v(0, 1, 0) },
    swingByClip: false,
    thrust: 0.32,
  },
  spear: {
    mount: 'handGun',
    rest: { hand: v(0.08, -0.22, 0.16), dir: v(1, 0.12, -0.12), up: v(0, 1, 0), left: 0.42 },
    swingByClip: false,
    thrust: 0.38,
  },
  pistol: {
    mount: 'handGun',
    // Low ready; aiming: both arms out (isosceles), gun in front of the right eye, support hand
    // wrapped under the grip.
    rest: { hand: v(0.24, -0.33, 0.2), dir: v(1, -0.7, 0), up: v(0, 1, 0) },
    aim: {
      anchor: 'shoulderR',
      hand: v(0.38, 0.03, -0.12),
      dir: v(1, 0, 0),
      up: v(0, 1, 0),
      left: 0,
      leftOffset: v(-0.02, -0.03, -0.05),
    },
    swingByClip: false,
  },
  rifle: {
    mount: 'handGun',
    rest: { hand: v(0.16, -0.16, 0.16), dir: v(1, -0.45, -0.25), up: v(0, 1, 0), left: 0.3 },
    // Shouldered: butt in the right shoulder pocket (grip = butt + stock length 0.3 × 0.95 m),
    // barrel level along the facing, bladed stance so the left hand reaches under the
    // handguard, cheek down on the stock.
    aim: {
      anchor: 'shoulderR',
      hand: v(0.32, 0.08, -0.04),
      dir: v(1, 0, 0),
      up: v(0, 1, 0),
      left: 0.16,
      leftOffset: v(0, -0.035, 0),
      twist: 0.6,
      headPitch: 0.22,
      headRoll: 0.2,
    },
    swingByClip: false,
  },
  chainsaw: {
    mount: 'handGun',
    rest: { hand: v(0.34, -0.38, 0.12), dir: v(1, 0.05, 0), up: v(0, 1, 0), left: 0.1 },
    swingByClip: false,
    thrust: 0.18,
  },
};

export interface ArmBones {
  upper: Object3D;
  lower: Object3D;
  wrist: Object3D;
}

/** glTF node names lose their dots in three.js (`Wrist.R` -> `WristR`). */
function bone(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));
}

export function armBones(root: Object3D, side: 'L' | 'R'): ArmBones | undefined {
  const upper = bone(root, `UpperArm.${side}`);
  const lower = bone(root, `LowerArm.${side}`);
  const wrist = bone(root, `Wrist.${side}`);
  return upper && lower && wrist ? { upper, lower, wrist } : undefined;
}

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _m = new Matrix4();

const wpos = (o: Object3D, out: Vector3): Vector3 => out.setFromMatrixPosition(o.matrixWorld);

/** Rotates bone `o` (in world space) by `delta`, keeping its world position. */
function rotateWorld(o: Object3D, delta: Quaternion): void {
  const world = o.getWorldQuaternion(_q);
  const target = _q2.copy(delta).multiply(world);
  const parent = o.parent;
  if (parent) {
    parent.getWorldQuaternion(_q);
    o.quaternion.copy(_q.invert().multiply(target));
  } else o.quaternion.copy(target);
  o.updateMatrixWorld(true);
}

/** Sets the world rotation of bone `o`. */
export function setWorldQuaternion(o: Object3D, q: Quaternion): void {
  const parent = o.parent;
  if (parent) {
    parent.getWorldQuaternion(_q);
    o.quaternion.copy(_q.invert().multiply(q));
  } else o.quaternion.copy(q);
  o.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK: places the wrist at `target` (clamped to reach), the elbow bending
 * towards `pole` (world direction). Bone lengths come from the current pose.
 */
export function solveTwoBone(arm: ArmBones, target: Vector3, pole: Vector3): void {
  const s = wpos(arm.upper, new Vector3());
  const e = wpos(arm.lower, new Vector3());
  const w = wpos(arm.wrist, new Vector3());
  const a = s.distanceTo(e);
  const b = e.distanceTo(w);
  if (a < 1e-5 || b < 1e-5) return;
  const toT = _a.copy(target).sub(s);
  const d = Math.min(Math.max(toT.length(), Math.abs(a - b) + 1e-4), (a + b) * 0.999);
  const n = toT.normalize();
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const m = _b.copy(pole).addScaledVector(n, -pole.dot(n));
  if (m.lengthSq() < 1e-8) m.set(0, -1, 0).addScaledVector(n, n.y);
  m.normalize();
  const elbow = new Vector3()
    .copy(s)
    .addScaledVector(n, a * cosA)
    .addScaledVector(m, a * sinA);
  // Upper arm: current elbow direction → desired.
  rotateWorld(
    arm.upper,
    new Quaternion().setFromUnitVectors(
      _c.copy(e).sub(s).normalize(),
      elbow.clone().sub(s).normalize(),
    ),
  );
  const e2 = wpos(arm.lower, new Vector3());
  const w2 = wpos(arm.wrist, new Vector3());
  const wrist = new Vector3().copy(s).addScaledVector(n, d);
  rotateWorld(
    arm.lower,
    new Quaternion().setFromUnitVectors(w2.sub(e2).normalize(), wrist.sub(e2).normalize()),
  );
}

/** Smoothly blended grip state of one character. */
export class ArmPose {
  private weight = 0;
  private leftWeight = 0;
  private readonly hand = new Vector3();
  private readonly dir = new Vector3(1, 0, 0);
  private readonly up = new Vector3(0, 1, 0);
  private left = 0;
  private readonly leftOff = new Vector3();
  private twist = 0;
  private headPitch = 0;
  private headRoll = 0;
  private anchorShoulder = 0;
  private started = false;
  /** Targets snap to the pose the first frame a grip appears (no lerp from the origin). */
  private fresh = true;

  constructor(
    private readonly right: ArmBones,
    private readonly leftArm: ArmBones | undefined,
    private readonly chest: Object3D,
    private readonly root: Object3D,
    private readonly head?: Object3D,
  ) {}

  /** Grip blend weight 0..1 (tests). */
  get blend(): number {
    return this.weight;
  }

  /**
   * Applies the grip after the clip pose. `mount` is the weapon mount under the right wrist;
   * `aim` raises guns; `attack` 0..1 is the progress of a blow (NaN = none).
   */
  update(
    spec: GripSpec | undefined,
    mount: Object3D | undefined,
    o: {
      aim: boolean;
      attack: number;
      active: boolean;
      dt: number;
      /** Thrust share 0..1 overriding sin(π·attack) (anim v2 melee phases). */
      reach?: number;
    },
  ): void {
    const pose = spec ? (o.aim && spec.aim ? spec.aim : spec.rest) : undefined;
    const swing = spec?.swingByClip === true && !Number.isNaN(o.attack);
    const wantR = pose && o.active && !swing ? 1 : 0;
    const wantL = pose?.left !== undefined && o.active ? 1 : 0;
    // ~0.12 s half-life blends (weapon switch, aim, attack start / end).
    const k = 1 - Math.pow(0.5, o.dt / 0.12);
    this.weight += (wantR - this.weight) * (this.started ? k : 1);
    this.leftWeight += (wantL - this.leftWeight) * (this.started ? k : 1);
    this.started = true;
    if (!pose && this.weight < 1e-3 && this.leftWeight < 1e-3) return;

    // Body frame from the root (facing), independent of what the clip does to the torso:
    // forward = character +Z, up, right = f × u.
    this.root.updateMatrixWorld(true);
    const q = this.root.getWorldQuaternion(new Quaternion());
    const f = new Vector3(0, 0, 1).applyQuaternion(q);
    const u = new Vector3(0, 1, 0).applyQuaternion(q);
    const r = new Vector3().crossVectors(f, u).normalize();
    const body = (b: BodyVec, out: Vector3) =>
      out.set(0, 0, 0).addScaledVector(f, b.f).addScaledVector(u, b.u).addScaledVector(r, b.r);

    if (pose) {
      const snap = this.fresh;
      this.fresh = false;
      const thrust =
        spec?.thrust && !Number.isNaN(o.attack)
          ? (o.reach ?? Math.sin(Math.PI * o.attack)) * spec.thrust
          : 0;
      const hand = body(pose.hand, new Vector3()).addScaledVector(f, thrust);
      const dir = body(pose.dir, new Vector3()).normalize();
      const up = body(pose.up, new Vector3()).normalize();
      // Targets blend in body space (smooth switch between grips / aim and rest).
      const t = snap ? 1 : Math.min(1, k * 1.5);
      this.hand.lerp(hand, t);
      this.dir.lerp(dir, t).normalize();
      this.up.lerp(up, t).normalize();
      this.leftOff.lerp(pose.leftOffset ? body(pose.leftOffset, new Vector3()) : new Vector3(), t);
      this.twist += ((pose.twist ?? 0) - this.twist) * t;
      this.headPitch += ((pose.headPitch ?? 0) - this.headPitch) * t;
      this.headRoll += ((pose.headRoll ?? 0) - this.headRoll) * t;
      this.anchorShoulder += ((pose.anchor === 'shoulderR' ? 1 : 0) - this.anchorShoulder) * t;
      if (pose.left !== undefined) this.left += (pose.left - this.left) * (snap ? 1 : k);
    } else if (this.weight < 0.01) {
      this.fresh = true;
    }

    // Bladed stance: turn the chest so the shoulder line sits `twist` behind square.
    if (this.weight > 1e-3 && this.leftArm && Math.abs(this.twist) > 1e-3) {
      const sd = wpos(this.right.upper, new Vector3()).sub(wpos(this.leftArm.upper, new Vector3()));
      sd.addScaledVector(u, -sd.dot(u)).normalize();
      const want = r.clone().applyAxisAngle(u, -this.twist);
      const delta = Math.atan2(new Vector3().crossVectors(sd, want).dot(u), sd.dot(want));
      const turn = new Quaternion().setFromAxisAngle(u, delta * this.weight);
      rotateWorld(this.chest, turn);
      if (this.head) {
        // Head back to the facing, then down / over onto the stock.
        rotateWorld(this.head, turn.clone().invert());
        rotateWorld(this.head, new Quaternion().setFromAxisAngle(r, -this.headPitch * this.weight));
        rotateWorld(this.head, new Quaternion().setFromAxisAngle(f, this.headRoll * this.weight));
      }
    }
    const chestPos = wpos(this.chest, new Vector3());
    const chest = chestPos.lerp(wpos(this.right.upper, new Vector3()), this.anchorShoulder);
    if (this.weight > 1e-3 && mount) {
      const start = wpos(this.right.wrist, new Vector3());
      const goal = chest.clone().add(this.hand);
      const pole = new Vector3().copy(r).multiplyScalar(0.8).addScaledVector(u, -1);
      // Wrist rotation: mount axes → (x, dir, z = up ⟂ dir).
      const y = this.dir.clone();
      const z = this.up.clone().addScaledVector(y, -this.up.dot(y)).normalize();
      const x = new Vector3().crossVectors(y, z);
      const want = new Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
      const wristWant = want.multiply(mount.quaternion.clone().invert());
      const wristClip = this.right.wrist.getWorldQuaternion(new Quaternion());
      // Two passes: the grip point is offset from the wrist and turns with it.
      for (let pass = 0; pass < 2; pass++) {
        setWorldQuaternion(this.right.wrist, wristClip.clone().slerp(wristWant, this.weight));
        const cur = wpos(this.right.wrist, new Vector3());
        const grip = wpos(mount, new Vector3()).sub(cur);
        const target = goal.clone().sub(grip);
        solveTwoBone(this.right, start.clone().lerp(target, this.weight), pole);
      }
      setWorldQuaternion(this.right.wrist, wristClip.slerp(wristWant, this.weight));
    }
    if (this.leftArm && this.leftWeight > 1e-3 && mount) {
      // Second grip point on the weapon (+Y of the mount).
      mount.updateMatrixWorld(true);
      const target = new Vector3(0, this.left, 0).applyMatrix4(mount.matrixWorld).add(this.leftOff);
      const cur = wpos(this.leftArm.wrist, new Vector3());
      const pole = new Vector3().copy(r).multiplyScalar(-0.8).addScaledVector(u, -1);
      solveTwoBone(this.leftArm, cur.lerp(target, this.leftWeight), pole);
    }
  }
}
