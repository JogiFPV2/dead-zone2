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

/** Box InstancedMesh of `n` wall pieces (atlas uv + fade per instance). */
function wallMesh(material: Material, n: number): InstancedMesh {
  const g = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  g.setAttribute('instanceUv', new InstancedBufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('instanceFade', new InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
  const mesh = new InstancedMesh(g, fadeMaterial(material), n);
  mesh.name = 'vector-walls';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

const ZERO = new Matrix4().makeScale(0, 0, 0);

/**
 * Vector walls of every streamed level and chunk in a few shared InstancedMeshes (blocks of
 * instances per `VectorWalls`, first fit): map2 / `?map=stw2` has vector walls on every building,
 * a mesh per chunk level was ~40 draw calls (twice with shadows) at a zoomed-out view.
 */
export class VectorWallPool {
  readonly root = new Group();
  private readonly parts: { mesh: InstancedMesh; free: [number, number][]; top: number }[] = [];

  constructor(
    private readonly material: Material,
    private readonly capacity = 16384,
  ) {
    this.root.name = 'vector-walls';
  }

  alloc(n: number): { mesh: InstancedMesh; start: number } {
    for (const p of this.parts) {
      const i = p.free.findIndex(([, len]) => len >= n);
      if (i >= 0) {
        const [start, len] = p.free[i]!;
        if (len === n) p.free.splice(i, 1);
        else p.free[i] = [start + n, len - n];
        return { mesh: p.mesh, start };
      }
      if (p.top + n <= p.mesh.instanceMatrix.count) {
        const start = p.top;
        p.top += n;
        p.mesh.count = p.top;
        return { mesh: p.mesh, start };
      }
    }
    const mesh = wallMesh(this.material, Math.max(this.capacity, n));
    // One mesh over many chunks: culled as a whole would always pass, bounds would go stale.
    mesh.frustumCulled = false;
    mesh.count = n;
    this.parts.push({ mesh, free: [], top: n });
    this.root.add(mesh);
    return { mesh, start: 0 };
  }

  free(mesh: InstancedMesh, start: number, n: number): void {
    const p = this.parts.find((q) => q.mesh === mesh);
    if (!p) return;
    const fade = mesh.geometry.getAttribute('instanceFade') as InstancedBufferAttribute;
    for (let k = start; k < start + n; k++) {
      mesh.setMatrixAt(k, ZERO);
      fade.setX(k, 1);
    }
    mesh.instanceMatrix.needsUpdate = true;
    fade.needsUpdate = true;
    p.free.push([start, n]);
    // Merge neighbours, give the tail back.
    p.free.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const f of p.free) {
      const last = merged[merged.length - 1];
      if (last && last[0] + last[1] === f[0]) last[1] += f[1];
      else merged.push([f[0], f[1]]);
    }
    const tail = merged[merged.length - 1];
    if (tail && tail[0] + tail[1] === p.top) {
      p.top = tail[0];
      merged.pop();
    }
    p.free = merged;
    mesh.count = p.top;
  }

  /** Pieces drawn (tests). */
  get used(): number {
    return this.parts.reduce((s, p) => s + p.top - p.free.reduce((t, [, len]) => t + len, 0), 0);
  }

  get meshCount(): number {
    return this.parts.length;
  }

  dispose(): void {
    for (const p of this.parts) {
      p.mesh.geometry.dispose();
      p.mesh.dispose();
    }
    this.parts.length = 0;
    this.root.clear();
  }
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
  /** Instances taken from `pool` (streamed worlds). */
  private block: { mesh: InstancedMesh; start: number; n: number } | undefined;
  readonly buildings = new Set<BuildingId>();

  constructor(
    segments: readonly SimWallSegment[],
    private readonly z: number,
    private readonly baseY: number,
    cells: TownCells,
    material: Material,
    skinOf: (b: BuildingId) => Skin,
    fullOf: (b: BuildingId) => number = () => WALL_HEIGHT,
    private readonly pool?: VectorWallPool,
  ) {
    this.root.name = 'vector-walls';
    for (const s of segments) this.buildings.add(s.building ?? NO_BUILDING);
    if (segments.length) {
      const m = new Matrix4();
      const n = segments.length * 3;
      let mesh: InstancedMesh;
      let start = 0;
      if (pool) {
        ({ mesh, start } = pool.alloc(n));
        this.block = { mesh, start, n };
      } else {
        mesh = wallMesh(material, n);
        mesh.count = n;
        this.meshes.push(mesh);
        this.root.add(mesh);
      }
      const iuvAttr = mesh.geometry.getAttribute('instanceUv') as InstancedBufferAttribute;
      const iuv = iuvAttr.array as Float32Array;
      const uvOf = new Map<Skin, [number, number]>();
      let k = start;
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
      mesh.instanceMatrix.needsUpdate = true;
      iuvAttr.needsUpdate = true;
      if (!pool) mesh.computeBoundingSphere();
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
    if (this.block) this.pool?.free(this.block.mesh, this.block.start, this.block.n);
    this.block = undefined;
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    this.root.clear();
  }
}

/** Same reach / margin / cap as the generator's gaps around exterior openings (building.ts). */
const OPENING_REACH = 1.6;
const GAP_MARGIN = 0.1;
const MAX_GAP = 3;
const OPENING_GAP = 1.2;

/** Where an exterior door / window of a vector-walled building sits on its outline. */
export interface OutlineOpening {
  x: number;
  z: number;
  /** Rotation about +y of the edge module (local +x along the wall). */
  rotY: number;
  /** Gap width (m): the 1 m module is stretched to it. */
  width: number;
}

/**
 * The gap the generator cut into a vector wall for the opening on tile edge (x0, y0)–(x1, y1):
 * on the outline edge nearest to the tile edge that crosses its corridor (else the nearest edge,
 * centred). The module is turned along that wall, its local +z on the same side as `rotY0`'s
 * (inside / outside of the tile edge kept). Pure (tests).
 */
export function openingOnOutline(
  rings: readonly (readonly number[])[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rotY0: number,
): OutlineOpening | undefined {
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  let best: { ax: number; ay: number; ux: number; uy: number; t0: number; t1: number } | undefined;
  let bestS = Infinity;
  let near: typeof best;
  let nearD = OPENING_REACH;
  for (const r of rings) {
    const n = r.length >> 1;
    for (let i = 0; i < n; i++) {
      const ax = r[2 * i]!;
      const ay = r[2 * i + 1]!;
      const bx = r[(2 * i + 2) % (2 * n)]!;
      const by = r[(2 * i + 3) % (2 * n)]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const ux = dx / len;
      const uy = dy / len;
      // Fallback: nearest point of the edge to the tile edge's midpoint.
      const tm = Math.max(0, Math.min(len, (mx - ax) * ux + (my - ay) * uy));
      const dm = Math.hypot(ax + ux * tm - mx, ay + uy * tm - my);
      if (dm < nearD) {
        nearD = dm;
        near = { ax, ay, ux, uy, t0: tm - OPENING_GAP / 2, t1: tm + OPENING_GAP / 2 };
      }
      const det = dx * ny - dy * nx;
      if (Math.abs(det) < 1e-6 * len) continue;
      const ts: number[] = [];
      let s = Infinity;
      for (const [px, py] of [
        [x0, y0],
        [x1, y1],
      ] as const) {
        ts.push((((px - ax) * ny - (py - ay) * nx) / det) * len);
        s = Math.min(s, Math.abs(((px - ax) * dy - (py - ay) * dx) / det));
      }
      const t0 = Math.min(...ts) - GAP_MARGIN;
      const t1 = Math.max(...ts) + GAP_MARGIN;
      if (s > OPENING_REACH || t1 < 0 || t0 > len || t1 - t0 > MAX_GAP) continue;
      if (s < bestS) {
        bestS = s;
        best = { ax, ay, ux, uy, t0: Math.max(0, t0), t1: Math.min(len, t1) };
      }
    }
  }
  const g = best ?? near;
  if (!g || g.t1 - g.t0 < 0.3) return undefined;
  const c = (g.t0 + g.t1) / 2;
  let { ux, uy } = g;
  // Local +z of rotation a is (sin a, cos a); keep it on the side of the tile module's +z.
  const zx = Math.sin(rotY0);
  const zz = Math.cos(rotY0);
  if (-uy * zx + ux * zz < 0) {
    ux = -ux;
    uy = -uy;
  }
  return {
    x: g.ax + g.ux * c,
    z: g.ay + g.uy * c,
    rotY: Math.atan2(-uy, ux),
    width: g.t1 - g.t0,
  };
}
