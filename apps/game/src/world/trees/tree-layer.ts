import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  type BufferGeometry,
} from 'three';
import { leafClusterTexture } from './leaf-texture.js';
import { heightAt, look, speciesAt, spotHash, type TreeSpecies } from './species.js';
import { coniferGeometry, crownGeometry, trunkGeometry } from './tree-geometry.js';
import { windTime, withWind } from './wind.js';

/** One tree to draw (world x / z on the ground at `y`). */
export interface TreeSpot {
  x: number;
  z: number;
  y?: number;
  /** Size factor of the placement (1 = species height). */
  scale?: number;
  species?: TreeSpecies;
  /** Kit prop name (`prop-tree-tall` = a conifer, other `prop-tree*` = broadleaf). */
  prop?: string;
}

/** Kit trees drawn as conifers (the tall narrow kit tree is the classic style's spruce). */
export const CONIFER_PROPS: ReadonlySet<string> = new Set(['prop-tree-tall']);

/** Kit prop names drawn as real trees instead (town decor). */
export const isTreeProp = (name: string): boolean => name.startsWith('prop-tree');

/**
 * Realistic trees (`?style=real`): every loaded tree in three InstancedMeshes (broadleaf crowns,
 * conifer crowns, trunks). Crowns are alpha-tested leaf / needle cards (alpha to coverage, no
 * sorting) with a vertex-shader wind sway; colours per species from the content pack.
 * 3 draw calls (+3 in the shadow pass) whatever the tree count.
 */
export class TreeLayer {
  readonly root = new Group();
  private readonly chunks = new Map<string, readonly TreeSpot[]>();
  private readonly crownGeo: BufferGeometry = crownGeometry();
  private readonly coniferGeo: BufferGeometry = coniferGeometry();
  private readonly trunkGeo: BufferGeometry = trunkGeometry();
  private readonly leafMat: MeshStandardMaterial;
  private readonly barkMat = new MeshStandardMaterial({ roughness: 0.95 });
  private readonly leafDepth: MeshDepthMaterial;
  private crowns: InstancedMesh | undefined;
  private conifers: InstancedMesh | undefined;
  private trunks: InstancedMesh | undefined;
  private dirty = false;

  constructor() {
    this.root.name = 'real-trees';
    const map = leafClusterTexture();
    this.leafMat = withWind(
      new MeshStandardMaterial({
        map,
        alphaTest: 0.45,
        alphaToCoverage: true,
        side: DoubleSide,
        roughness: 0.85,
      }),
    );
    this.leafDepth = withWind(
      new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map, alphaTest: 0.45 }),
    );
  }

  isTree(name: string): boolean {
    return isTreeProp(name);
  }

  get count(): number {
    return this.trunks?.count ?? 0;
  }

  /** Loaded conifers (dev hook / tests). */
  get coniferCount(): number {
    return this.conifers?.count ?? 0;
  }

  load(key: string, trees: readonly TreeSpot[]): void {
    if (trees.length === 0 && !this.chunks.has(key)) return;
    this.chunks.set(key, trees);
    this.dirty = true;
  }

  unload(key: string): void {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  /** Once a frame: wind clock, instance rebuild after chunk changes. */
  update(timeSec: number): void {
    windTime.value = timeSec;
    if (this.dirty) this.rebuild();
  }

  private ensure(n: number): Meshes {
    if (!this.crowns || !this.conifers || !this.trunks || this.trunks.instanceMatrix.count < n) {
      const cap = Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
      for (const m of [this.crowns, this.conifers, this.trunks]) {
        if (m) {
          this.root.remove(m);
          m.dispose();
        }
      }
      const crowns = new InstancedMesh(this.crownGeo, this.leafMat, cap);
      const conifers = new InstancedMesh(this.coniferGeo, this.leafMat, cap);
      crowns.customDepthMaterial = conifers.customDepthMaterial = this.leafDepth;
      const trunks = new InstancedMesh(this.trunkGeo, this.barkMat, cap);
      for (const m of [crowns, conifers, trunks]) {
        m.castShadow = true;
        m.receiveShadow = true;
        // Instances cover the whole loaded ring: no per-mesh culling.
        m.frustumCulled = false;
        this.root.add(m);
      }
      crowns.name = 'real-trees-crowns';
      conifers.name = 'real-trees-conifers';
      trunks.name = 'real-trees-trunks';
      this.crowns = crowns;
      this.conifers = conifers;
      this.trunks = trunks;
    }
    return { crowns: this.crowns, conifers: this.conifers, trunks: this.trunks };
  }

  private rebuild(): void {
    this.dirty = false;
    let n = 0;
    for (const list of this.chunks.values()) n += list.length;
    const meshes = this.ensure(n);
    const at = { broadleaf: 0, conifer: 0, trunk: 0 };
    for (const list of this.chunks.values()) for (const t of list) writeTree(meshes, at, t);
    meshes.crowns.count = at.broadleaf;
    meshes.conifers.count = at.conifer;
    meshes.trunks.count = at.trunk;
    for (const m of [meshes.crowns, meshes.conifers, meshes.trunks]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

interface Meshes {
  crowns: InstancedMesh;
  conifers: InstancedMesh;
  trunks: InstancedMesh;
}

const pos = new Vector3();
const scl = new Vector3();
const rot = new Quaternion();
const UP = new Vector3(0, 1, 0);
const m4 = new Matrix4();
const col = new Color();

/** Species of a spot: explicit, else by its kit prop (conifer / broadleaf) and position. */
export function speciesOf(t: TreeSpot): TreeSpecies {
  return (
    t.species ?? speciesAt(t.x, t.z, t.prop && CONIFER_PROPS.has(t.prop) ? 'conifer' : 'broadleaf')
  );
}

/** Crown + trunk matrices and colours of one tree (`at` = next free slot per mesh). */
export function writeTree(
  meshes: Meshes,
  at: { broadleaf: number; conifer: number; trunk: number },
  t: TreeSpot,
): void {
  const s = speciesOf(t);
  const lk = look(s);
  const h = heightAt(s, t.x, t.z) * (t.scale ?? 1);
  const y = t.y ?? 0;
  const yaw = Math.PI * 2 * spotHash(t.x, t.z, 4);
  rot.setFromAxisAngle(UP, yaw);
  const crownR = lk.crownWidth * h;
  const crownH = lk.crownHeight * h;
  const crowns = lk.leafType === 'conifer' ? meshes.conifers : meshes.crowns;
  const ci = at[lk.leafType]++;
  pos.set(t.x, y + h - crownH / 2, t.z);
  crowns.setMatrixAt(ci, m4.compose(pos, rot, scl.set(crownR, crownH / 2, crownR)));
  // Small per-tree tint variation (±8 % lightness) so a row is not one colour.
  col.set(lk.leaf).offsetHSL(0, 0, (spotHash(t.x, t.z, 5) - 0.5) * 0.08);
  crowns.setColorAt(ci, col);
  pos.set(t.x, y, t.z);
  const r = lk.trunkRadius * h;
  // Conifer stems run up into the tip; broadleaf stems stop inside the crown.
  const stem = lk.leafType === 'conifer' ? h * 0.9 : h - crownH * 0.55;
  meshes.trunks.setMatrixAt(at.trunk, m4.compose(pos, rot, scl.set(r, stem, r)));
  meshes.trunks.setColorAt(at.trunk++, col.set(lk.bark));
}
