import {
  BoxGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import type { SimWallSegment } from '@deadzone/protocol';
import { NO_BUILDING, type BuildingId } from '../chunk.js';
import { CUT_NEAR, isLevelHidden, isOccluder, type Cutaway } from '../cutaway.js';
import { LOWERED_HEIGHT, WALL_HEIGHT, WALL_THICKNESS } from '../structure-instances.js';
import type { TownCells } from './kit.js';
import { WALL_CELL, type Skin } from './modules.js';
import {
  FADE_MIN,
  FADE_POST,
  occludesPlayer,
  stepFade,
  unfaded,
  withFade,
  type FadeView,
} from '../wall-fade.js';

/**
 * Atlas cell per instance: the box's uv (one atlas texel per skin) read from `instanceUv`, so all
 * skins share ONE InstancedMesh (bld v2 gives most buildings their own skin; a mesh per skin was a
 * draw call per building colour, map2 / `?map=stw2` has vector walls on every building).
 */
export function patchInstanceUv(vertexShader: string): string {
  return `attribute vec2 instanceUv;\n${vertexShader.replace(
    '#include <uv_vertex>',
    '#define uv instanceUv\n#include <uv_vertex>\n#undef uv',
  )}`;
}

/** Kit material → its clone reading `instanceFade` and `instanceUv` (one per kit material). */
const fadeMaterials = new WeakMap<Material, Material>();
function fadeMaterial(m: Material): Material {
  let f = fadeMaterials.get(m);
  if (!f) {
    f = m.clone();
    // clone() drops onBeforeCompile: copy the original's (PBR patch etc.), then add the fade.
    const base = unfaded(m);
    f.onBeforeCompile = base.onBeforeCompile;
    f.customProgramCacheKey = base.customProgramCacheKey;
    withFade(f, true);
    const prev = f.onBeforeCompile.bind(f);
    const prevKey = f.customProgramCacheKey.bind(f);
    f.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = patchInstanceUv(sh.vertexShader);
    };
    f.customProgramCacheKey = () => `${prevKey()}|dz-iuv`;
    fadeMaterials.set(m, f);
  }
  return f;
}

/** Corner post (decoration only, no collision: not a wall segment): side length (m). */
export const POST_SIZE = 0.26;

const Y_AXIS = new Vector3(0, 1, 0);
const q = new Quaternion();
const pos = new Vector3();
const scl = new Vector3();

/**
 * Matrix of a unit box (bottom at y = 0) stretched along a wall segment (sim x / y → world X / Z),
 * `WALL_THICKNESS` thick, a little longer than the segment so joints close. Pure (tests).
 */
export function segmentMatrix(
  out: Matrix4,
  s: SimWallSegment,
  baseY: number,
  height: number,
): Matrix4 {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const len = Math.hypot(dx, dy);
  q.setFromAxisAngle(Y_AXIS, -Math.atan2(dy, dx));
  pos.set((s.x0 + s.x1) / 2, baseY, (s.y0 + s.y1) / 2);
  return out.compose(pos, q, scl.set(len + WALL_THICKNESS, height, WALL_THICKNESS));
}

/** Matrix of a corner post at (x, y). */
function postMatrix(out: Matrix4, x: number, y: number, baseY: number, height: number): Matrix4 {
  q.identity();
  return out.compose(pos.set(x, baseY, y), q, scl.set(POST_SIZE, height + 0.05, POST_SIZE));
}

/** Whether a wall at (mx, my) of a near building faces the camera from the player (CUT_NEAR). */
function nearAndFacing(c: Cutaway, mx: number, my: number): boolean {
  const px = c.tx + 0.5;
  const py = c.ty + 0.5;
  if (Math.abs(mx - px) > CUT_NEAR + 1 || Math.abs(my - py) > CUT_NEAR + 1) return false;
  return (mx - px) * c.side.sx + (my - py) * c.side.sz > 0;
}

/** Height of a vector wall under the cutaway: 0 = hidden. Pure (tests). */
export function vectorWallHeight(
  c: Cutaway,
  building: BuildingId,
  z: number,
  mx: number,
  my: number,
  full = WALL_HEIGHT,
): number {
  if (isLevelHidden(c, building, z)) return 0;
  if (z !== (c.z ?? 0)) return full;
  const own = building !== NO_BUILDING && building === c.building;
  const active = c.building !== NO_BUILDING || (c.occluders?.size ?? 0) > 0;
  const lowered = own || isOccluder(c, building) || (active && nearAndFacing(c, mx, my));
  return lowered ? LOWERED_HEIGHT : full;
}

interface Item {
  mesh: InstancedMesh;
  index: number;
  building: BuildingId;
  seg?: SimWallSegment;
  post?: [number, number];
  height: number;
  /** Wall fade: current opacity / fading in. */
  fade?: { cur: number; on: boolean } | undefined;
  /** Uncut height: the storey height below the top level (no slot at the slab), else walls. */
  full: number;
}

/**
 * Vector walls of slanted buildings on one level (`ChunkData.wallSegments`): one InstancedMesh
 * of atlas-coloured boxes per skin plus decorative corner posts. The raster stair-steps of the
 * same buildings (their exterior plain walls) are not drawn; doors / windows stay on the tile
 * edges, visible through the gaps the generator cut into the outline.
 */
export class VectorWalls {
  readonly root = new Group();
  private readonly items: Item[] = [];
  private readonly meshes: InstancedMesh[] = [];
  private readonly geometries: BoxGeometry[] = [];
  readonly buildings = new Set<BuildingId>();

  constructor(
    segments: readonly SimWallSegment[],
    private readonly z: number,
    private readonly baseY: number,
    cells: TownCells,
    material: Material,
    skinOf: (b: BuildingId) => Skin,
    fullOf: (b: BuildingId) => number = () => WALL_HEIGHT,
  ) {
    this.root.name = 'vector-walls';
    for (const s of segments) this.buildings.add(s.building ?? NO_BUILDING);
    if (segments.length) {
      const m = new Matrix4();
      const n = segments.length * 3;
      const g = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const iuv = new Float32Array(n * 2);
      g.setAttribute('instanceUv', new InstancedBufferAttribute(iuv, 2));
      g.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
      this.geometries.push(g);
      const mesh = new InstancedMesh(g, fadeMaterial(material), n);
      mesh.name = 'vector-walls';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const uvOf = new Map<Skin, [number, number]>();
      let k = 0;
      for (const s of segments) {
        const building = s.building ?? NO_BUILDING;
        const skin = skinOf(building);
        let uv = uvOf.get(skin);
        if (!uv) uvOf.set(skin, (uv = cells.uv(WALL_CELL[skin])));
        const full = fullOf(building);
        const put = (mat: Matrix4, extra: Partial<Item>) => {
          mesh.setMatrixAt(k, mat);
          iuv[2 * k] = uv[0];
          iuv[2 * k + 1] = uv[1];
          this.items.push({ mesh, index: k++, building, height: full, full, ...extra });
        };
        put(segmentMatrix(m, s, baseY, full), { seg: s });
        for (const p of [
          [s.x0, s.y0],
          [s.x1, s.y1],
        ] as [number, number][])
          put(postMatrix(m, p[0], p[1], baseY, full), { post: p });
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
  }

  get segmentCount(): number {
    return this.items.filter((i) => i.seg).length;
  }

  setCutaway(c: Cutaway): void {
    const m = new Matrix4();
    const dirty = new Set<InstancedMesh>();
    for (const it of this.items) {
      const mx = it.seg ? (it.seg.x0 + it.seg.x1) / 2 : it.post![0];
      const my = it.seg ? (it.seg.y0 + it.seg.y1) / 2 : it.post![1];
      const h = vectorWallHeight(c, it.building, this.z, mx, my, it.full);
      if (h === it.height) continue;
      it.height = h;
      if (h === 0) m.makeScale(0, 0, 0);
      else if (it.seg) segmentMatrix(m, it.seg, this.baseY, h);
      else postMatrix(m, it.post![0], it.post![1], this.baseY, h);
      it.mesh.setMatrixAt(it.index, m);
      dirty.add(it.mesh);
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Wall fade (every frame), see `wall-fade.ts`. */
  setFade(v: FadeView | undefined, dtMs: number): void {
    const dirty = new Set<InstancedMesh>();
    const here = v !== undefined && v.z === this.z;
    for (const it of this.items) {
      if (!here && !it.fade) continue;
      let on = false;
      if (here && it.height > LOWERED_HEIGHT) {
        const [x0, y0, x1, y1] = it.seg
          ? [it.seg.x0, it.seg.y0, it.seg.x1, it.seg.y1]
          : [it.post![0], it.post![1], it.post![0], it.post![1]];
        on = occludesPlayer(v, x0, y0, x1, y1, it.fade?.on ?? false);
      }
      if (!it.fade) {
        if (!on) continue;
        it.fade = { cur: 1, on };
      }
      it.fade.on = on;
      const next = stepFade(it.fade.cur, on ? (it.post ? FADE_POST : FADE_MIN) : 1, dtMs);
      if (next !== it.fade.cur) {
        it.fade.cur = next;
        const a = it.mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute;
        a.setX(it.index, next);
        dirty.add(it.mesh);
      }
      if (!on && next === 1) it.fade = undefined;
    }
    for (const m of dirty) m.geometry.getAttribute('instanceFade').needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.root.clear();
  }
}
