import {
  BoxGeometry,
  Group,
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
    const bySkin = new Map<Skin, SimWallSegment[]>();
    for (const s of segments) {
      const b = s.building ?? NO_BUILDING;
      this.buildings.add(b);
      const skin = skinOf(b);
      let list = bySkin.get(skin);
      if (!list) bySkin.set(skin, (list = []));
      list.push(s);
    }
    const m = new Matrix4();
    for (const [skin, list] of bySkin) {
      const g = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const [u, v] = cells.uv(WALL_CELL[skin]);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
      this.geometries.push(g);
      const mesh = new InstancedMesh(g, material, list.length * 3);
      mesh.name = 'vector-walls';
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      let k = 0;
      for (const s of list) {
        const building = s.building ?? NO_BUILDING;
        const full = fullOf(building);
        mesh.setMatrixAt(k, segmentMatrix(m, s, baseY, full));
        this.items.push({ mesh, index: k++, building, seg: s, height: full, full });
        for (const p of [
          [s.x0, s.y0],
          [s.x1, s.y1],
        ] as [number, number][]) {
          mesh.setMatrixAt(k, postMatrix(m, p[0], p[1], baseY, full));
          this.items.push({ mesh, index: k++, building, post: p, height: full, full });
        }
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

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    this.root.clear();
  }
}
