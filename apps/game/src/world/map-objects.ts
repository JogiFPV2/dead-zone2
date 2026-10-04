import {
  BoxGeometry,
  Group,
  type InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { NearbyContainerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';
import type { ChunkData, ChunkRange, ChunkSource } from './chunk.js';
import { CHUNK_SIZE } from './chunk.js';
import { MARKER_GEOMETRY, MARKER_MATERIAL, animateMarker } from './ground-piles.js';
import {
  buildInstances,
  disposeInstances,
  modelParts,
  setSlotsVisible,
  type InstanceSlots,
  type ModelPart,
} from './furniture-instances.js';

/** Box size [w, h, d] per content id (PLACEHOLDER shapes until models). */
const SIZES: Record<string, [number, number, number]> = {
  'base:fridge': [0.75, 1.8, 0.7],
  'base:freezer': [0.9, 0.9, 0.7],
  'base:kitchen-cabinet': [0.9, 0.9, 0.6],
  'base:kitchen-counter': [0.95, 0.9, 0.6],
  'base:wardrobe': [0.95, 1.9, 0.6],
  'base:dresser': [0.9, 1.0, 0.5],
  'base:bookshelf': [0.95, 1.9, 0.35],
  'base:wooden-chest': [0.9, 0.55, 0.55],
  'base:crate': [0.85, 0.7, 0.85],
  'base:metal-shelf': [0.95, 1.8, 0.45],
  'base:tool-chest': [0.7, 0.8, 0.45],
  'base:locker': [0.5, 1.8, 0.5],
  'base:gun-locker': [0.8, 1.8, 0.5],
};
const DEFAULT_SIZE: [number, number, number] = [0.8, 0.8, 0.8];

interface Obj {
  /** Chunk key `cx,cy,z`. */
  chunk: string;
  contentId: string;
  height: number;
  tx: number;
  ty: number;
  z: number;
  mesh: Mesh;
  material: MeshStandardMaterial;
  marker: Mesh;
  markerY: number;
  /** This object's instances in its chunk's furniture `InstancedMesh`es (model loaded). */
  slots?: InstanceSlots;
  /** Individual clone shown instead of the instances while x-rayed. */
  xray?: Object3D;
}

type ModelFn = (contentId: string, height: number) => Object3D | undefined;

/** Opacity of furniture while its contents are shown (shelf fill x-ray, loot panel open). */
const XRAY_OPACITY = 0.3;

/**
 * PLACEHOLDER map objects (chunk `objects`: storage and furniture) as grey boxes. Storage in
 * reach that this player has not searched yet gets a floating marker; searched storage is darker.
 */
export class MapObjects {
  readonly root = new Group();
  private readonly objects: Obj[] = [];
  private lastNearby: readonly NearbyContainerView[] | undefined;
  private readonly searched = new Set<string>();

  /** Box geometry per size, shared by every object of that size (streaming-friendly). */
  private readonly boxes = new Map<string, BoxGeometry>();
  private model: ModelFn | undefined;
  /** Model parts per `contentId|height` (one clone each, geometry / materials shared). */
  private readonly parts = new Map<string, ModelPart[] | undefined>();
  /** Furniture instanced meshes of every loaded chunk (rebuilt when chunks come and go). */
  private instances: InstancedMesh[] = [];
  private instancesDirty = false;

  /** Without a range, chunks come one by one via `loadChunk` (streaming). */
  constructor(source?: ChunkSource, range?: ChunkRange) {
    if (!source || !range) return;
    for (let cy = range.cy0; cy <= range.cy1; cy++) {
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        const chunk = source.getChunk(cx, cy, range.z);
        if (chunk) this.loadChunk(chunk);
      }
    }
  }

  /** Adds a chunk's objects (replacing that chunk's previous ones). */
  loadChunk(chunk: ChunkData): void {
    const { cx, cy, z } = chunk.coord;
    this.unloadChunk(cx, cy, z);
    for (const o of chunk.objects ?? []) {
      const [w, h, d] = SIZES[o.contentId] ?? DEFAULT_SIZE;
      const material = new MeshStandardMaterial({ color: 0x8c9196, roughness: 0.8 });
      const mesh = new Mesh(this.box(w, h, d), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const tx = cx * CHUNK_SIZE + o.x;
      const ty = cy * CHUNK_SIZE + o.y;
      const p = simToWorld(tx + 0.5, ty + 0.5, z);
      mesh.position.set(p.x, p.y + h / 2, p.z);
      mesh.rotation.y = (-o.rot * Math.PI) / 2;
      const marker = new Mesh(MARKER_GEOMETRY, MARKER_MATERIAL);
      const markerY = p.y + h + 0.45;
      marker.position.set(p.x, markerY, p.z);
      marker.visible = false;
      this.root.add(mesh, marker);
      const obj: Obj = {
        chunk: `${cx},${cy},${z}`,
        contentId: o.contentId,
        height: h,
        tx,
        ty,
        z,
        mesh,
        material,
        marker,
        markerY,
      };
      this.objects.push(obj);
    }
    this.instancesDirty = true;
    // Markers / searched shades for the new objects on the next update.
    this.lastNearby = undefined;
  }

  /** Removes a chunk's objects; per-object materials go, shared geometry and models stay. */
  unloadChunk(cx: number, cy: number, z: number): void {
    const key = `${cx},${cy},${z}`;
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]!;
      if (o.chunk !== key) continue;
      this.setXray(o.tx, o.ty, o.z, false);
      this.root.remove(o.mesh, o.marker);
      o.material.dispose();
      this.objects.splice(i, 1);
    }
    this.instancesDirty = true;
  }

  private box(w: number, h: number, d: number): BoxGeometry {
    const key = `${w}|${h}|${d}`;
    let g = this.boxes.get(key);
    if (!g) this.boxes.set(key, (g = new BoxGeometry(w, h, d)));
    return g;
  }

  private partsOf(contentId: string, height: number): ModelPart[] | undefined {
    const key = `${contentId}|${height}`;
    if (!this.parts.has(key)) {
      const m = this.model?.(contentId, height);
      this.parts.set(key, m ? modelParts(m) : undefined);
    }
    return this.parts.get(key);
  }

  /**
   * (Re)builds the furniture as one `InstancedMesh` per model part (geometry + material) over
   * all loaded chunks: no visual change against a clone per object, a handful of draw calls
   * instead of one per part per object. Streaming leaves only a few objects per chunk, so
   * per-chunk instancing barely helps; a rebuild is O(loaded objects) and runs at most once per
   * frame (`update`). Grey boxes stay for objects without a model.
   */
  private rebuildInstances(): void {
    this.instancesDirty = false;
    disposeInstances(this.instances, this.root);
    this.instances = [];
    if (!this.model) return;
    const { meshes, slots } = buildInstances(
      this.objects.map((o) => ({
        model: `${o.contentId}|${o.height}`,
        x: o.mesh.position.x,
        y: o.mesh.position.y - o.height / 2,
        z: o.mesh.position.z,
        rotY: o.mesh.rotation.y,
      })),
      (k) => {
        const i = k.lastIndexOf('|');
        return this.partsOf(k.slice(0, i), Number(k.slice(i + 1)));
      },
      this.root,
    );
    this.objects.forEach((o, i) => {
      const sl = slots[i];
      if (sl) {
        o.slots = sl;
        o.mesh.visible = false;
        if (o.xray) setSlotsVisible(sl, false);
      }
    });
    this.instances = meshes;
  }

  /** Swaps the grey boxes for models where `model(contentId, height)` has one (also later chunks). */
  applyModels(model: ModelFn): void {
    this.model = model;
    this.parts.clear();
    this.rebuildInstances();
  }

  /** Furniture `InstancedMesh`es currently in the scene (tests, perf). */
  get instancedMeshCount(): number {
    if (this.instancesDirty) this.rebuildInstances();
    return this.instances.length;
  }

  /**
   * See-through furniture at a tile (open loot panel shows the shelf props inside). Materials are
   * cloned per object on the way in, so other copies of the model stay opaque.
   */
  setXray(tx: number, ty: number, z: number, on: boolean): void {
    const o = this.objects.find((ob) => ob.tx === tx && ob.ty === ty && ob.z === z);
    if (!o) return;
    // Instanced furniture: an individual clone stands in while see-through.
    if (o.slots && on && !o.xray) {
      const clone = this.model?.(o.contentId, o.height);
      if (clone) {
        clone.position.set(o.mesh.position.x, o.mesh.position.y - o.height / 2, o.mesh.position.z);
        clone.rotation.y = o.mesh.rotation.y;
        this.root.add(clone);
        o.xray = clone;
        setSlotsVisible(o.slots, false);
      }
    }
    const target = o.xray ?? (o.slots ? undefined : o.mesh);
    target?.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const data = node.userData as { opaqueMaterial?: Material | Material[] };
      if (on) {
        data.opaqueMaterial ??= node.material as Material | Material[];
        const see = (m: Material): Material => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = XRAY_OPACITY;
          c.depthWrite = false;
          return c;
        };
        const src = data.opaqueMaterial;
        node.material = Array.isArray(src) ? src.map(see) : see(src);
      } else if (data.opaqueMaterial) {
        const cur = node.material as Material | Material[];
        for (const m of Array.isArray(cur) ? cur : [cur]) m.dispose();
        node.material = data.opaqueMaterial;
        delete data.opaqueMaterial;
      }
    });
    if (!on && o.xray) {
      this.root.remove(o.xray);
      delete o.xray;
      if (o.slots) setSlotsVisible(o.slots, true);
    }
  }

  get count(): number {
    return this.objects.length;
  }

  update(nearby: readonly NearbyContainerView[], nowMs: number): void {
    if (this.instancesDirty) this.rebuildInstances();
    if (nearby !== this.lastNearby) {
      this.lastNearby = nearby;
      const unsearched = new Set<string>();
      for (const n of nearby) {
        if (n.kind !== 'world') continue;
        const key = `${n.x},${n.y},${n.z}`;
        if (n.searched) this.searched.add(key);
        else unsearched.add(key);
      }
      for (const o of this.objects) {
        const key = `${o.tx},${o.ty},${o.z}`;
        o.marker.visible = unsearched.has(key);
        o.material.color.setHex(this.searched.has(key) ? 0x5d6266 : 0x8c9196);
      }
    }
    for (const o of this.objects) {
      if (o.marker.visible) animateMarker(o.marker, o.markerY, true, nowMs);
    }
  }
}
