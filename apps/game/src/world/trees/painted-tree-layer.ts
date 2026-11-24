import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { paintedTexture } from '../../render/painted-ground.js';
import { PAINTED_PLANTS, plantModel, SPECIES_PLANT, type PaintedPlant } from './painted-plants.js';
import { heightAt, look, SPECIES_LOOK, spotHash } from './species.js';
import { isTreeProp, speciesOf, type TreeSpot } from './tree-layer.js';

/** Kit grass tufts of the town decor: drawn as painted shrubs. */
export const SHRUB_PROPS: ReadonlySet<string> = new Set(['prop-grass-large']);

/** Most scrub shrubs one chunk adds (instancing budget). */
export const SCRUB_MAX = 160;

/** Plants of scrub / hedge zones (`scrubSpots`). */
export const SCRUB_PROP = 'painted-scrub';

/**
 * Shrubs of scrub and hedge zones (rects in global tiles): a narrow strip (≤ 2 tiles, an OSM
 * hedge) gets a dense row every 0.8 m, a wider zone loose shrubs on a quarter of its tiles.
 */
export function scrubSpots(
  rects: readonly { x: number; y: number; w: number; h: number }[],
): TreeSpot[] {
  const out: TreeSpot[] = [];
  for (const r of rects) {
    if (out.length >= SCRUB_MAX) break;
    if (Math.min(r.w, r.h) <= 2) {
      const along = r.w >= r.h;
      const len = along ? r.w : r.h;
      for (let d = 0.4; d < len; d += 0.8) {
        const x = along ? r.x + d : r.x + r.w / 2;
        const z = along ? r.y + r.h / 2 : r.y + d;
        out.push({ x, z, y: 0, prop: SCRUB_PROP });
      }
      continue;
    }
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        if (spotHash(x, y, 11) >= 0.25 || out.length >= SCRUB_MAX) continue;
        out.push({
          x: x + 0.2 + spotHash(x, y, 12) * 0.6,
          z: y + 0.2 + spotHash(x, y, 13) * 0.6,
          y: 0,
          prop: SCRUB_PROP,
        });
      }
  }
  return out;
}

/** Shrub height range (m). */
const SHRUB_HEIGHT = [0.6, 1.15] as const;
/**
 * Share of the kit's grass tufts drawn as shrubs (the tufts are dense, 4 % of open grass: a shrub
 * on each would turn every meadow into scrub).
 */
export const SHRUB_SHARE = 0.3;

/** Plant model and height of one spot; undefined = not drawn (a thinned-out grass tuft). */
export function plantOf(t: TreeSpot): { plant: PaintedPlant; height: number } | undefined {
  if (t.prop === SCRUB_PROP) {
    const h = 0.9 + 0.6 * spotHash(t.x, t.z, 7);
    return { plant: 'krzew', height: h };
  }
  if (t.prop && SHRUB_PROPS.has(t.prop)) {
    if (spotHash(t.x, t.z, 9) >= SHRUB_SHARE) return undefined;
    const h = SHRUB_HEIGHT[0] + (SHRUB_HEIGHT[1] - SHRUB_HEIGHT[0]) * spotHash(t.x, t.z, 7);
    return { plant: 'krzew', height: h * (t.scale ?? 1) };
  }
  const s = speciesOf(t);
  const plant = SPECIES_PLANT[s.replace(/^base:/, '')];
  if (!SPECIES_LOOK.has(s)) {
    // Species the town planting skips (apple: gardens, hazel: a shrub): own game heights.
    const [a, b] = OTHER_HEIGHT[s] ?? [3, 5];
    return {
      plant: plant ?? 'dab',
      height: (a + (b - a) * spotHash(t.x, t.z, 2)) * (t.scale ?? 1),
    };
  }
  return {
    plant: plant ?? (look(s).leafType === 'conifer' ? 'swierk' : 'dab'),
    height: heightAt(s, t.x, t.z) * (t.scale ?? 1),
  };
}

/** Game heights (m) of species without a town look (content height × TREE_HEIGHT_SCALE-ish). */
const OTHER_HEIGHT: Readonly<Record<string, readonly [number, number]>> = {
  'base:apple': [2.4, 4],
  'base:hazel': [1.2, 2.2],
};

interface Pair {
  bark: InstancedMesh;
  leaves: InstancedMesh;
}

/**
 * Painted trees and shrubs („Malowany”): every loaded tree of the generated map (and the kit's
 * grass tufts, as shrubs) drawn with the painted plant models, two InstancedMeshes (bark, leaves)
 * per model whatever the count. Species from the content pack, as in the realistic style.
 */
export class PaintedTreeLayer {
  readonly root = new Group();
  private readonly chunks = new Map<string, readonly TreeSpot[]>();
  private readonly meshes = new Map<PaintedPlant, Pair>();
  private readonly barkMats = new Map<string, MeshStandardMaterial>();
  private readonly leafMats = new Map<string, MeshStandardMaterial>();
  private dirty = false;

  constructor() {
    this.root.name = 'painted-trees';
  }

  isTree(name: string): boolean {
    return isTreeProp(name) || SHRUB_PROPS.has(name);
  }

  zoneSpots(
    bushes: readonly { x: number; y: number; w: number; h: number }[],
    woods: readonly { x: number; y: number; w: number; h: number }[],
  ): TreeSpot[] {
    // Woods already carry the plan's trees (species by habitat): no extra planting.
    void woods;
    return scrubSpots(bushes);
  }

  load(key: string, trees: readonly TreeSpot[]): void {
    if (trees.length === 0 && !this.chunks.has(key)) return;
    this.chunks.set(key, trees);
    this.dirty = true;
  }

  unload(key: string): void {
    if (this.chunks.delete(key)) this.dirty = true;
  }

  /** Loaded plants (dev hook / tests). */
  get count(): number {
    let n = 0;
    for (const p of this.meshes.values()) n += p.bark.count;
    return n;
  }

  update(): void {
    if (this.dirty) this.rebuild();
  }

  private material(map: Map<string, MeshStandardMaterial>, tex: string, leaves: boolean) {
    let m = map.get(tex);
    if (!m) {
      m = new MeshStandardMaterial({
        map: paintedTexture(tex as never),
        roughness: 0.9,
        metalness: 0,
        vertexColors: leaves,
      });
      m.name = `painted-${leaves ? 'leaves' : 'bark'}-${tex}`;
      map.set(tex, m);
    }
    return m;
  }

  private pair(id: PaintedPlant, n: number): Pair {
    let p = this.meshes.get(id);
    if (!p || p.bark.instanceMatrix.count < n) {
      if (p) {
        this.root.remove(p.bark, p.leaves);
        p.bark.dispose();
        p.leaves.dispose();
      }
      const cap = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n))));
      const m = plantModel(id);
      const bark = new InstancedMesh(m.bark, this.material(this.barkMats, m.barkTex, false), cap);
      const leaves = new InstancedMesh(
        m.leaves,
        this.material(this.leafMats, m.leafTex, true),
        cap,
      );
      for (const x of [bark, leaves]) {
        // Shrubs are many and low: no shadow pass for them.
        x.castShadow = id !== 'krzew';
        x.receiveShadow = true;
        // Instances cover the whole loaded ring: no per-mesh culling.
        x.frustumCulled = false;
        this.root.add(x);
      }
      bark.name = `painted-${id}-bark`;
      leaves.name = `painted-${id}-leaves`;
      p = { bark, leaves };
      this.meshes.set(id, p);
    }
    return p;
  }

  private rebuild(): void {
    this.dirty = false;
    const groups = new Map<PaintedPlant, { t: TreeSpot; height: number }[]>();
    for (const list of this.chunks.values())
      for (const t of list) {
        const p = plantOf(t);
        if (!p) continue;
        const { plant, height } = p;
        let g = groups.get(plant);
        if (!g) groups.set(plant, (g = []));
        g.push({ t, height });
      }
    for (const id of PAINTED_PLANTS) {
      const list = groups.get(id) ?? [];
      if (!list.length && !this.meshes.has(id)) continue;
      const p = this.pair(id, list.length);
      list.forEach(({ t, height }, i) => {
        rot.setFromAxisAngle(UP, Math.PI * 2 * spotHash(t.x, t.z, 4));
        // Slightly uneven crowns: ±8 % width per tree.
        const w = height * (0.92 + spotHash(t.x, t.z, 6) * 0.16);
        m4.compose(pos.set(t.x, t.y ?? 0, t.z), rot, scl.set(w, height, w));
        p.bark.setMatrixAt(i, m4);
        p.leaves.setMatrixAt(i, m4);
        // ±8 % lightness and a little hue drift: a row of trees is not one colour.
        col
          .setRGB(1, 1, 1)
          .offsetHSL((spotHash(t.x, t.z, 8) - 0.5) * 0.03, 0, (spotHash(t.x, t.z, 5) - 0.5) * 0.16);
        p.leaves.setColorAt(i, col);
      });
      p.bark.count = p.leaves.count = list.length;
      p.bark.instanceMatrix.needsUpdate = true;
      p.leaves.instanceMatrix.needsUpdate = true;
      if (p.leaves.instanceColor) p.leaves.instanceColor.needsUpdate = true;
    }
  }
}

const pos = new Vector3();
const scl = new Vector3();
const rot = new Quaternion();
const UP = new Vector3(0, 1, 0);
const m4 = new Matrix4();
const col = new Color();
