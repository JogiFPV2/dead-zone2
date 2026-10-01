import type { Mesh } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** `deadzone-town/town.json` (written by `assets town`). */
export interface TownKitIndex {
  version: 1;
  glb: string;
  palette: string;
  emissive: string;
  detail: string;
  cells: Record<string, { uv: [number, number]; hex: string }>;
  modules: Record<string, number>;
}

/** Atlas cells: name -> uv (cell centre) and colour. */
export interface TownCells {
  uv(name: string): [number, number];
  color(name: string): Color;
}

export function townCells(index: Pick<TownKitIndex, 'cells'>): TownCells {
  const colors = new Map<string, Color>();
  return {
    uv: (n) => index.cells[n]?.uv ?? [0, 0],
    color: (n) => {
      let c = colors.get(n);
      if (!c) colors.set(n, (c = new Color(index.cells[n]?.hex ?? '#ff00ff')));
      return c;
    },
  };
}

/**
 * Town module kit: one geometry per module (walls, windows, doorways, door leaves, roof pieces,
 * props), all sampling one flat-colour atlas through ONE shared material (BatchedMesh friendly).
 * Derived variants: `window-*-broken` (glass triangles removed).
 */
export interface TownKit {
  readonly geometries: ReadonlyMap<string, BufferGeometry>;
  readonly material: MeshStandardMaterial;
  readonly cells: TownCells;
  readonly detail: Texture;
}

/** Night emission of lit windows (spec: day 0, night 1.6). */
export const WINDOW_EMISSIVE_NIGHT = 1.6;

/** Float, non-indexed-then-welded copy of position + uv in model space (quantization baked). */
export function bakeGeometry(src: BufferGeometry, matrix: Mesh['matrixWorld']): BufferGeometry {
  const s = src.index ? src.toNonIndexed() : src;
  const pos = s.getAttribute('position');
  const uv = s.getAttribute('uv');
  const p = new Float32Array(pos.count * 3);
  const t = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    p[i * 3] = pos.getX(i);
    p[i * 3 + 1] = pos.getY(i);
    p[i * 3 + 2] = pos.getZ(i);
    if (uv) {
      t[i * 2] = uv.getX(i);
      t[i * 2 + 1] = uv.getY(i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('uv', new BufferAttribute(t, 2));
  g.applyMatrix4(matrix);
  const w = mergeVertices(g);
  w.computeVertexNormals();
  w.computeBoundingBox();
  w.computeBoundingSphere();
  return w;
}

/** Copy of `g` without the triangles whose uv falls in atlas cell `uv` (e.g. the glass). */
export function withoutCell(
  g: BufferGeometry,
  uv: [number, number],
  cellSize = 1 / 16,
): BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const pos = src.getAttribute('position');
  const tex = src.getAttribute('uv');
  const keep: number[] = [];
  const inCell = (i: number) =>
    Math.abs(tex.getX(i) - uv[0]) < cellSize / 2 && Math.abs(tex.getY(i) - uv[1]) < cellSize / 2;
  for (let t = 0; t < pos.count; t += 3) {
    if (!(inCell(t) && inCell(t + 1) && inCell(t + 2))) keep.push(t, t + 1, t + 2);
  }
  const p = new Float32Array(keep.length * 3);
  const q = new Float32Array(keep.length * 2);
  keep.forEach((v, i) => {
    p.set([pos.getX(v), pos.getY(v), pos.getZ(v)], i * 3);
    q.set([tex.getX(v), tex.getY(v)], i * 2);
  });
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(p, 3));
  out.setAttribute('uv', new BufferAttribute(q, 2));
  const w = mergeVertices(out);
  w.computeVertexNormals();
  w.computeBoundingBox();
  w.computeBoundingSphere();
  return w;
}

/** Loads `models/deadzone-town/` (one GLB, palette + emissive mask, terrain detail). */
export async function loadTownKit(
  baseUrl = `${import.meta.env.BASE_URL}models/`,
): Promise<TownKit> {
  const res = await fetch(`${baseUrl}deadzone-town/town.json`);
  if (!res.ok) throw new Error(`town kit: HTTP ${res.status}`);
  const index = (await res.json()) as TownKitIndex;
  const tl = new TextureLoader();
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [glb, palette, emissive, detail] = await Promise.all([
    gltf.loadAsync(baseUrl + index.glb),
    tl.loadAsync(baseUrl + index.palette),
    tl.loadAsync(baseUrl + index.emissive),
    tl.loadAsync(baseUrl + index.detail),
  ]);
  for (const t of [palette, emissive]) {
    t.colorSpace = SRGBColorSpace;
    t.magFilter = t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.flipY = false;
  }
  detail.wrapS = detail.wrapT = RepeatWrapping;
  detail.colorSpace = NoColorSpace;
  detail.anisotropy = 4;
  const geometries = new Map<string, BufferGeometry>();
  glb.scene.updateMatrixWorld(true);
  glb.scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const name = m.parent && m.parent !== glb.scene && !m.name ? m.parent.name : m.name;
    geometries.set(name.replace(/_\d+$/, ''), bakeGeometry(m.geometry, m.matrixWorld));
  });
  const cells = townCells(index);
  const glass = cells.uv('glass');
  for (const [name, g] of [...geometries]) {
    if (name.startsWith('window-') && !name.endsWith('-lit')) {
      geometries.set(`${name}-broken`, withoutCell(g, glass));
    }
  }
  const material = new MeshStandardMaterial({
    map: palette,
    emissiveMap: emissive,
    emissive: '#ffffff',
    emissiveIntensity: 0,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
    side: DoubleSide,
  });
  material.name = 'deadzone-town/palette';
  return { geometries, material, cells, detail };
}
