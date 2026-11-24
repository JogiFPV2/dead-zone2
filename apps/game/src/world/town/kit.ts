import { withFade } from '../wall-fade.js';
import type { Mesh } from 'three';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  MeshStandardMaterial,
  LinearMipmapLinearFilter,
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
import { CanvasTexture } from 'three';
import { deriveSkins, paintExtCells, withExtCells } from './skins.js';
import { PALETTE_SCALE, bldV2, paintV2Cells } from './bld-v2.js';
import { V2_DETAIL, paintDetailIndex, withFacadeDetail } from './bld-detail.js';
import { setPaintedBuildingCells, withPaintedBuildings } from '../../render/painted-buildings.js';
import { shopWindowGeometry } from './levels.js';
import { ALL_SKINS, WALL_CELL } from './modules.js';

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
  /** Palette cells by name (uv centre, colour); the realistic style maps them to PBR layers. */
  readonly cellIndex?: Readonly<Record<string, { uv: [number, number]; hex: string }>>;
  /** Terrain material override (realistic style); absent = `terrainMaterial(detail)`. */
  readonly terrainMaterial?: MeshStandardMaterial;
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
  const index = withExtCells((await res.json()) as TownKitIndex);
  const tl = new TextureLoader();
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [glb, paletteSrc, emissive, detail] = await Promise.all([
    gltf.loadAsync(baseUrl + index.glb),
    tl.loadAsync(baseUrl + index.palette),
    tl.loadAsync(baseUrl + index.emissive),
    tl.loadAsync(baseUrl + index.detail),
  ]);
  // Catalogue cells (atlas 192+) painted into a copy of the palette.
  const img = paletteSrc.image;
  const canvas = document.createElement('canvas');
  // Painted at PALETTE_SCALE× (same 16 × 16 grid, nearest): bld v2 colours use quarter cells.
  canvas.width = img.width * PALETTE_SCALE;
  canvas.height = img.height * PALETTE_SCALE;
  const ctx = canvas.getContext('2d');
  let palette: Texture = paletteSrc;
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    paintExtCells(ctx, canvas.width);
    paintV2Cells(ctx, canvas.width);
    palette = new CanvasTexture(canvas);
  }
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
  deriveSkins(geometries, (c) => cells.uv(c));
  addShopWindows(geometries, cells);
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
  if (bldV2()) await addFacadeDetail(material, tl, baseUrl, canvas.width);
  // „Malowany”: painted walls, roofs, wallpapers and floors (off until the style is chosen).
  setPaintedBuildingCells(index.cells, V2_DETAIL);
  withPaintedBuildings(material);
  withFade(material);
  return { geometries, material, cells, detail, cellIndex: index.cells };
}

/** bld v2: facade detail atlas in the same material (see bld-detail.ts); skipped on failure. */
async function addFacadeDetail(
  material: MeshStandardMaterial,
  tl: TextureLoader,
  baseUrl: string,
  size: number,
): Promise<void> {
  try {
    const [tex, meta] = await Promise.all([
      tl.loadAsync(`${baseUrl}deadzone-town/facade-detail.webp`),
      fetch(`${baseUrl}deadzone-town/facade-detail.json`).then(
        (r) => r.json() as Promise<{ cells: { tileMeters: number }[] }>,
      ),
    ]);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    paintDetailIndex(ctx, size);
    const index = new CanvasTexture(c);
    index.colorSpace = NoColorSpace;
    index.magFilter = index.minFilter = NearestFilter;
    index.generateMipmaps = false;
    index.flipY = false;
    tex.colorSpace = NoColorSpace;
    tex.flipY = false;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    withFacadeDetail(
      material,
      tex,
      index,
      meta.cells.map((x) => x.tileMeters),
    );
  } catch (e) {
    console.warn('bld v2: facade detail not loaded', e);
  }
}

/** Shop window modules `shopwin-<skin>` (+ `-lit`, `-broken`) for every wall skin. */
export function addShopWindows(geometries: Map<string, BufferGeometry>, cells: TownCells): void {
  const ref = geometries.get('wall-plaster');
  ref?.computeBoundingBox();
  const bb = ref?.boundingBox;
  const t = bb ? Math.min(0.4, Math.max(0.05, bb.max.z - bb.min.z)) : 0.2;
  const h = bb ? bb.max.y : 2.8;
  for (const skin of ALL_SKINS) {
    const wall = WALL_CELL[skin];
    geometries.set(`shopwin-${skin}`, shopWindowGeometry(cells, wall, {}, t, h));
    geometries.set(`shopwin-${skin}-lit`, shopWindowGeometry(cells, wall, { lit: true }, t, h));
    geometries.set(
      `shopwin-${skin}-broken`,
      shopWindowGeometry(cells, wall, { broken: true }, t, h),
    );
  }
}
