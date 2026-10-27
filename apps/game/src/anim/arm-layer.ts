import type { Quaternion } from 'three';
import { Vector3, type Object3D } from 'three';
import type { Grip } from '../weapons/grip.js';
import type { HeldCategory } from '../weapons/grip-sockets.js';
import type { HeldHands } from '../weapons/held-items.js';
import type { ActionOffsets } from './actions-v2.js';
import { GRIP_SPECS, solveTwoBone, type ArmBones, type GripSpec } from './arm-pose.js';

/**
 * Anim v2 arm layer (anim-spec §3): over the locomotion clip, a hand that holds something
 * swings less (multiplier per category, right / left), guns sit at low ready (pistol 45°,
 * long guns 30° walking / 50° running), a hand bag leans the torso 4° away from it, and the
 * left hand goes onto the shaft of a two-handed non-weapon item (plank) by two-bone IK.
 */

/** Swing multiplier (walk / run) of the right and left arm per held category. */
export const ARM_SWING: Record<HeldCategory | 'empty', { R: number; L: number }> = {
  empty: { R: 1, L: 1 },
  melee1: { R: 0.6, L: 1 },
  knife: { R: 0.6, L: 1 },
  tool: { R: 0.6, L: 1 },
  twoHanded: { R: 0.2, L: 0.2 },
  plank: { R: 0.2, L: 0.2 },
  pistol: { R: 0.3, L: 1 },
  rifle: { R: 0.1, L: 0.1 },
  flashlight: { R: 1, L: 0.25 },
  food: { R: 1, L: 0.7 },
  bag: { R: 0.35, L: 1 },
};

/**
 * Swing multipliers for what is in each hand: a right-hand item damps the right arm by its
 * `R`, a left-hand item the left arm by its `L`; two-handed items both; a flashlight alone in
 * the right hand swings like a left-hand flashlight (0.25).
 */
export function swingOf(h: HeldHands): { R: number; L: number } {
  let R = 1;
  let L = 1;
  if (h.R) {
    const s = ARM_SWING[h.R];
    R = h.R === 'flashlight' ? ARM_SWING.flashlight.L : s.R;
    if (s.L < 1 && h.R !== 'flashlight') L = Math.min(L, s.L);
  }
  if (h.L) L = Math.min(L, ARM_SWING[h.L].L);
  return { R, L };
}

const DEG = Math.PI / 180;

/** Low-ready barrel angle below the horizon (rad): pistol 45°, long guns 30° walk / 50° run. */
export function lowReadyAngle(grip: Grip, run: boolean): number | undefined {
  if (grip === 'pistol') return 45 * DEG;
  if (grip === 'rifle') return (run ? 50 : 30) * DEG;
  return undefined;
}

/** Grip spec with the v2 low ready (rest pose only; aiming unchanged). */
export function gripSpecV2(grip: Grip, run: boolean): GripSpec | undefined {
  const spec = GRIP_SPECS[grip];
  const a = lowReadyAngle(grip, run);
  if (!spec || a === undefined) return spec;
  const side = spec.rest.dir.r;
  return {
    ...spec,
    rest: { ...spec.rest, dir: { f: Math.cos(a), u: -Math.sin(a), r: side } },
  };
}

/** Torso lean away from a hand bag (rad, + = towards the left). */
export const BAG_LEAN = 4 * DEG;
/** Left hand this far up the shaft of a two-handed item (m, anim-spec §4). */
export const SHAFT_LEFT = 0.25;

interface ArmRef {
  bones: ArmBones;
  /** Low-passed clip rotation of the upper / lower arm: the centre of the swing. */
  upper: Quaternion;
  lower: Quaternion;
}

/** Half-life of the swing centre estimate (s): a couple of steps. */
const CENTRE_HALF_LIFE = 0.6;

export class ArmLayer {
  private readonly arms: { R: ArmRef | undefined; L: ArmRef | undefined };
  private swing = { R: 1, L: 1 };

  constructor(
    right: ArmBones | undefined,
    left: ArmBones | undefined,
    private readonly chest: Object3D | undefined,
  ) {
    const ref = (b: ArmBones | undefined): ArmRef | undefined =>
      b && { bones: b, upper: b.upper.quaternion.clone(), lower: b.lower.quaternion.clone() };
    this.arms = { R: ref(right), L: ref(left) };
  }

  /** Current multipliers (tests / debug). */
  get multipliers(): { R: number; L: number } {
    return this.swing;
  }

  /**
   * After the clip: pulls each arm towards its swing centre by (1 − multiplier) and leans the
   * torso away from a bag. `dt` in s.
   */
  apply(h: HeldHands, dt: number): void {
    const want = swingOf(h);
    const k = dt > 0 ? 1 - Math.pow(0.5, dt / 0.15) : 1;
    this.swing = {
      R: this.swing.R + (want.R - this.swing.R) * k,
      L: this.swing.L + (want.L - this.swing.L) * k,
    };
    const c = dt > 0 ? 1 - Math.pow(0.5, dt / CENTRE_HALF_LIFE) : 0;
    for (const side of ['R', 'L'] as const) {
      const a = this.arms[side];
      if (!a) continue;
      a.upper.slerp(a.bones.upper.quaternion, c);
      a.lower.slerp(a.bones.lower.quaternion, c);
      const damp = 1 - this.swing[side];
      if (damp > 1e-3) {
        a.bones.upper.quaternion.slerp(a.upper, damp);
        a.bones.lower.quaternion.slerp(a.lower, damp);
      }
    }
    const bag = h.R === 'bag' ? 1 : h.L === 'bag' ? -1 : 0;
    if (bag && this.chest) this.chest.rotateZ(bag * BAG_LEAN);
  }

  /** Left hand onto `socket` +`SHAFT_LEFT` along its +Y (two-handed pool items). */
  leftOnShaft(socket: Object3D, pole: Vector3): void {
    const a = this.arms.L;
    if (!a) return;
    socket.updateWorldMatrix(true, false);
    const target = new Vector3(0, SHAFT_LEFT, 0).applyMatrix4(socket.matrixWorld);
    a.bones.upper.updateWorldMatrix(true, true);
    solveTwoBone(a.bones, target, pole);
  }

  /**
   * P2 actions (anim/actions-v2.ts) on top of the grip pose: recoil as bone rotations, the
   * reload / use / draw reaches as two-bone IK towards body points. `frame` gives the body axes
   * (+X left, +Y up, +Z forward), `hips` / `head` the anchor points.
   */
  actions(o: ActionOffsets, frame: Object3D, hips: Object3D, head: Object3D | undefined): void {
    const R = this.arms.R?.bones;
    const L = this.arms.L?.bones;
    if (R) {
      if (o.elbowR) R.lower.rotateX(-o.elbowR);
      if (o.wristR) R.wrist.rotateX(-o.wristR);
      if (o.shoulderBackR) R.upper.rotateX(o.shoulderBackR / UPPER_ARM);
    }
    if (o.torso && this.chest) this.chest.rotateX(-o.torso);
    const reach = !!(o.leftToBelt || o.leftToMouth || o.wrap || o.holster);
    if (!reach) return;
    frame.updateWorldMatrix(true, false);
    frame.matrixWorld.extractBasis(_x, _y, _z);
    _x.normalize();
    _y.normalize();
    _z.normalize();
    hips.updateWorldMatrix(true, false);
    hips.getWorldPosition(_hips);
    const at = (base: Vector3, left: number, up: number, fwd: number): Vector3 =>
      _t.copy(base).addScaledVector(_x, left).addScaledVector(_y, up).addScaledVector(_z, fwd);
    const headPos = head
      ? (head.updateWorldMatrix(true, false), head.getWorldPosition(_head))
      : undefined;
    if (L && o.leftToBelt) this.reach(L, at(_hips, 0.17, 0, 0.06), o.leftToBelt);
    if (L && o.leftToMouth && headPos) this.reach(L, at(headPos, 0.02, -0.04, 0.14), o.leftToMouth);
    if (o.wrap) {
      if (L) this.reach(L, at(_hips, 0.02, 0.3, 0.3), o.wrap);
      if (R && L) {
        L.lower.updateWorldMatrix(true, false);
        this.reach(R, L.lower.getWorldPosition(_t2).addScaledVector(_y, 0.05), o.wrap);
      }
    }
    if (R && o.holster) {
      const back = o.holsterAt === 'back';
      const p = back && headPos ? at(headPos, -0.12, -0.08, -0.12) : at(_hips, -0.18, 0, -0.02);
      this.reach(R, p, o.holster);
    }
  }

  /** Wrist from where the clip put it towards `target` by `w` (two-bone IK). */
  private reach(b: ArmBones, target: Vector3, w: number): void {
    b.upper.updateWorldMatrix(true, true);
    b.wrist.getWorldPosition(_w).lerp(target, Math.min(1, w));
    solveTwoBone(b, _w, _pole.copy(_y).negate());
  }
}

/** Upper arm length (m): shoulder-back push (m) -> rotation (rad). */
const UPPER_ARM = 0.28;
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _t = new Vector3();
const _t2 = new Vector3();
const _w = new Vector3();
const _hips = new Vector3();
const _head = new Vector3();
const _pole = new Vector3();
