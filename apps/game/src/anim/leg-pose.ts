import { Quaternion, Vector3, type Object3D } from 'three';

/**
 * Procedural layer over the walk / run clips (after the mixer, before the grip pose). The
 * Quaternius rig has IK-style feet: `Foot.L/R` hang off `Root` (the clips place them), while the
 * leg chain `UpperLeg → LowerLeg` hangs off `Body`. So:
 * - stride gain: the foot offset from its rest spot along the walking direction is scaled
 *   (shorter steps when slow, longer when sprinting; `locomotion-blend.ts` sets the cadence to
 *   match, so the planted foot does not slide),
 * - crouch (sneak): `Body` (pelvis with torso and legs) lowered, the feet stay where the clip
 *   put them, the spine bends forward and the head back up,
 * - then a two-bone IK puts each ankle back on its foot, the knee bending forward.
 */
export interface LegPoseInput {
  gain: number;
  crouch: number;
  /** Body right axis in world space (unit). */
  right: Vector3;
}

/** Pelvis drop at full crouch, as a share of the leg length (hip → ankle). */
const CROUCH_DROP = 0.22;
/** Spine bend forward / head back up at full crouch (rad). */
const CROUCH_SPINE = 0.35;
const CROUCH_HEAD = 0.25;

interface Leg {
  upper: Object3D;
  lower: Object3D;
  foot: Object3D;
  /** Rest position of the foot in its parent. */
  restFoot: Vector3;
  /** Knee and ankle points in the upper / lower bone's local frame (bind pose). */
  kneeLocal: Vector3;
  ankleLocal: Vector3;
  thigh: number;
  shin: number;
}

const bone = (root: Object3D, name: string): Object3D | undefined =>
  root.getObjectByName(name) ?? root.getObjectByName(name.replace('.', '')) ?? undefined;

const _q = new Quaternion();
const _p = new Quaternion();
const _d = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _h = new Vector3();
const _k = new Vector3();
const _t = new Vector3();
const _f = new Vector3();
const _w = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Applies the world rotation `q` to `o` (keeps its parent and position). */
function rotateWorldQ(o: Object3D, q: Quaternion): void {
  if (!o.parent) return;
  o.parent.getWorldQuaternion(_p);
  // local' = parent⁻¹ · R · parent · local
  _d.copy(_p).invert().multiply(q).multiply(_p);
  o.quaternion.premultiply(_d);
  o.updateMatrixWorld(true);
}

function rotateWorld(o: Object3D, axis: Vector3, angle: number): void {
  if (angle !== 0) rotateWorldQ(o, _q.setFromAxisAngle(axis, angle));
}

/** Turns `o` about its origin so the world point `from` moves onto the direction of `to`. */
function aim(o: Object3D, from: Vector3, to: Vector3): void {
  const origin = o.getWorldPosition(_w);
  _a.subVectors(from, origin).normalize();
  _b.subVectors(to, origin).normalize();
  if (_a.lengthSq() < 0.5 || _b.lengthSq() < 0.5) return;
  rotateWorldQ(o, _q.setFromUnitVectors(_a, _b));
}

export class LegPose {
  private readonly legs: Leg[] = [];
  private readonly body: Object3D | undefined;
  private readonly spine: Object3D | undefined;
  private readonly head: Object3D | undefined;
  /** `Body` position before / after the last crouch drop (undo it when no clip track resets it). */
  private bodyBase: Vector3 | undefined;
  private bodySet: Vector3 | undefined;
  /** Same for the spine / head bend (bones without a track in some clips, e.g. `Abdomen`). */
  private readonly bends: { bone: Object3D; base: Quaternion; set: Quaternion }[] = [];

  /** `root` in its rest (bind) pose with world matrices current. */
  constructor(root: Object3D) {
    root.updateMatrixWorld(true);
    for (const s of ['L', 'R']) {
      const upper = bone(root, `UpperLeg.${s}`);
      const lower = bone(root, `LowerLeg.${s}`);
      const foot = bone(root, `Foot.${s}`);
      if (!upper || !lower || !foot) continue;
      const hip = upper.getWorldPosition(new Vector3());
      const knee = lower.getWorldPosition(new Vector3());
      const ankle = foot.getWorldPosition(new Vector3());
      this.legs.push({
        upper,
        lower,
        foot,
        restFoot: foot.position.clone(),
        kneeLocal: upper.worldToLocal(knee.clone()),
        ankleLocal: lower.worldToLocal(ankle.clone()),
        thigh: hip.distanceTo(knee),
        shin: knee.distanceTo(ankle),
      });
    }
    this.body = bone(root, 'Body') ?? bone(root, 'Hips');
    this.spine = bone(root, 'Abdomen');
    this.head = bone(root, 'Head');
  }

  get ok(): boolean {
    return this.legs.length === 2 && this.body !== undefined;
  }

  /** Call after the mixer update with world matrices current. */
  apply(i: LegPoseInput): void {
    if (!this.ok) return;
    const body = this.body!;
    if (this.bodySet && this.bodyBase && body.position.equals(this.bodySet)) {
      body.position.copy(this.bodyBase);
      body.updateMatrixWorld(true);
    }
    this.bodySet = undefined;
    for (const b of this.bends)
      if (b.bone.quaternion.equals(b.set)) {
        b.bone.quaternion.copy(b.base);
        b.bone.updateMatrixWorld(true);
      }
    this.bends.length = 0;
    const gain = Math.abs(i.gain - 1) > 1e-3 ? i.gain : 1;
    const c = Math.max(0, Math.min(1, i.crouch));
    if (gain === 1 && c < 1e-3) return;
    if (gain !== 1) {
      // Walking direction = up × right, in each foot parent's frame.
      _f.crossVectors(UP, i.right).normalize();
      for (const l of this.legs) {
        const parent = l.foot.parent;
        if (!parent) continue;
        parent.getWorldQuaternion(_p);
        _t.copy(_f).applyQuaternion(_p.invert());
        _a.subVectors(l.foot.position, l.restFoot);
        l.foot.position.addScaledVector(_t, (gain - 1) * _a.dot(_t));
        l.foot.updateMatrixWorld(true);
      }
    }
    if (c >= 1e-3 && body.parent) {
      const drop = CROUCH_DROP * (this.legs[0]!.thigh + this.legs[0]!.shin) * c;
      this.bodyBase = body.position.clone();
      body.getWorldPosition(_w);
      _w.y -= drop;
      body.parent.worldToLocal(_w);
      body.position.copy(_w);
      body.updateMatrixWorld(true);
      this.bodySet = body.position.clone();
    }
    for (const l of this.legs) this.reach(l, i.right);
    if (c >= 1e-3) {
      this.bend(this.spine, i.right, -CROUCH_SPINE * c);
      this.bend(this.head, i.right, CROUCH_HEAD * c);
    }
  }

  private bend(o: Object3D | undefined, axis: Vector3, angle: number): void {
    if (!o) return;
    const base = o.quaternion.clone();
    rotateWorld(o, axis, angle);
    this.bends.push({ bone: o, base, set: o.quaternion.clone() });
  }

  /** Two-bone IK: ankle onto the foot, knee in the plane of hip, foot and the forward bend. */
  private reach(l: Leg, right: Vector3): void {
    const hip = l.upper.getWorldPosition(_h);
    const target = l.foot.getWorldPosition(_t);
    const toT = _a.subVectors(target, hip);
    const dist = Math.min(
      Math.max(toT.length(), Math.abs(l.thigh - l.shin) + 1e-4),
      l.thigh + l.shin - 1e-4,
    );
    toT.normalize();
    // Knee bends forward: perpendicular to hip→foot inside the leg plane (normal = right).
    const bend = _b.crossVectors(right, toT).normalize();
    const along = (l.thigh * l.thigh - l.shin * l.shin + dist * dist) / (2 * dist);
    const up = Math.sqrt(Math.max(0, l.thigh * l.thigh - along * along));
    const knee = _k.copy(hip).addScaledVector(toT, along).addScaledVector(bend, up);
    const kneeNow = l.upper.localToWorld(_w.copy(l.kneeLocal));
    aim(l.upper, kneeNow.clone(), knee.clone());
    const ankleNow = l.lower.localToWorld(_w.copy(l.ankleLocal));
    aim(l.lower, ankleNow.clone(), l.foot.getWorldPosition(new Vector3()));
  }
}
