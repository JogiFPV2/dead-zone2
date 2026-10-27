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
import { SPECIES_LOOK, heightAt, speciesAt, spotHash, type TreeSpecies } from './species.js';
import { crownGeometry, trunkGeometry } from './tree-geometry.js';
import { windTime, withWind } from './wind.js';

/** One tree to draw (world x / z on the ground at `y`). */
export interface TreeSpot {
  x: number;
  z: number;
  y?: number;
  /** Size factor of the placement (1 = species height). */
  scale?: number;
  species?: TreeSpecies;
}

/** Kit prop names drawn as real trees instead (town decor). */
export const isTreeProp = (name: string): boolean => name.startsWith('prop-tree');

/**
 * Realistic trees (`?style=real`): every loaded tree in two InstancedMeshes, crowns of
 * alpha-tested leaf cards (alpha to coverage, no sorting) with a vertex-shader wind sway and
 * trunks, coloured per species. 2 draw calls (+2 in the shadow pass) whatever the tree count.
 */
export class TreeLayer {
  readonly root = new Group();
  private readonly chunks = new Map<string, readonly TreeSpot[]>();
  private readonly crownGeo: BufferGeometry = crownGeometry();
  private readonly trunkGeo: BufferGeometry = trunkGeometry();
  private readonly leafMat: MeshStandardMaterial;
  private readonly barkMat = new MeshStandardMaterial({ roughness: 0.95 });
  private readonly leafDepth: MeshDepthMaterial;
  private crowns: InstancedMesh | undefined;
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
    return this.crowns?.count ?? 0;
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

  private ensure(n: number): { crowns: InstancedMesh; trunks: InstancedMesh } {
    if (!this.crowns || !this.trunks || this.crowns.instanceMatrix.count < n) {
      const cap = Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
      for (const m of [this.crowns, this.trunks]) {
        if (m) {
          this.root.remove(m);
          m.dispose();
        }
      }
      const crowns = new InstancedMesh(this.crownGeo, this.leafMat, cap);
      crowns.customDepthMaterial = this.leafDepth;
      const trunks = new InstancedMesh(this.trunkGeo, this.barkMat, cap);
      for (const m of [crowns, trunks]) {
        m.castShadow = true;
        m.receiveShadow = true;
        // Instances cover the whole loaded ring: no per-mesh culling.
        m.frustumCulled = false;
        this.root.add(m);
      }
      crowns.name = 'real-trees-crowns';
      trunks.name = 'real-trees-trunks';
      this.crowns = crowns;
      this.trunks = trunks;
    }
    return { crowns: this.crowns, trunks: this.trunks };
  }

  private rebuild(): void {
    this.dirty = false;
    let n = 0;
    for (const list of this.chunks.values()) n += list.length;
    const { crowns, trunks } = this.ensure(n);
    let i = 0;
    for (const list of this.chunks.values())
      for (const t of list) {
        writeTree(crowns, trunks, i++, t);
      }
    crowns.count = trunks.count = i;
    for (const m of [crowns, trunks]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

const pos = new Vector3();
const scl = new Vector3();
const rot = new Quaternion();
const UP = new Vector3(0, 1, 0);
const m4 = new Matrix4();
const col = new Color();

/** Crown + trunk matrices and colours of tree `i`. */
export function writeTree(
  crowns: InstancedMesh,
  trunks: InstancedMesh,
  i: number,
  t: TreeSpot,
): void {
  const s = t.species ?? speciesAt(t.x, t.z);
  const look = SPECIES_LOOK[s];
  const h = heightAt(s, t.x, t.z) * (t.scale ?? 1);
  const y = t.y ?? 0;
  const yaw = Math.PI * 2 * spotHash(t.x, t.z, 4);
  rot.setFromAxisAngle(UP, yaw);
  const crownR = look.crownWidth * h;
  const crownH = look.crownHeight * h;
  pos.set(t.x, y + h - crownH / 2, t.z);
  crowns.setMatrixAt(i, m4.compose(pos, rot, scl.set(crownR, crownH / 2, crownR)));
  // Small per-tree tint variation (±8 % lightness) so a row is not one colour.
  col.set(look.leaf).offsetHSL(0, 0, (spotHash(t.x, t.z, 5) - 0.5) * 0.08);
  crowns.setColorAt(i, col);
  pos.set(t.x, y, t.z);
  const r = look.trunkRadius * h;
  trunks.setMatrixAt(i, m4.compose(pos, rot, scl.set(r, h - crownH * 0.55, r)));
  trunks.setColorAt(i, col.set(look.bark));
}
