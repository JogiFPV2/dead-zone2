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
  Vector3,
} from 'three';
import type { FurnitureMoveView, NearbyContainerView } from '@deadzone/protocol';
import { simToWorld } from '../sim/coords.js';
import { LEVEL_HEIGHT } from './instances.js';
import type { ChunkData, ChunkRange, ChunkSource } from './chunk.js';
import { CHUNK_SIZE, NO_BUILDING, type BuildingId } from './chunk.js';
import { NO_CUTAWAY, isLevelHidden, type Cutaway } from './cutaway.js';
import { MarkerBatch, animateMarker } from './ground-piles.js';
import { makeHighlight, pulseHighlight } from './furniture-highlight.js';
import {
  FURNITURE_SETTLE_MS,
  FURNITURE_TWEEN_MS,
  FurnitureMoves,
  carriedPose,
  easeMove,
  poseAfter,
  poseBefore,
  turnTo,
  unpackObjectId,
  type FurnitureMovedEvent,
  type FurniturePose,
  type FurnitureShift,
} from './furniture-moves.js';
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
  surfaceLift,
  surfaceSpread,
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
  // PLACEHOLDER until a TV model: a small CRT on its stand (#272), not a 0.8 m cube over the VCR.
  'base:tv': [0.55, 0.45, 0.45],
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
  /** Height above the floor: the top of the furniture below for `onSurface` pieces, else 0. */
  lift: number;
  /** Sideways offset (m, along its wall) among `onSurface` pieces sharing a worktop tile. */
  spread: number;
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
  /** Sliding / turning after `furnitureMoved`: own copy drawn instead of the instances. */
  moving?: MoveTween;
  /** Tiles taken after `rot` as the sim sent them (`furnitureMoved` `w` × `h`). */
  span?: { w: number; h: number };
}

/** A piece on its way (`furnitureMoved`): from the old base pose to the laid-out new one. */
interface MoveTween {
  view: Object3D;
  from: Vector3;
  fromYaw: number;
  /** First `update` time (ms); NaN until then (event and frame clocks differ). */
  start: number;
  /** Length (ms) of a slide. */
  ms: number;
  /** Action preview: progress `k` comes from the action, towards `to` (not the layout). */
  preview?: boolean;
  k?: number;
  to?: { pos: Vector3; yaw: number };
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
/** Minimum interval between streaming-driven furniture instance rebuilds (ms). */
const REBUILD_EVERY_MS = 750;

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
  /** Rebuild on the next update regardless of the throttle (floating origin moved). */
  private instancesUrgent = false;
  private lastRebuildMs = -Infinity;
  private cutaway: Cutaway = NO_CUTAWAY;
  private cutKey = '-';
  /** Every visible marker in one draw call. */
  private readonly markerBatch = new MarkerBatch(this.root, 'map-object-markers');
  /** Furniture footprints (`worldSettings.furniture.footprint`); off = one tile each, as before. */
  private footprints: FurnitureFootprints = FOOTPRINTS_OFF;
  /** Kinds drawn by another layer (realistic style: dumpsters under bin shelters); markers stay. */
  private hiddenKinds: ReadonlySet<string> = new Set();
  /** Fitted model tops per model key (fallback surface height when content has none). */
  private readonly tops = new Map<string, number>();
  /** Furniture moved by the sim, over the map data of every chunk loaded later. */
  readonly moves = new FurnitureMoves();
  /** Loaded chunks by `cx,cy,z` (a moved piece may land in another loaded chunk). */
  private readonly loaded = new Map<string, ChunkData>();
  private highlightKey = '';
  private highlightObj: Obj | undefined;
  /** Piece lit for the F key (`setHighlight`) and its view. */
  private highlighted: { obj: Obj; view: Object3D; pose: string } | undefined;

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
    this.loaded.set(`${cx},${cy},${z}`, chunk);
    // Furniture moved by the sim (`furnitureMoved`): the map data still has the old place.
    const kept = (chunk.objects ?? []).filter((o) =>
      this.moves.keepsMapPlace(o.contentId, cx * CHUNK_SIZE + o.x, cy * CHUNK_SIZE + o.y, z),
    );
    const moved = this.moves.movedInto(cx, cy, z).map((p) => ({
      contentId: p.contentId,
      x: p.tx - cx * CHUNK_SIZE,
      y: p.ty - cy * CHUNK_SIZE,
      rot: p.rot,
      ...(p.w !== undefined && p.h !== undefined ? { span: { w: p.w, h: p.h } } : {}),
    }));
    for (const o of [...kept, ...moved]) {
      this.addObject(chunk, o);
    }
    this.relift(`${cx},${cy},${z}`);
    this.instancesDirty = true;
    // The F highlight looks its piece up again (it may have just come in).
    this.highlightKey = '-';
    // Markers / searched shades for the new objects on the next update.
    this.lastNearby = undefined;
  }

  /** One map object of a loaded chunk (`x`, `y` chunk-local). */
  private addObject(
    chunk: ChunkData,
    o: { contentId: string; x: number; y: number; rot: number; span?: { w: number; h: number } },
  ): Obj {
    const { cx, cy, z } = chunk.coord;
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
      lift: 0,
      spread: 0,
      building: buildingAt(chunk, o.x, o.y),
      hidden: false,
      ...(o.span ? { span: o.span } : {}),
    };
    this.layout(obj);
    this.root.add(mesh, marker);
    this.objects.push(obj);
    this.applyCutaway(obj);
    // Drawn by the next (throttled) instance rebuild, not as a lone mesh meanwhile.
    if (this.model) mesh.visible = false;
    return obj;
  }

  /**
   * Sim moved a piece (`furnitureMoved`, protocol 37 / 38) with the things on its top
   * (`carried`): the same objects take the new anchors and `rot` (`w` × `h` from the sim) and
   * slide / turn there together, no jump, no second model; from where the action preview has
   * them, else from the old place (`FURNITURE_TWEEN_MS`). The overlay keeps them there when a
   * chunk is rebuilt or streamed in again. Idempotent with `setFurnitureMoves` (either first).
   */
  moveFurniture(e: FurnitureMovedEvent): void {
    const before = poseBefore(e);
    const after = poseAfter(e);
    const piece = this.findAt(before) ?? this.findAt(after);
    // Things on the top: by their ids (anchor tile + index on it), before or after the move.
    const used = new Set<Obj>(piece ? [piece] : []);
    const carried: FurnitureShift[] = [];
    for (const c of e.carried ?? []) {
      const a = unpackObjectId(c.fromId);
      const b = unpackObjectId(c.toId);
      const turn = e.cause === 'rotate' ? 1 : 0;
      const o = this.byId(a, used) ?? this.byId(b, used);
      if (!o) continue;
      used.add(o);
      const rotNow = o.tx === a.x && o.ty === a.y ? o.rot : (o.rot - turn) & 3;
      carried.push({
        from: { contentId: o.contentId, tx: a.x, ty: a.y, z: a.z, rot: rotNow & 3 },
        to: { contentId: o.contentId, tx: b.x, ty: b.y, z: b.z, rot: (rotNow + turn) & 3 },
      });
    }
    for (const sh of [{ from: before, to: after }, ...carried]) {
      this.moves.move(sh.from, sh.to);
      this.shift(sh, true);
    }
    // Lift / spread of things on tops (#272) on the new tiles.
    this.relift();
  }

  /**
   * The sim's full list of moved objects (`SimViewPatch.furnitureMoves`, protocol 38): after a
   * load every moved piece and thing on a top stands on its place at once (no slide). The same
   * list again changes nothing; a running slide keeps going to the place.
   */
  setFurnitureMoves(list: readonly FurnitureMoveView[]): void {
    const shifts = this.moves.setAll(list);
    for (const sh of shifts) this.shift(sh, false);
    if (shifts.length) this.relift();
  }

  /**
   * Action preview (`ActionView.furniture`, protocol 38): while `moveFurniture` runs the piece
   * `furnitureId` and the things on its top go towards their place after the move at progress
   * `k` 0..1 (push / pull one tile along `dir`, rotate 90° clockwise about the north-west tile,
   * like the sim). Undefined = no action: a preview left without its `furnitureMoved`
   * (interrupted) settles back.
   */
  previewFurnitureMove(
    a:
      | { furnitureId: number; mode: 'push' | 'pull' | 'rotate'; dirX: number; dirY: number }
      | undefined,
    k: number,
  ): void {
    const key = a ? `${a.furnitureId}|${a.mode}|${a.dirX},${a.dirY}` : '';
    if (key !== this.previewKey) {
      for (const o of this.previewed) {
        if (o.moving?.preview) this.retarget(o, FURNITURE_SETTLE_MS);
      }
      this.previewed = [];
      this.previewKey = key;
      if (a) {
        const at = unpackObjectId(a.furnitureId);
        const piece = this.byId(at, new Set());
        if (piece) {
          const span = this.spanOf(piece);
          const rect = { tx: piece.tx, ty: piece.ty, w: span.w, h: span.h };
          const move = a.mode === 'rotate' ? ('rotate' as const) : { dx: a.dirX, dy: a.dirY };
          const pose = this.poseOf(piece);
          const target: FurniturePose =
            move === 'rotate'
              ? { ...pose, rot: (pose.rot + 1) & 3, w: span.h, h: span.w }
              : { ...pose, tx: pose.tx + move.dx, ty: pose.ty + move.dy, w: span.w, h: span.h };
          this.startPreview(piece, target);
          for (const o of this.onTop(piece, rect)) {
            const p = this.poseOf(o);
            this.startPreview(o, carriedPose(rect, p, move));
          }
        }
      }
    }
    for (const o of this.previewed) if (o.moving?.preview) o.moving.k = k;
  }

  private previewKey = '';
  private previewed: Obj[] = [];

  /** Objects anchored on the piece's tiles that stand on a top (`placeable.onSurface`). */
  private onTop(piece: Obj, r: { tx: number; ty: number; w: number; h: number }): Obj[] {
    const fps = this.footprints;
    if (!fps.onSurface) return [];
    return this.objects.filter(
      (o) =>
        o !== piece &&
        o.z === piece.z &&
        o.tx >= r.tx &&
        o.tx < r.tx + r.w &&
        o.ty >= r.ty &&
        o.ty < r.ty + r.h &&
        fps.onSurface?.(o.contentId) === true,
    );
  }

  private poseOf(o: Obj): FurniturePose {
    return { contentId: o.contentId, tx: o.tx, ty: o.ty, z: o.z, rot: o.rot };
  }

  /** Tiles an object takes after its `rot`. */
  private spanOf(o: Obj): { w: number; h: number } {
    if (o.span) return o.span;
    const fp = this.fpOf(o);
    if (!fp) return { w: 1, h: 1 };
    return o.rot & 1 ? { w: fp.h, h: fp.w } : { w: fp.w, h: fp.h };
  }

  private findAt(p: FurniturePose): Obj | undefined {
    return this.objects.find(
      (o) => o.contentId === p.contentId && o.tx === p.tx && o.ty === p.ty && o.z === p.z,
    );
  }

  /** Object of a sim id: the `n`-th anchored on its tile (sim order), else the first free one. */
  private byId(
    t: { x: number; y: number; z: number; n: number },
    used: ReadonlySet<Obj>,
  ): Obj | undefined {
    const on = this.objects.filter((o) => o.tx === t.x && o.ty === t.y && o.z === t.z);
    const nth = on[t.n];
    if (nth && !used.has(nth)) return nth;
    return on.find((o) => !used.has(o));
  }

  /** World base pose (floor point under the model, yaw) of `o` laid out at `p`. */
  private worldPose(o: Obj, p: FurniturePose): { pos: Vector3; yaw: number } {
    const keep = { tx: o.tx, ty: o.ty, rot: o.rot, span: o.span };
    o.tx = p.tx;
    o.ty = p.ty;
    o.rot = p.rot;
    if (p.w !== undefined && p.h !== undefined) o.span = { w: p.w, h: p.h };
    else delete o.span;
    this.layout(o);
    const pos = o.mesh.position.clone();
    pos.y -= o.height / 2;
    const yaw = o.mesh.rotation.y;
    o.tx = keep.tx;
    o.ty = keep.ty;
    o.rot = keep.rot;
    if (keep.span) o.span = keep.span;
    else delete o.span;
    this.layout(o);
    return { pos, yaw };
  }

  /**
   * Puts the object drawn at `from` on `to` (found at either; added / removed when its chunk
   * comes into / out of the drawn area). `tween`: slides there; else a slide or preview already
   * running keeps going towards the new place.
   */
  private shift(sh: FurnitureShift, tween: boolean): void {
    const { from, to } = sh;
    const o = this.findAt(from) ?? this.findAt(to);
    const toChunk = `${Math.floor(to.tx / CHUNK_SIZE)},${Math.floor(to.ty / CHUNK_SIZE)},${to.z}`;
    const target = this.loaded.get(toChunk);
    if (!o) {
      if (target) this.placeMoved(target, to);
      return;
    }
    if (!target) {
      this.removeObject(o);
      return;
    }
    // Start of the slide: where it is drawn now (preview / slide), else its pose before.
    const start = o.moving
      ? { pos: o.moving.view.position.clone(), yaw: o.moving.view.rotation.y }
      : this.worldPose(o, from);
    this.setXray(o.tx, o.ty, o.z, false);
    o.tx = to.tx;
    o.ty = to.ty;
    o.rot = to.rot;
    if (to.w !== undefined && to.h !== undefined) o.span = { w: to.w, h: to.h };
    else delete o.span;
    o.chunk = toChunk;
    this.layout(o);
    if (o.moving) {
      // Preview → settle on the place from where it is drawn; a slide keeps its pace.
      if (o.moving.preview) this.retarget(o, FURNITURE_SETTLE_MS);
    } else if (tween) this.startTween(o, start.pos, start.yaw, FURNITURE_TWEEN_MS);
    this.instancesDirty = true;
    this.lastNearby = undefined;
  }

  private placeMoved(chunk: ChunkData, p: FurniturePose): void {
    const { cx, cy } = chunk.coord;
    this.addObject(chunk, {
      contentId: p.contentId,
      x: p.tx - cx * CHUNK_SIZE,
      y: p.ty - cy * CHUNK_SIZE,
      rot: p.rot,
      ...(p.w !== undefined && p.h !== undefined ? { span: { w: p.w, h: p.h } } : {}),
    });
    this.instancesDirty = true;
    this.lastNearby = undefined;
  }

  private startTween(o: Obj, from: Vector3, fromYaw: number, ms: number): MoveTween {
    this.endTween(o);
    const view = this.fittedModel(o.contentId, o.height, this.fpOf(o)) ?? boxClone(o.mesh);
    view.position.copy(from);
    view.rotation.y = fromYaw;
    this.root.add(view);
    const m: MoveTween = { view, from, fromYaw, start: Number.NaN, ms };
    o.moving = m;
    if (o.slots) setSlotsVisible(o.slots, false);
    o.mesh.visible = false;
    view.visible = !o.hidden;
    return m;
  }

  /** Action preview of `o` towards pose `p` (progress set by `previewFurnitureMove`). */
  private startPreview(o: Obj, p: FurniturePose): void {
    const from = o.moving
      ? { pos: o.moving.view.position.clone(), yaw: o.moving.view.rotation.y }
      : this.worldPose(o, this.poseOf(o));
    const to = this.worldPose(o, p);
    const m = this.startTween(o, from.pos, from.yaw, 1);
    m.preview = true;
    m.k = 0;
    m.to = to;
    this.previewed.push(o);
  }

  /** From where `o` is drawn now onto its laid-out place in `ms`. */
  private retarget(o: Obj, ms: number): void {
    const m = o.moving;
    if (!m) return;
    m.from = m.view.position.clone();
    m.fromYaw = m.view.rotation.y;
    m.start = Number.NaN;
    m.ms = ms;
    delete m.preview;
    delete m.k;
    delete m.to;
  }

  private endTween(o: Obj): void {
    const m = o.moving;
    if (!m) return;
    this.root.remove(m.view);
    delete o.moving;
    o.marker.position.x = o.mesh.position.x;
    o.marker.position.z = o.mesh.position.z;
    if (o.slots && !o.xray) setSlotsVisible(o.slots, !o.hidden);
    else if (!o.slots) o.mesh.visible = !o.hidden;
  }

  /** Steps the slides and previews; a slide ends on the laid-out pose. */
  private stepTweens(nowMs: number): void {
    for (const o of this.objects) {
      const m = o.moving;
      if (!m) continue;
      let k: number;
      let to: { pos: Vector3; yaw: number };
      if (m.preview) {
        k = m.k ?? 0;
        to = m.to!;
      } else {
        if (Number.isNaN(m.start)) m.start = nowMs;
        k = (nowMs - m.start) / m.ms;
        if (k >= 1 || nowMs < m.start) {
          this.endTween(o);
          continue;
        }
        const p = o.mesh.position;
        this._to.set(p.x, p.y - o.height / 2, p.z);
        to = { pos: this._to, yaw: o.mesh.rotation.y };
      }
      const e = easeMove(k);
      m.view.position.lerpVectors(m.from, to.pos, e);
      m.view.rotation.y = turnTo(m.fromYaw, to.yaw, k);
      // The loot marker rides along (its height bob stays `animateMarker`'s).
      o.marker.position.x = m.view.position.x;
      o.marker.position.z = m.view.position.z;
    }
  }
  private readonly _to = new Vector3();

  /** Objects sliding or previewed right now (tests). */
  get movingCount(): number {
    return this.objects.filter((o) => o.moving).length;
  }

  /** Drawn base position (world) of the object at a tile, its slide copy while moving (tests). */
  drawnAt(tx: number, ty: number, z: number): Vector3 | undefined {
    const o = this.objects.find((ob) => ob.tx === tx && ob.ty === ty && ob.z === z);
    if (!o) return undefined;
    if (o.moving) return o.moving.view.position.clone();
    const p = o.mesh.position.clone();
    p.y -= o.height / 2;
    return p;
  }

  private removeObject(o: Obj): void {
    this.endTween(o);
    this.setXray(o.tx, o.ty, o.z, false);
    this.root.remove(o.mesh, o.marker);
    o.material.dispose();
    const i = this.objects.indexOf(o);
    if (i >= 0) this.objects.splice(i, 1);
    this.instancesDirty = true;
  }

  /** Removes a chunk's objects; per-object materials go, shared geometry and models stay. */
  unloadChunk(cx: number, cy: number, z: number): void {
    const key = `${cx},${cy},${z}`;
    this.loaded.delete(key);
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i]!;
      if (o.chunk !== key) continue;
      this.endTween(o);
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
    // A moved piece: centre of the tiles the sim says it takes (same as its footprint).
    const c =
      fp && o.span
        ? { x: o.tx + o.span.w / 2, y: o.ty + o.span.h / 2 }
        : fp
          ? footprintCenter(o.tx, o.ty, o.rot, fp)
          : { x: o.tx + 0.5, y: o.ty + 0.5 };
    const raised = RAISED[o.contentId];
    const [bx, by] = BACK[o.rot & 3]!;
    const back = raised?.back ?? 0;
    // Along the wall (model +x after the `rot` turn) = back direction turned 90°.
    const p = simToWorld(c.x + bx * back - by * o.spread, c.y + by * back + bx * o.spread, o.z);
    // Stacked on a piece below (`o.lift`): its top replaces the fixed desk-lamp lift.
    if (o.lift === 0) p.y += raised?.lift ?? 0;
    o.mesh.geometry = this.box(w, h, d);
    const y = p.y + o.lift;
    o.mesh.position.set(p.x, y + h / 2, p.z);
    o.mesh.rotation.y = (-o.rot * Math.PI) / 2;
    o.markerY = y + h + 0.45;
    o.marker.position.set(p.x, o.markerY, p.z);
  }

  /**
   * Lifts `onSurface` pieces (VCR on a TV stand, lamp on a desk) to the top of the furniture
   * below: content `surfaceHeightM`, else the lower model's fitted bounding-box top. `chunk`
   * limits it to one chunk's objects (the piece below shares the tile, so the chunk).
   */
  private relift(chunk?: string): void {
    for (const o of this.objects) {
      if (chunk !== undefined && o.chunk !== chunk) continue;
      const lift = surfaceLift(this.objects, this.footprints, o, (b) => this.modelTop(b));
      const spread = surfaceSpread(this.objects, this.footprints, o);
      if (lift === o.lift && spread === o.spread) continue;
      o.lift = lift;
      o.spread = spread;
      this.layout(o);
      this.instancesDirty = true;
    }
  }

  /** Top of an object's fitted model (m above its base), or its grey box height without one. */
  private modelTop(o: Obj): number {
    const key = this.modelKey(o);
    let top = this.tops.get(key);
    if (top === undefined) {
      const m = this.fittedModel(o.contentId, o.height, this.fpOf(o));
      top = m ? new Box3().setFromObject(m).max.y : this.boxSize(o)[1];
      if (!Number.isFinite(top)) top = this.boxSize(o)[1];
      if (m) this.tops.set(key, top);
    }
    return top;
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
    this.tops.clear();
    for (const o of this.objects) this.layout(o);
    this.relift();
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

  /**
   * One instanced copy of every model in `ids` under `root` (shader warm-up: compile their
   * programs before the first such furniture streams in). `dispose()` the result afterwards.
   */
  prewarm(ids: readonly string[], root: Group): { dispose(): void } {
    const placements = ids
      .filter((id) => this.partsOf(`${id}|1`))
      .map((id) => ({ model: id, x: 0, y: -50, z: 0, rotY: 0 }));
    const { meshes } = buildInstances(placements, (id) => this.partsOf(`${id}|1`), root);
    return { dispose: () => disposeInstances(meshes, root) };
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
    this.instancesUrgent = false;
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
        if (o.xray || o.moving) setSlotsVisible(sl, false);
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
    this.instancesUrgent = true;
  }

  /**
   * Same cutaway as the buildings: furniture on floors above the player's, in the player's
   * building, is hidden with those floors (no beds floating over a cut-away storey).
   */
  setCutaway(c: Cutaway): void {
    const key = `${c.building}:${c.z ?? 0}:${[...(c.occluders ?? [])].sort((a, b) => a - b).join(',')}`;
    if (key === this.cutKey) return;
    this.cutKey = key;
    this.cutaway = c;
    for (const o of this.objects) this.applyCutaway(o);
  }

  /** Content ids whose own mesh is not drawn (another layer draws them); markers stay. */
  setHiddenKinds(ids: readonly string[]): void {
    this.hiddenKinds = new Set(ids);
    for (const o of this.objects) this.applyCutaway(o);
    this.instancesDirty = true;
  }

  private applyCutaway(o: Obj): void {
    const c = this.cutaway;
    o.hidden = isLevelHidden(c, o.building, o.z);
    const drawn = !o.hidden && !this.hiddenKinds.has(o.contentId);
    if (o.moving) {
      if (o.slots) setSlotsVisible(o.slots, false);
      o.mesh.visible = false;
      o.moving.view.visible = drawn;
    } else if (o.slots) {
      if (!o.xray) setSlotsVisible(o.slots, drawn);
    } else o.mesh.visible = drawn;
    if (o.xray) o.xray.visible = !o.hidden;
    if (o.hidden) o.marker.visible = false;
  }

  /** Swaps the grey boxes for models where `model(contentId, height)` has one (also later chunks). */
  applyModels(model: ModelFn): void {
    this.model = model;
    this.parts.clear();
    this.tops.clear();
    this.relift();
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
      if (o.slots) setSlotsVisible(o.slots, !o.hidden && !this.hiddenKinds.has(o.contentId));
    }
  }

  /**
   * Lights up the piece the F key acts on (Paweł 25.11): the map object covering tile
   * (tx, ty, z) gets an outline and a warm tint (`furniture-highlight.ts`); undefined = none.
   * Cheap when the target stays the same (call it every frame).
   */
  setHighlight(t: { x: number; y: number; z: number } | undefined, nowMs: number): void {
    // Same tile as last frame: the same piece (objects only change with chunk loads / moves,
    // which the pose / membership check below catches on the next new target).
    const tk = t ? `${t.x},${t.y},${t.z}` : '';
    if (
      tk !== this.highlightKey ||
      (this.highlightObj !== undefined && !this.objects.includes(this.highlightObj))
    ) {
      this.highlightKey = tk;
      // The piece standing on the floor wins over a lamp / TV on its top (`lift`).
      this.highlightObj = t
        ? (objectAtTile(
            this.objects.filter((ob) => ob.lift === 0 && ob.z === t.z),
            this.footprints,
            t.x,
            t.y,
            t.z,
          ) ?? objectAtTile(this.objects, this.footprints, t.x, t.y, t.z))
        : undefined;
    }
    const o = this.highlightObj;
    const want = o && !o.hidden && !o.moving && !this.hiddenKinds.has(o.contentId) ? o : undefined;
    const cur = this.highlighted;
    const pose = want
      ? `${want.mesh.position.x},${want.mesh.position.y},${want.mesh.position.z},${want.mesh.rotation.y}`
      : '';
    if (cur && (cur.obj !== want || cur.pose !== pose)) {
      this.root.remove(cur.view);
      this.highlighted = undefined;
    }
    if (want && !this.highlighted) {
      const clone =
        this.fittedModel(want.contentId, want.height, this.fpOf(want)) ?? boxClone(want.mesh);
      clone.position.set(
        want.mesh.position.x,
        want.mesh.position.y - want.height / 2,
        want.mesh.position.z,
      );
      clone.rotation.y = want.mesh.rotation.y;
      const view = makeHighlight(clone);
      this.root.add(view);
      this.highlighted = { obj: want, view, pose };
    }
    if (this.highlighted) pulseHighlight(nowMs);
  }

  /** The highlighted piece's anchor tile (tests, dev). */
  get highlightedAt(): { tx: number; ty: number; z: number } | undefined {
    const o = this.highlighted?.obj;
    return o && { tx: o.tx, ty: o.ty, z: o.z };
  }

  get count(): number {
    return this.objects.length;
  }

  update(nearby: readonly NearbyContainerView[], nowMs: number): void {
    this.stepTweens(nowMs);
    // A rebuild is O(loaded objects) and re-uploads every batch: while chunks stream in, at most
    // one per REBUILD_EVERY_MS (the origin shift is immediate).
    if (
      this.instancesDirty &&
      (this.instancesUrgent ||
        nowMs - this.lastRebuildMs >= REBUILD_EVERY_MS ||
        nowMs < this.lastRebuildMs)
    ) {
      this.lastRebuildMs = nowMs;
      this.rebuildInstances();
    }
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
