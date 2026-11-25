import {
  Matrix4,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type Bone,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';

/**
 * The Quaternius character skeleton put into its bind pose (T-pose) so new geometry can be built
 * around it in the space of the model's root object (y up, facing +z) and animated by the
 * existing clips. Each glTF part is quantized with its own bind space, but the bone-to-parent
 * transforms at bind are the same in all of them: local = inverse(parent bind) · bind.
 */
export interface BindPose {
  readonly root: Object3D;
  readonly bones: readonly Bone[];
  /** Bind position of a bone (root space). */
  at(name: string): Vector3;
  index(name: string): number;
}

const tmp = new Matrix4();

export function poseToBind(root: Object3D): BindPose {
  let part: SkinnedMesh | undefined;
  root.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!part && m.isSkinnedMesh) part = m;
  });
  if (!part) throw new Error('character without skinned meshes');
  const bones = part.skeleton.bones;
  const bind = part.skeleton.boneInverses.map((inv) => new Matrix4().copy(inv).invert());
  const idx = new Map<string, number>();
  bones.forEach((b, i) => idx.set(b.name, i));
  bones.forEach((b, i) => {
    const p = bones.indexOf(b.parent as Bone);
    if (p < 0) return; // top bone: keeps its own transform
    tmp.copy(bind[p]!).invert().multiply(bind[i]!);
    tmp.decompose(b.position, b.quaternion, b.scale);
  });
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const index = (name: string) => {
    const i = idx.get(name);
    if (i === undefined) throw new Error(`no bone ${name}`);
    return i;
  };
  return {
    root,
    bones,
    at: (name) =>
      new Vector3().setFromMatrixPosition(bones[index(name)]!.matrixWorld).applyMatrix4(toRoot),
    index,
  };
}

/**
 * Adds `geometry` (root space, `skinIndex` into `bp.bones`) as a skinned mesh of `root`, bound in
 * the current (bind) pose. Call while the skeleton is still in the bind pose.
 */
export function attachSkinned(
  bp: BindPose,
  geometry: BufferGeometry,
  material: Material,
  name: string,
): SkinnedMesh {
  const mesh = new SkinnedMesh(geometry, material);
  mesh.name = name;
  bp.root.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new Skeleton([...bp.bones]), mesh.matrixWorld);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
