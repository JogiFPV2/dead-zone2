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
import { LEVEL_HEIGHT } from './instances.js';
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
import { footprintCenter, type Footprint, type TileXY } from '@deadzone/content/footprint';
import {
  FOOTPRINTS_OFF,
  isRealScale,
  objectAtTile,
  objectTiles,
  type FurnitureFootprints,
} from './furniture-footprint.js';

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
  // #254: Kenney models fit to these heights (per tile; the table spans its 2×1 footprint).
  'base:table': [0.95, 0.76, 0.9],
  'base:chair': [0.5, 0.9, 0.5],
  'base:floor-lamp': [0.4, 1.6, 0.4],
  'base:desk-lamp': [0.25, 0.4, 0.25],
  'base:ceiling-lamp': [0.45, 0.35, 0.45],
  'base:light-switch': [0.08, 0.12, 0.03],
  'base:toilet': [0.45, 0.8, 0.7],
};

/**
 * Objects that do not stand on the floor (#254): lifted by `lift` m above it and pushed `back`
 * m toward the wall at their back (`rot`). A desk lamp stands on its desk (+0.75 m, like the
 * radio), a ceiling lamp hangs under the ceiling, a light switch sits on the wall at 1.1 m.
 */
const RAISED: Record<string, { lift: number; back?: number }> = {
  'base:desk-lamp': { lift: 0.75 },
  'base:ceiling-lamp': { lift: LEVEL_HEIGHT - 0.1 - 0.35 },
  'base:light-switch': { lift: 1.1, back: 0.47 },
};
/** Back direction (sim tiles) per `rot`: 0 = north wall, 1 = east, 2 = south, 3 = west. */
const BACK: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DEFAULT_SIZE: [number, number, number] = [0.8, 0.8, 0.8];

interface Obj {
  /** Chunk key `cx,cy,z`. */
  chunk: string;
  contentId: string;
  height: number;
  /** Rotation 0–3 (content `objects[].rot`). */
  rot: number;
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
  /** Furniture footprints (`worldSettings.furniture.footprint`); off = one tile each, as before. */
  private footprints: FurnitureFootprints = FOOTPRINTS_OFF;

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
      const h = (SIZES[o.contentId] ?? DEFAULT_SIZE)[1];
      const material = new MeshStandardMaterial({ color: BOX_COLOR, roughness: 0.8 });
      const mesh = new Mesh(undefined, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Pose holder only: the visible markers are drawn as one InstancedMesh (`markerBatch`).
      const marker = MarkerBatch.holder();
      marker.visible = false;
      const obj: Obj = {
        chunk: `${cx},${cy},${z}`,
        contentId: o.contentId,
        height: h,
        rot: o.rot,
        tx: cx * CHUNK_SIZE + o.x,
        ty: cy * CHUNK_SIZE + o.y,
        z,
        mesh,
        material,
        marker,
        markerY: 0,
        building: buildingAt(chunk, o.x, o.y),
        hidden: false,
      };
      this.layout(obj);
      this.root.add(mesh, marker);
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

  /**
   * Places an object's grey box and marker: on its tile centre (footprints off, as always), or
   * on the centre of its footprint with the box stretched over w×h (footprints on).
   */
  private layout(o: Obj): void {
    const [w, h, d] = this.boxSize(o);
    const fp = this.fpOf(o);
    const c = fp ? footprintCenter(o.tx, o.ty, o.rot, fp) : { x: o.tx + 0.5, y: o.ty + 0.5 };
    const raised = RAISED[o.contentId];
    const [bx, by] = BACK[o.rot & 3]!;
    const back = raised?.back ?? 0;
    const p = simToWorld(c.x + bx * back, c.y + by * back, o.z);
    p.y += raised?.lift ?? 0;
    o.mesh.geometry = this.box(w, h, d);
    o.mesh.position.set(p.x, p.y + h / 2, p.z);
    o.mesh.rotation.y = (-o.rot * Math.PI) / 2;
    o.markerY = p.y + h + 0.45;
    o.marker.position.set(p.x, o.markerY, p.z);
  }

  /** Footprint of an object while footprints are on (undefined = off: one tile, today's fit). */
  private fpOf(o: { contentId: string }): Footprint | undefined {
    return this.footprints.enabled ? this.footprints.of(o.contentId) : undefined;
  }

  /** Grey box size: `SIZES` (one tile), stretched over the footprint's w×h when on. */
  private boxSize(o: { contentId: string }): [number, number, number] {
    const [w, h, d] = SIZES[o.contentId] ?? DEFAULT_SIZE;
    const fp = this.fpOf(o);
    return fp ? [w * fp.w, h, d * fp.h] : [w, h, d];
  }

  /**
   * Switches furniture footprints (same flag as the sim, `worldSettings.furniture.footprint`):
   * re-lays every loaded object and refits the models. Off restores the one-tile layout.
   */
  setFootprints(f: FurnitureFootprints): void {
    if (f === this.footprints) return;
    this.footprints = f;
    for (const o of this.objects) this.layout(o);
    this.parts.clear();
    this.instancesDirty = true;
  }

  /** Whether footprints are on (render side of `worldSettings.furniture.footprint`). */
  get footprintsEnabled(): boolean {
    return this.footprints.enabled;
  }

  /**
   * Map object covering world tile (tx, ty) on level z, for hover highlight and RMB picking:
   * with footprints on every occupied tile finds the object, off only its own tile.
   */
  objectAt(
    tx: number,
    ty: number,
    z: number,
  ): { contentId: string; tx: number; ty: number; z: number; rot: number } | undefined {
    const o = objectAtTile(this.objects, this.footprints, tx, ty, z);
    return o && { contentId: o.contentId, tx: o.tx, ty: o.ty, z: o.z, rot: o.rot };
  }

  /** Tiles an object covers (highlight): all occupied tiles with footprints on, else its own. */
  tilesOf(o: { contentId: string; tx: number; ty: number; rot?: number }): TileXY[] {
    return objectTiles(this.footprints, o);
  }

  private box(w: number, h: number, d: number): BoxGeometry {
    const key = `${w}|${h}|${d}`;
    let g = this.boxes.get(key);
    if (!g) this.boxes.set(key, (g = new BoxGeometry(w, h, d)));
    return g;
  }

  /** Instancing key of an object drawn as a grey box: size and searched shade. */
  private boxKey(o: Obj): string {
    const [w, h, d] = this.boxSize(o);
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

  /** Model instancing key: `contentId|height`, plus the footprint while footprints are on. */
  private modelKey(o: Obj): string {
    const fp = this.fpOf(o);
    return fp ? `${o.contentId}|${o.height}|${fp.w}|${fp.h}` : `${o.contentId}|${o.height}`;
  }

  /** Fitted model of an object (`fitTile` off, `fitFootprint` on); undefined = no model. */
  private fittedModel(contentId: string, height: number, fp?: Footprint): Object3D | undefined {
    const raw = this.model?.(contentId, height);
    if (!raw) return undefined;
    const real = isRealScale(contentId);
    if (fp) return fitFootprint(raw, fp, real);
    return real ? fitTileRealScale(raw) : fitTile(raw);
  }

  private partsOf(key: string): ModelPart[] | undefined {
    if (!this.parts.has(key)) {
      const [contentId, height, w, h] = key.split('|');
      const fp = w !== undefined && h !== undefined ? { w: Number(w), h: Number(h) } : undefined;
      const m = this.fittedModel(contentId!, Number(height), fp);
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
    const keys = this.objects.map((o) => {
      const key = this.modelKey(o);
      return this.model && this.partsOf(key) ? key : this.boxKey(o);
    });
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
        return this.partsOf(k);
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
      // A grey box stands in with its own mesh (own material) while see-through.
      const clone = this.fittedModel(o.contentId, o.height, this.fpOf(o)) ?? boxClone(o.mesh);
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

/**
 * Fit with footprints on, in the footprint's own frame (model +x = `w` along the wall, +z = `h`
 * into the room; the instance rotation turns it). Real-scale models (`REAL_SCALE_FURNITURE`, 1 m
 * = 1 tile) keep their size and their authored origin (= footprint centre, back-to-wall offset
 * baked in, never re-centred) and only shrink (uniformly, about that origin) when larger than
 * w×h. Legacy
 * models get today's one-tile fit stretched over the rectangle (x · w, z · h).
 */
export function fitFootprint(m: Object3D, fp: Footprint, realScale: boolean): Object3D {
  if (!realScale) {
    const wrap = fitTile(m);
    m.scale.x *= fp.w;
    m.scale.z *= fp.h;
    return wrap;
  }
  // wrap (root, ignored by instancing) > shrink (about the authored origin) > model.
  const wrap = new Group();
  const shrink = new Group();
  shrink.add(m);
  wrap.add(shrink);
  wrap.updateMatrixWorld(true);
  const box = new Box3().setFromObject(m);
  const w = box.max.x - box.min.x;
  const d = box.max.z - box.min.z;
  const k = Math.min(1, fp.w / Math.max(w, 1e-6), fp.h / Math.max(d, 1e-6));
  if (k < 1) shrink.scale.setScalar(k);
  return wrap;
}

/**
 * One-tile fit of a real-scale model with footprints off (today's maps: every object one tile):
 * each axis is squeezed on its own to `MAX_FOOTPRINT` about the authored origin (never
 * re-centred, height kept), so a 2×1 sofa keeps its depth and its back stays at the wall, and a
 * bed 2 m long ends up one tile long without poking through the next wall.
 */
export function fitTileRealScale(m: Object3D): Object3D {
  const wrap = new Group();
  const squeeze = new Group();
  squeeze.add(m);
  wrap.add(squeeze);
  wrap.updateMatrixWorld(true);
  const box = new Box3().setFromObject(m);
  const reach = (lo: number, hi: number) => 2 * Math.max(-lo, hi, 1e-6);
  // Measured from the origin both ways (the model stays anchored there), so the far side fits.
  squeeze.scale.x = Math.min(1, MAX_FOOTPRINT / reach(box.min.x, box.max.x));
  squeeze.scale.z = Math.min(1, MAX_FOOTPRINT / reach(box.min.z, box.max.z));
  return wrap;
}
