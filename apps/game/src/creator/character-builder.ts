import {
  Color,
  Skeleton,
  SkinnedMesh,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import {
  MESH_PARTS,
  MESH_PREFIX,
  skinMul,
  type MeshRef,
  type ModelId,
  type PartColors,
  type RenderLook,
} from './appearance-map.js';

/** Loaded Quaternius models (any clone; only geometry, materials and bind data are read). */
export type CharacterTemplates = Readonly<Record<ModelId, Object3D>>;

const tmp = new Color();

/** Skinned meshes of one body part (`Casual2_Head` or its `Casual2_Head_1…` primitives). */
export function partMeshes(model: Object3D, id: ModelId, part: string): SkinnedMesh[] {
  const re = new RegExp(`^${MESH_PREFIX[id]}${part}(_\\d+)?$`);
  const out: SkinnedMesh[] = [];
  model.traverse((o) => {
    if (o instanceof SkinnedMesh && (re.test(o.name) || re.test(o.parent?.name ?? '')))
      out.push(o as SkinnedMesh);
  });
  return out;
}

/** Color for a material of `ref` (tint channel, skin), or undefined to keep the model's color. */
export function materialColor(
  ref: MeshRef,
  material: string,
  skin: string,
  colors: PartColors,
): { hex: string; mul: number } | undefined {
  const s = skinMul(material);
  if (s !== undefined) return { hex: skin, mul: s };
  const t = ref.tints.find((x) => x.material === material);
  const hex = t ? colors[t.channel] : undefined;
  return hex ? { hex, mul: t?.mul ?? 1 } : undefined;
}

function paint(m: MeshStandardMaterial, ref: MeshRef, skin: string, colors: PartColors): void {
  if (ref.hide?.includes(m.name)) m.visible = false;
  const c = materialColor(ref, m.name, skin, colors);
  if (!c) return;
  m.color.set(tmp.set(c.hex).multiplyScalar(c.mul));
  if (m.emissiveIntensity > 0) m.emissive.copy(m.color);
}

/**
 * Character assembled from Quaternius parts on one skeleton. `root` is a model clone (e.g. from
 * `ModelKit.character`); its own part meshes are replaced by the look's meshes, which share the
 * template geometry and get their own materials. The mixer of `root` keeps animating the bones.
 */
export class CharacterAssembly {
  private parts: SkinnedMesh[] = [];
  private readonly skeleton: Skeleton;
  private readonly parent: Object3D;

  constructor(
    readonly root: Object3D,
    private readonly templates: CharacterTemplates,
    /** Self-lit share (in-game readability, see zombie-views `brighten`); 0 in the creator. */
    private readonly emissive = 0,
  ) {
    const own: SkinnedMesh[] = [];
    root.traverse((o) => {
      if (o instanceof SkinnedMesh) own.push(o as SkinnedMesh);
    });
    const first = own[0];
    if (!first?.parent) throw new Error('character without skinned meshes');
    this.skeleton = first.skeleton;
    this.parent = first.parent;
    for (const m of own) m.removeFromParent();
  }

  setLook(look: RenderLook): void {
    for (const m of this.parts) {
      m.removeFromParent();
      for (const mat of materials(m)) mat.dispose();
    }
    this.parts = [];
    for (const { ref, colors } of look.parts) {
      for (const src of partMeshes(this.templates[ref.model], ref.model, ref.mesh)) {
        const mats = materials(src).map((x) => {
          const c = x.clone() as MeshStandardMaterial;
          c.emissive.copy(c.color);
          c.emissiveIntensity = this.emissive;
          paint(c, ref, look.skin, colors);
          return c;
        });
        const bones = src.skeleton.bones.map(
          (b) => this.skeleton.bones.find((x) => x.name === b.name) ?? b,
        );
        const m = new SkinnedMesh(src.geometry, mats.length === 1 ? mats[0]! : mats);
        m.name = src.name;
        m.castShadow = true;
        m.frustumCulled = false;
        this.parent.add(m);
        m.bind(new Skeleton(bones, src.skeleton.boneInverses), src.bindMatrix);
        this.parts.push(m);
      }
    }
  }

  dispose(): void {
    for (const m of this.parts) for (const mat of materials(m)) mat.dispose();
    this.parts = [];
  }
}

function materials(m: SkinnedMesh): Material[] {
  return Array.isArray(m.material) ? m.material : [m.material];
}

/** Every body part present in all three templates (sanity check for the asset pipeline). */
export function missingParts(t: CharacterTemplates): string[] {
  const out: string[] = [];
  for (const id of Object.keys(t) as ModelId[])
    for (const p of MESH_PARTS) if (partMeshes(t[id], id, p).length === 0) out.push(`${id}/${p}`);
  return out;
}
