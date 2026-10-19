import { attachFileSchema, type AttachPoint } from '@deadzone/content/wires';
import type { BufferGeometry } from 'three';
import { Float32BufferAttribute, MeshStandardMaterial, type Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Infrastructure models (Designer's `assets-src/infra`, flat vertex colours, one material). */
export const INFRA_MODELS = [
  'hv110-os24',
  'hv110-dt',
  'hv220',
  'hv400-portal',
  'lv-zerdz',
  'lv-zerdz-latarnia',
  'lv-zerdz-narozny',
  'tor-kafel-1m',
  'tor-rozjazd-1-9',
  'tor-koziol-oporowy',
  'przejazd-kat-a',
  'przejazd-rogatka-ramie',
  'catenary-mast-a',
  'catenary-mast-b',
] as const;
/** Models with wire attach points (`<id>.attach.json`). */
export const ATTACH_MODELS = [
  'hv110-os24',
  'hv110-dt',
  'hv220',
  'hv400-portal',
  'lv-zerdz',
  'lv-zerdz-latarnia',
  'lv-zerdz-narozny',
  'catenary-mast-a',
  'catenary-mast-b',
] as const;
/** Mirrored copy of a model (left-hand switch): `<id>-L`. */
export const MIRROR_SUFFIX = '-L';

export interface InfraKit {
  readonly geometries: ReadonlyMap<string, BufferGeometry>;
  readonly attach: ReadonlyMap<string, readonly AttachPoint[]>;
  readonly material: MeshStandardMaterial;
}

/** Geometry mirrored in x with the winding flipped (still front-facing). Pure (tests). */
export function mirrorX(g: BufferGeometry): BufferGeometry {
  const m = g.clone();
  const pos = m.getAttribute('position');
  const nor = m.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, -pos.getX(i));
    if (nor) nor.setX(i, -nor.getX(i));
  }
  const idx = m.getIndex();
  if (idx) {
    for (let i = 0; i + 2 < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  }
  m.computeBoundingSphere();
  return m;
}

/** Loads the infrastructure models and their attach points (validated by the wire schema). */
export async function loadInfraKit(baseUrl = import.meta.env.BASE_URL): Promise<InfraKit> {
  const dir = `${baseUrl}models/infra/`;
  const loader = new GLTFLoader();
  const geometries = new Map<string, BufferGeometry>();
  const attach = new Map<string, readonly AttachPoint[]>();
  await Promise.all([
    ...INFRA_MODELS.map(async (id) => {
      const gltf = await loader.loadAsync(`${dir}${id}.glb`);
      gltf.scene.updateMatrixWorld(true);
      const parts: BufferGeometry[] = [];
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const name of Object.keys(g.attributes))
          if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
        if (!g.getAttribute('color')) {
          const n = g.getAttribute('position').count;
          g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(0.5), 3));
        }
        parts.push(g.index ? g : g);
      });
      const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
      if (!merged) return;
      merged.computeBoundingSphere();
      geometries.set(id, merged);
      if (id === 'tor-rozjazd-1-9') geometries.set(id + MIRROR_SUFFIX, mirrorX(merged));
    }),
    ...ATTACH_MODELS.map(async (id) => {
      const res = await fetch(`${dir}${id}.attach.json`);
      if (!res.ok) throw new Error(`infra: ${id}.attach.json HTTP ${res.status}`);
      attach.set(id, attachFileSchema.parse(await res.json()).attach);
    }),
  ]);
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  material.name = 'infra';
  return { geometries, attach, material };
}
