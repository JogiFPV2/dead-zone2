import {
  Box3,
  BoxGeometry,
  Group,
  type InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  type Material,
  Matrix4,
  type Object3D,
} from 'three';
import type { NearbyContainerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';
import type { ChunkData, ChunkRange, ChunkSource } from './chunk.js';
import { CHUNK_SIZE, NO_BUILDING, type BuildingId } from './chunk.js';
import { NO_CUTAWAY, type Cutaway } from './cutaway.js';
import { MarkerBatch, animateMarker } from './ground-piles.js';
import {
  buildInstances,
  disposeInstances,
  mergeParts,
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
  // PLACEHOLDER until a pump model (vehicle UI mockup sprite only).
  'base:fuel-pump': [0.6, 1.7, 0.45],
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
  /** Instancing key while drawn as an instanced grey box (no model). */
  boxKey?: string;
  /** Individual clone shown instead of the instances while x-rayed. */
  xray?: Object3D;
  /** Building of the object's tile (NO_BUILDING outside). */
  building: BuildingId;
  /** Hidden by the cutaway (a floor above the player's in the player's building). */
  hidden: boolean;
}

type ModelFn = (contentId: string, height: number) => Object3D | undefined;

const BOX_COLOR = 0x8c9196;
const BOX_SEARCHED_COLOR = 0x5d6266;
/** Grey boxes are instanced too (one batch per size and shade), sharing these two materials. */
const BOX_MATERIAL = new MeshStandardMaterial({ color: BOX_COLOR, roughness: 0.8 });
const BOX_SEARCHED_MATERIAL = new MeshStandardMaterial({
  color: BOX_SEARCHED_COLOR,
  roughness: 0.8,
});

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
  private origin = { x: 0, z: 0 };
  private instancesDirty = false;
  private cutaway: Cutaway = NO_CUTAWAY;
  /** Every visible marker in one draw call. */
  private readonly markerBatch = new MarkerBatch(this.root, 'map-object-markers');

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
      const material = new MeshStandardMaterial({ color: BOX_COLOR, roughness: 0.8 });
      const mesh = new Mesh(this.box(w, h, d), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const tx = cx * CHUNK_SIZE + o.x;
      const ty = cy * CHUNK_SIZE + o.y;
      const p = simToWorld(tx + 0.5, ty + 0.5, z);
      mesh.position.set(p.x, p.y + h / 2, p.z);
      mesh.rotation.y = (-o.rot * Math.PI) / 2;
      // Pose holder only: the visible markers are drawn as one InstancedMesh (`markerBatch`).
      const marker = MarkerBatch.holder();
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
        building: buildingAt(chunk, o.x, o.y),
        hidden: false,
      };
      this.objects.push(obj);
      this.applyCutaway(obj);
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

  /** Instancing key of an object drawn as a grey box: size and searched shade. */
  private boxKey(o: Obj): string {
    const [w, h, d] = SIZES[o.contentId] ?? DEFAULT_SIZE;
    return `box|${w}|${h}|${d}|${this.searched.has(`${o.tx},${o.ty},${o.z}`) ? 1 : 0}`;
  }

  private boxParts(key: string): ModelPart[] {
    let parts = this.parts.get(key);
    if (!parts) {
      const [, w, h, d, searched] = key.split('|').map(Number);
      const geometry = this.box(w!, h!, d!);
      parts = [
        {
          geometry,
          material: searched ? BOX_SEARCHED_MATERIAL : BOX_MATERIAL,
          // Box centred at half height: the placement is the base.
          local: new Matrix4().makeTranslation(0, h! / 2, 0),
          castShadow: true,
          receiveShadow: true,
        },
      ];
      this.parts.set(key, parts);
    }
    return parts;
  }

  private partsOf(contentId: string, height: number): ModelPart[] | undefined {
    const key = `${contentId}|${height}`;
    if (!this.parts.has(key)) {
      const raw = this.model?.(contentId, height);
      const m = raw && fitTile(raw);
      this.parts.set(key, m ? mergeParts(modelParts(m)) : undefined);
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
    const keys = this.objects.map((o) =>
      this.model && this.partsOf(o.contentId, o.height)
        ? `${o.contentId}|${o.height}`
        : this.boxKey(o),
    );
    const { meshes, slots } = buildInstances(
      this.objects.map((o, i) => ({
        model: keys[i]!,
        x: o.mesh.position.x,
        y: o.mesh.position.y - o.height / 2,
        z: o.mesh.position.z,
        rotY: o.mesh.rotation.y,
      })),
      (k) => {
        if (k.startsWith('box|')) return this.boxParts(k);
        const i = k.lastIndexOf('|');
        return this.partsOf(k.slice(0, i), Number(k.slice(i + 1)));
      },
      this.root,
      this.origin,
    );
    this.objects.forEach((o, i) => {
      const sl = slots[i];
      const key = keys[i]!;
      if (key.startsWith('box|')) o.boxKey = key;
      else delete o.boxKey;
      if (sl) {
        o.slots = sl;
        o.mesh.visible = false;
        if (o.xray) setSlotsVisible(sl, false);
      }
      this.applyCutaway(o);
    });
    this.instances = meshes;
  }

  /**
   * Floating origin (`render/floating-origin.ts`): the instance batches are rebuilt relative to
   * the new render origin (world X / Z), at most once per frame in `update`.
   */
  setOrigin(x: number, z: number): void {
    if (x === this.origin.x && z === this.origin.z) return;
    this.origin = { x, z };
    this.instancesDirty = true;
  }

  /**
   * Same cutaway as the buildings: furniture on floors above the player's, in the player's
   * building, is hidden with those floors (no beds floating over a cut-away storey).
   */
  setCutaway(c: Cutaway): void {
    if (c.building === this.cutaway.building && (c.z ?? 0) === (this.cutaway.z ?? 0)) return;
    this.cutaway = c;
    for (const o of this.objects) this.applyCutaway(o);
  }

  private applyCutaway(o: Obj): void {
    const c = this.cutaway;
    o.hidden = c.building !== NO_BUILDING && o.building === c.building && o.z > (c.z ?? 0);
    if (o.slots) {
      if (!o.xray) setSlotsVisible(o.slots, !o.hidden);
    } else o.mesh.visible = !o.hidden;
    if (o.xray) o.xray.visible = !o.hidden;
    if (o.hidden) o.marker.visible = false;
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
      const raw = this.model?.(o.contentId, o.height);
      // A grey box stands in with its own mesh (own material) while see-through.
      const clone = raw ? fitTile(raw) : boxClone(o.mesh);
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
      if (o.slots) setSlotsVisible(o.slots, !o.hidden);
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
        o.marker.visible = !o.hidden && unsearched.has(key);
        o.material.color.setHex(this.searched.has(key) ? BOX_SEARCHED_COLOR : BOX_COLOR);
      }
      // Instanced grey boxes take the shade from their batch: rebuild when it changed.
      if (this.objects.some((o) => o.boxKey !== undefined && o.boxKey !== this.boxKey(o))) {
        this.rebuildInstances();
      }
    }
    const shown: Mesh[] = [];
    for (const o of this.objects) {
      if (!o.marker.visible) continue;
      animateMarker(o.marker, o.markerY, true, nowMs);
      shown.push(o.marker);
    }
    this.markerBatch.draw(shown);
  }
}

/** Own grey box (own material, for the x-ray) at an instanced box's place. */
function boxClone(mesh: Mesh): Object3D {
  const m = new Mesh(mesh.geometry, mesh.material);
  // setXray positions the clone at the base; the box is centred at half height.
  const h = (mesh.geometry as BoxGeometry).parameters.height;
  m.position.y = h / 2;
  const g = new Group();
  g.add(m);
  return g;
}

function buildingAt(chunk: ChunkData, x: number, y: number): BuildingId {
  const room = chunk.room?.[y * CHUNK_SIZE + x] ?? 0;
  return room === 0 ? NO_BUILDING : (chunk.rooms?.get(room)?.buildingId ?? NO_BUILDING);
}

/** Largest footprint side of a map object model: one tile minus a gap (walls stay closed). */
const MAX_FOOTPRINT = 0.96;

/**
 * Squeezes a model (scaled by height) into its one-tile footprint on X/Z, so a wide shelf in
 * a room corner does not poke through the next wall. Returns a wrapper (instancing reads the
 * parts relative to the root, so the squeeze sits one level down).
 */
function fitTile(m: Object3D): Object3D {
  const wrap = new Group();
  wrap.add(m);
  wrap.updateMatrixWorld(true);
  const box = new Box3().setFromObject(m);
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  const k = Math.min(1, MAX_FOOTPRINT / Math.max(w, d, 1e-6));
  if (k < 1) {
    m.scale.x *= k;
    m.scale.z *= k;
  }
  return wrap;
}
