import {
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Group,
  type Material,
  type Object3D,
} from 'three';

/** One mesh of a furniture model: shared geometry / material and its transform in the model. */
export interface ModelPart {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** Part matrix relative to the model root (base at y = 0, centred on x/z). */
  local: Matrix4;
  castShadow: boolean;
  receiveShadow: boolean;
}

/** Visible meshes of a (fitted) model with their transforms relative to its root. */
export function modelParts(model: Object3D): ModelPart[] {
  model.updateMatrixWorld(true);
  const inv = new Matrix4().copy(model.matrixWorld).invert();
  const parts: ModelPart[] = [];
  const walk = (o: Object3D): void => {
    if (!o.visible) return;
    if (o instanceof Mesh) {
      const m = o as Mesh;
      parts.push({
        geometry: m.geometry,
        material: m.material,
        local: new Matrix4().multiplyMatrices(inv, m.matrixWorld),
        castShadow: m.castShadow,
        receiveShadow: m.receiveShadow,
      });
    }
    for (const c of o.children) walk(c);
  };
  walk(model);
  return parts;
}

/** A placed furniture object: model id, base position (world) and yaw. */
export interface Placement {
  model: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** Where a placement's parts ended up (for hiding it, e.g. x-ray swaps in a clone). */
export type InstanceSlots = { mesh: InstancedMesh; index: number; matrix: Matrix4 }[];

const partKey = (p: ModelPart): string =>
  `${p.geometry.uuid}|${(Array.isArray(p.material) ? p.material : [p.material]).map((m) => m.uuid).join(',')}`;

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const q = new Quaternion();
const up = new Vector3(0, 1, 0);
const pos = new Vector3();
const one = new Vector3(1, 1, 1);

/**
 * Furniture (all loaded chunks) as ONE `InstancedMesh` per model part (geometry + material), instead
 * of a cloned model per object: same meshes, same transforms, far fewer draw calls. Geometry and
 * materials stay owned by the model kit; `dispose` frees only the instance buffers.
 * Instance matrices are relative to `origin` (world X / Z; the meshes sit there), so float32
 * instance buffers stay small far from (0, 0) — the render origin of the floating origin.
 */
export function buildInstances(
  placements: readonly Placement[],
  partsOf: (model: string) => readonly ModelPart[] | undefined,
  root: Group,
  origin: { x: number; z: number } = { x: 0, z: 0 },
): { meshes: InstancedMesh[]; slots: (InstanceSlots | undefined)[] } {
  const groups = new Map<string, { part: ModelPart; at: { i: number; m: Matrix4 }[] }>();
  const slots: (InstanceSlots | undefined)[] = [];
  const base = new Matrix4();
  placements.forEach((pl, i) => {
    const parts = partsOf(pl.model);
    if (!parts?.length) {
      slots.push(undefined);
      return;
    }
    base.compose(
      pos.set(pl.x - origin.x, pl.y, pl.z - origin.z),
      q.setFromAxisAngle(up, pl.rotY),
      one,
    );
    for (const part of parts) {
      const k = partKey(part);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = { part, at: [] }));
      g.at.push({ i, m: new Matrix4().multiplyMatrices(base, part.local) });
    }
    slots.push([]);
  });
  const meshes: InstancedMesh[] = [];
  for (const { part, at } of groups.values()) {
    const mesh = new InstancedMesh(part.geometry, part.material, at.length);
    mesh.name = 'furniture-instances';
    mesh.position.set(origin.x, 0, origin.z);
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = part.receiveShadow;
    at.forEach(({ i, m }, index) => {
      mesh.setMatrixAt(index, m);
      slots[i]!.push({ mesh, index, matrix: m });
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    root.add(mesh);
  }
  return { meshes, slots };
}

/** Hides (or shows again) one placement's instances. */
export function setSlotsVisible(slots: InstanceSlots, visible: boolean): void {
  for (const s of slots) {
    s.mesh.setMatrixAt(s.index, visible ? s.matrix : HIDDEN);
    s.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Removes instanced meshes; shared geometry / materials stay. */
export function disposeInstances(meshes: readonly InstancedMesh[], root: Group): void {
  for (const m of meshes) {
    root.remove(m);
    m.dispose();
  }
}
