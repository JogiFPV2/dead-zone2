import type { Matrix4 } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import type { ManifestAsset } from '../../assets/manifest.js';
import { preparePbrGeometry } from './pbr-material.js';

export { pbrVariantFile } from '../../assets/manifest.js';

/** Manifest lod files are relative to `models/` (the AssetLoader base); `pbr` maps to `public/`. */
export const MODELS_DIR = 'models/';

/** One PBR model from the manifest: url (relative to `public/`) and uniform scale. */
export interface PbrModelSource {
  /** File stem, e.g. `sedan` for `deadzone-pbr/sedan.glb`. */
  readonly id: string;
  readonly url: string;
  readonly scale: number;
}

/** Used only while an asset has no `scale` (manifest omits it when 1): Kenney sedan → 4.3 m. */
export const PBR_SCALE_FALLBACK: Readonly<Record<string, number>> = { sedan: 1.69 };

const modelId = (file: string): string =>
  (file.split('/').pop() ?? file).replace(/(\.pbr)?\.glb$/i, '');

/**
 * The PBR models of the built manifest (`material: 'pbr'`, meshopt GLBs from `assets build`).
 * GLBs are not pre-scaled: the asset `scale` is applied on top of the node transform.
 */
export function pbrModelSources(
  assets: readonly Pick<ManifestAsset, 'material' | 'lods' | 'scale'>[],
): PbrModelSource[] {
  const out: PbrModelSource[] = [];
  for (const a of assets) {
    const file = a.lods[0]?.file;
    if (a.material !== 'pbr' || !file) continue;
    const id = modelId(file);
    out.push({ id, url: `${MODELS_DIR}${file}`, scale: a.scale ?? PBR_SCALE_FALLBACK[id] ?? 1 });
  }
  return out;
}

/**
 * Float copy of a geometry: meshopt builds quantize position/normal (normalized int16/int8,
 * maybe interleaved); baking a node matrix into those would clamp to [-1, 1].
 */
export function toFloatGeometry(src: BufferGeometry): BufferGeometry {
  const g = src.clone();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.array instanceof Float32Array && !a.normalized && a instanceof BufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    }
    g.setAttribute(name, new BufferAttribute(out, a.itemSize));
  }
  return g;
}

export function bakePbrScene(scene: Object3D, scale: number): BufferGeometry {
  scene.updateMatrixWorld(true);
  let out: BufferGeometry | undefined;
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || out) return;
    out = preparePbrGeometry(toFloatGeometry(m.geometry).applyMatrix4(m.matrixWorld));
  });
  if (!out) throw new Error(`deadzone-pbr: brak siatki w ${scene.name}`);
  if (scale !== 1) out.scale(scale, scale, scale);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** One InstancedMesh (one draw call + one per shadow pass) for all copies of a model. */
export function instancedModel(
  geometry: BufferGeometry,
  material: Material,
  matrices: readonly Matrix4[],
  name: string,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, matrices.length));
  mesh.name = `pbr:${name}`;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * A `*.pbr.glb` geometry in town kit form (position, normal, palette uv; same attribute set as
 * the kit modules, so it can join their BatchedMesh): each vertex gets the palette cell of its
 * layer (`cellUvOfLayer`), fitted to `height` metres with its base at y = 0.
 */
export function toKitGeometry(
  src: BufferGeometry,
  cellUvOfLayer: (layer: number) => readonly [number, number],
  height?: number,
): BufferGeometry {
  const g = src.index ? src : src.clone();
  const pos = g.getAttribute('position');
  const layer = g.getAttribute('pbrL');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const [u, v] = cellUvOfLayer(layer ? Math.round(layer.getX(i)) : 12);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', (pos as BufferAttribute).clone());
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  const n = g.getAttribute('normal');
  if (n) out.setAttribute('normal', (n as BufferAttribute).clone());
  else out.computeVertexNormals();
  if (g.index) out.setIndex(g.index.clone());
  else out.setIndex([...Array(pos.count).keys()]);
  out.computeBoundingBox();
  const bb = out.boundingBox!;
  const s = height && bb.max.y > bb.min.y ? height / (bb.max.y - bb.min.y) : 1;
  out.translate(0, -bb.min.y, 0);
  if (s !== 1) out.scale(s, s, s);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
