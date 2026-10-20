import {
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { NO_BUILDING } from '../../world/chunk.js';
import { isOccluder, type Cutaway } from '../../world/cutaway.js';
import { BUSH, bodyCentre, type ModelPlacement } from './map-models.js';

/** What one loaded chunk contributes: buildings (deduplicated by id), shelters, bushes. */
export interface ChunkModels {
  readonly buildings: ReadonlyMap<number, readonly ModelPlacement[]>;
  readonly props: readonly ModelPlacement[];
}

const Y = new Vector3(0, 1, 0);

/** Placement → instance matrix: body centre to the origin, scale, yaw, then to the map. */
export function placementMatrix(p: ModelPlacement, out = new Matrix4()): Matrix4 {
  const c = bodyCentre(p.id);
  const pre = new Matrix4().makeTranslation(-c.x, 0, -c.z);
  out.compose(
    new Vector3(p.x, 0, p.z),
    new Quaternion().setFromAxisAngle(Y, p.rotY),
    new Vector3(p.sx, p.sy, p.sz),
  );
  return out.multiply(pre);
}

/**
 * Designer's models on the map in the realistic style: ONE InstancedMesh per model over every
 * loaded near chunk (shared PBR material: one draw call per model + its shadow pass). A building
 * the cutaway opens (the player's, an occluder) hides its model; the kit pieces show instead.
 */
export class RealMapLayer {
  readonly root = new Group();
  private readonly chunks = new Map<string, ChunkModels>();
  /** Building id → placements and the number of loaded chunks listing it. */
  private readonly buildings = new Map<number, { list: readonly ModelPlacement[]; refs: number }>();
  private meshes = new Map<string, InstancedMesh>();
  private dirty = false;
  private cutKey = '';
  private cut: ReadonlySet<number> = new Set();

  constructor(
    private readonly models: ReadonlyMap<string, BufferGeometry>,
    private readonly material: Material,
    /** Small props (bushes) cast shadows only on medium / high. */
    private readonly propShadows: boolean,
  ) {
    this.root.name = 'pbr-map';
  }

  loadChunk(cx: number, cy: number, m: ChunkModels): void {
    this.unloadChunk(cx, cy);
    this.chunks.set(`${cx},${cy}`, m);
    for (const [id, list] of m.buildings) {
      const b = this.buildings.get(id);
      if (b) b.refs++;
      else this.buildings.set(id, { list, refs: 1 });
    }
    this.dirty = true;
  }

  unloadChunk(cx: number, cy: number): void {
    const k = `${cx},${cy}`;
    const m = this.chunks.get(k);
    if (!m) return;
    this.chunks.delete(k);
    for (const id of m.buildings.keys()) {
      const b = this.buildings.get(id);
      if (b && --b.refs <= 0) this.buildings.delete(id);
    }
    this.dirty = true;
  }

  /** Buildings opened by the cutaway (player's, occluders) drop their model. */
  setCutaway(c: Cutaway): void {
    const open = new Set<number>();
    if (c.building !== NO_BUILDING) open.add(c.building);
    for (const b of c.occluders ?? []) if (isOccluder(c, b)) open.add(b);
    const key = [...open].sort((a, b) => a - b).join(',');
    if (key === this.cutKey) return;
    this.cutKey = key;
    this.cut = open;
    this.dirty = true;
  }

  /** Rebuilds the instance buffers when chunks or the cutaway changed (once per frame at most). */
  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const byId = new Map<string, ModelPlacement[]>();
    const add = (p: ModelPlacement) => {
      let l = byId.get(p.id);
      if (!l) byId.set(p.id, (l = []));
      l.push(p);
    };
    for (const [id, b] of this.buildings) if (!this.cut.has(id)) b.list.forEach(add);
    for (const m of this.chunks.values()) m.props.forEach(add);
    const m4 = new Matrix4();
    for (const [id, mesh] of this.meshes) {
      if (byId.has(id)) continue;
      this.root.remove(mesh);
      mesh.dispose();
      this.meshes.delete(id);
    }
    for (const [id, list] of byId) {
      const g = this.models.get(id);
      if (!g) continue;
      let mesh = this.meshes.get(id);
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.root.remove(mesh);
          mesh.dispose();
        }
        mesh = new InstancedMesh(g, this.material, Math.max(16, Math.ceil(list.length * 1.5)));
        mesh.name = `pbr-map:${id}`;
        mesh.castShadow = id !== BUSH || this.propShadows;
        mesh.receiveShadow = true;
        this.meshes.set(id, mesh);
        this.root.add(mesh);
      }
      list.forEach((p, i) => mesh.setMatrixAt(i, placementMatrix(p, m4)));
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  /** Instances per model (tests, perf probe). */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, m] of this.meshes) out[id] = m.count;
    return out;
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    this.meshes.clear();
    this.root.clear();
  }
}
