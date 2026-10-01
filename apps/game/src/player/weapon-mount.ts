import { Group, Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/**
 * Attachment points for weapons on an animated character: a group under the right wrist bone
 * (held weapon) and one under the chest bone (slung on the back, PZ style). Both are in weapon
 * space (+Y = handle -> head, origin = grip), placed once from the bind pose; the bones carry
 * them through every clip.
 */
export interface WeaponMounts {
  /** Melee grip: +Y along the knuckle line (out of the thumb side of the fist). */
  hand: Group;
  /** Firearm / stab grip: +Y along the fingers (barrel / blade forward). */
  handGun: Group;
  back: Group;
}

/** glTF node names lose their dots in three.js (`Wrist.R` -> `WristR`). */
function bone(root: Object3D, name: string): Object3D | undefined {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, ''));
}

const pos = (o: Object3D): Vector3 => new Vector3().setFromMatrixPosition(o.matrixWorld);

/** Group under `parent` whose world transform is the basis (x, y, z) at `at`. */
function mountAt(parent: Object3D, at: Vector3, x: Vector3, y: Vector3, z: Vector3): Group {
  const world = new Matrix4().makeBasis(x, y, z).setPosition(at);
  const local = new Matrix4().copy(parent.matrixWorld).invert().multiply(world);
  const g = new Group();
  local.decompose(g.position, g.quaternion, g.scale);
  parent.add(g);
  return g;
}

/** Back sling tilt from vertical (rad). */
const SLING_TILT = 0.55;
/** Back mount distance behind the chest bone (world units). */
const SLING_OUT = 0.16;

export function createWeaponMounts(object: Object3D): WeaponMounts | undefined {
  object.updateMatrixWorld(true);
  const wrist = bone(object, 'Wrist.R');
  // Second finger joints: the first ones all sit at the same point of the palm.
  const middle = bone(object, 'Middle2.R');
  const index = bone(object, 'Index2.R');
  const pinky = bone(object, 'Pinky2.R');
  const chest = bone(object, 'Chest') ?? bone(object, 'Torso');
  if (!wrist || !middle || !index || !pinky || !chest) return undefined;
  const w = pos(wrist);
  const m = pos(middle);
  const finger = m.clone().sub(w).normalize();
  const knuckle = pos(index).sub(pos(pinky)).normalize();
  const up = knuckle.sub(finger.clone().multiplyScalar(knuckle.dot(finger))).normalize();
  const grip = w.clone().lerp(m, 0.8);
  const hand = mountAt(wrist, grip, new Vector3().crossVectors(up, finger), up, finger);
  const handGun = mountAt(
    wrist,
    grip,
    new Vector3().crossVectors(finger, up),
    finger.clone(),
    up.clone(),
  );
  // Back: model forward is +Z of the character object.
  const q = object.getWorldQuaternion(new Quaternion());
  const fwd = new Vector3(0, 0, 1).applyQuaternion(q).normalize();
  const vert = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(fwd, vert).normalize();
  const sy = vert
    .multiplyScalar(Math.cos(SLING_TILT))
    .add(right.multiplyScalar(Math.sin(SLING_TILT)));
  const sz = fwd.clone().negate();
  const sx = new Vector3().crossVectors(sy, sz);
  const back = mountAt(chest, pos(chest).add(fwd.multiplyScalar(-SLING_OUT)), sx, sy, sz);
  return { hand, handGun, back };
}
