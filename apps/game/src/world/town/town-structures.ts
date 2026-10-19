import { isLightNight } from '../lit-windows.js';
import {
  BatchedMesh,
  Color,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { BuildingLookup } from '../building-lookup.js';
import {
  CHUNK_SIZE,
  NO_BUILDING,
  type BuildingId,
  type ChunkRange,
  type ChunkSource,
} from '../chunk.js';
import {
  CUT_NEAR,
  NO_CUTAWAY,
  cutawayKey,
  isLevelHidden,
  isEdgeLowered,
  isRoofHidden,
  type Cutaway,
} from '../cutaway.js';
import { VectorWalls } from './vector-walls.js';
import type { SimWallSegment } from '@deadzone/protocol';
import { LEVEL_HEIGHT } from '../instances.js';
import { WALL_HEIGHT } from '../structure-instances.js';
import type { TownKit } from './kit.js';
import { layoutTown, type TownEdge, type TownLayout } from './layout.js';
import {
  WALL_CELL,
  edgeModule,
  edgeVariants,
  roofColour,
  windowLit,
  type Skin,
} from './modules.js';
import { blokFacade, type BlokInfo } from './blok-facade.js';
import { outlineRoof, pitchedRoof } from './roof.js';
import { railingGeometry, slabGeometry, stairsGeometry } from './levels.js';
import { MapTiles } from './tiles.js';

export interface TownStructuresOptions {
  /** Shared building lookup (streamed chunks: one over the loaded chunks). */
  lookup?: BuildingLookup | undefined;
  /**
   * Streamed worlds: whole footprint of a rectangular building (pitched roof over chunk
   * borders), undefined = flat roof. Without it the range's own roof footprint decides.
   */
  footprintOf?:
    ((b: BuildingId) => { x0: number; z0: number; x1: number; z1: number } | undefined) | undefined;
  /**
   * Shared batch per chunk key (`cx,cy`): streamed worlds put every level of a chunk column into
   * one BatchedMesh (one draw call + one shadow per column instead of per level). The owner adds
   * the mesh to the scene and disposes it; levels add / remove their own instances.
   */
  sharedBatch?: ((chunk: string) => SharedTownBatch) | undefined;
  /**
   * Streamed worlds: outline (x, y pairs, world metres) and storeys of a slanted building with
   * vector walls: its top level gets a flat roof on the outline instead of roof tiles.
   */
  outlineOf?:
    ((b: BuildingId) => { outline: readonly number[]; floors: number } | undefined) | undefined;
  /** Streamed worlds: blocks of flats get the Designer's facade (balconies, canopies, roof). */
  blokOf?: ((b: BuildingId) => BlokInfo | undefined) | undefined;
}

/** A BatchedMesh shared by several `TownStructures` (grown on demand). */
export interface SharedTownBatch {
  mesh: BatchedMesh;
  ids: Map<string | BufferGeometry, number>;
  maxVerts: number;
  maxIndex: number;
}

/** New shared batch on the kit material (empty; grows with the levels). */
export function sharedTownBatch(kit: TownKit, name: string): SharedTownBatch {
  const mesh = new BatchedMesh(64, 4096, 8192, kit.material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, ids: new Map(), maxVerts: 4096, maxIndex: 8192 };
}

/** A static prop of the town kit (trees, poles, signs...). */
export interface PropPlacement {
  name: string;
  x: number;
  z: number;
  rotY: number;
  scale?: number;
  y?: number;
}

interface EdgeItem {
  edge: TownEdge;
  batch: Batch;
  instance: number;
  seed: number;
  lowered: boolean;
  lit: boolean;
  broken: boolean;
}

interface Batch {
  mesh: BatchedMesh;
  ids: Map<string | BufferGeometry, number>;
  /** Shared column batch: this level's instances / own geometries (removed on dispose). */
  shared?: { instances: number[]; geometries: (string | BufferGeometry)[] };
}

const Y_AXIS = new Vector3(0, 1, 0);

/** Levels below the player's floor in the player's building are dimmed (spec §3.3, uDim). */
export const LOWER_LEVEL_DIM = 0.38;
const WHITE = new Color(1, 1, 1);
const DIM = new Color(LOWER_LEVEL_DIM, LOWER_LEVEL_DIM, LOWER_LEVEL_DIM);

/**
 * Town look of the static map (walls, windows, door frames, roofs, props): ONE BatchedMesh per
 * chunk sharing the kit's palette material (1 draw call + 1 shadow per chunk, multi-draw).
 * Cutaway and night windows switch geometry per instance (`setGeometryIdAt` / `setVisibleAt`)
 * instead of rewriting matrices. Same surface as `Structures` (lookup, setCutaway, dispose).
 */
export class TownStructures {
  readonly root = new Group();
  readonly lookup: BuildingLookup;
  layout: TownLayout | undefined;
  private readonly batches = new Map<string, Batch>();
  private readonly edgesByBuilding = new Map<BuildingId, EdgeItem[]>();
  private readonly windows: EdgeItem[] = [];
  private readonly windowIndex = new Map<string, EdgeItem>();
  private readonly roofsByBuilding = new Map<BuildingId, { batch: Batch; instance: number }[]>();
  /** Floor slabs and stair runs of upper levels (hidden with the level). */
  private readonly slabsByBuilding = new Map<BuildingId, { batch: Batch; instance: number }[]>();
  /** Level of the loaded range (0 = ground). */
  z = 0;
  private cut: Cutaway = NO_CUTAWAY;
  /** Outline walls of slanted buildings on this level. */
  private vector: VectorWalls | undefined;
  /** Building whose instances on this level are dimmed (player above this level). */
  private dimmed: BuildingId = NO_BUILDING;
  private key = '-';
  private litMinute = -1;
  /** Windows of rooms with the light switched on (`tx,ty,axis`; sim `lightsOn`). */
  private roomLit: ReadonlySet<string> = new Set();

  constructor(
    private readonly source: ChunkSource,
    private readonly kit: TownKit,
    private readonly opts: TownStructuresOptions = {},
  ) {
    this.root.name = 'town-structures';
    this.lookup = opts.lookup ?? new BuildingLookup(source);
  }

  /** Builds the batches of `range` (+ `props`, placed into the chunk they stand in). */
  loadRange(range: ChunkRange, props: readonly PropPlacement[] = []): void {
    const tiles = new MapTiles(this.source, range.z);
    this.z = range.z;
    const layout = layoutTown(tiles, range);
    this.layout = layout;
    const baseY = range.z * LEVEL_HEIGHT;
    type Item = {
      geo: string | BufferGeometry;
      m: Matrix4;
      variants?: string[];
      edge?: TownEdge;
      roof?: BuildingId;
      slab?: BuildingId;
    };
    const perChunk = new Map<string, Item[]>();
    const push = (x: number, z: number, item: Item) => {
      const k = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
      let list = perChunk.get(k);
      if (!list) perChunk.set(k, (list = []));
      list.push(item);
    };
    const q = new Quaternion();
    const v = new Vector3();
    const one = new Vector3(1, 1, 1);
    const at = (x: number, y: number, z: number, rotY: number, s = 1) =>
      new Matrix4().compose(
        v.set(x, y, z),
        q.setFromAxisAngle(Y_AXIS, rotY),
        one.clone().setScalar(s),
      );

    // Slanted buildings: walls drawn on their outline (`VectorWalls`), not as tile stair-steps.
    const segments: SimWallSegment[] = [];
    for (let cy = range.cy0; cy <= range.cy1; cy++)
      for (let cx = range.cx0; cx <= range.cx1; cx++)
        for (const s of this.source.getChunk(cx, cy, range.z)?.wallSegments ?? []) segments.push(s);
    this.vector?.dispose();
    this.vector = undefined;
    if (segments.length) {
      this.vector = new VectorWalls(
        segments,
        range.z,
        baseY,
        this.kit.cells,
        this.kit.material,
        (b) => layout.skins.get(b) ?? 'plaster',
        // Below the top storey the wall reaches the next floor: no slot at the slab edge.
        (b) => {
          const o = this.opts.outlineOf?.(b);
          return o && range.z < o.floors - 1 ? LEVEL_HEIGHT : WALL_HEIGHT;
        },
      );
      this.root.add(this.vector.root);
    }
    const vectorBuildings = this.vector?.buildings;
    for (const e of layout.edges) {
      if (vectorBuildings?.has(e.building) && !e.interior && e.kind === 'wall') continue;
      const x = e.axis === 'N' ? e.tx + 0.5 : e.tx;
      const z = e.axis === 'N' ? e.ty : e.ty + 0.5;
      const look = { lowered: false };
      push(x, z, {
        geo: edgeModule(e.kind, e.skin, e.content, look),
        m: at(x, baseY, z, e.axis === 'N' ? 0 : Math.PI / 2),
        variants: edgeVariants(e.kind, e.skin, e.content),
        edge: e,
      });
    }
    // Vector roofs on the top level, clipped to this range's chunks (streamed one by one).
    const outlined = new Set<BuildingId>();
    for (const b of new Set([
      ...layout.roofs.map((r) => r.building),
      ...(this.vector?.buildings ?? []),
    ])) {
      const o = this.opts.outlineOf?.(b);
      if (!o || range.z !== o.floors - 1) continue;
      outlined.add(b);
      const skin: Skin = layout.skins.get(b) ?? 'plaster';
      const content = layout.roofs.find((r) => r.building === b)?.content;
      const geo = outlineRoof(
        o.outline,
        roofColour(b, content),
        WALL_CELL[skin],
        this.kit.cells,
        baseY + WALL_HEIGHT,
        {
          x0: range.cx0 * CHUNK_SIZE,
          y0: range.cy0 * CHUNK_SIZE,
          x1: (range.cx1 + 1) * CHUNK_SIZE,
          y1: (range.cy1 + 1) * CHUNK_SIZE,
        },
      );
      const at = geo?.boundingBox?.getCenter(new Vector3());
      if (geo && at && geo.getAttribute('position').count > 0)
        push(at.x, at.z, { geo, m: new Matrix4(), roof: b });
    }
    for (const r of layout.roofs) {
      if (outlined.has(r.building)) continue;
      const y = baseY + WALL_HEIGHT;
      // Streamed chunks see only their part of a building: the whole footprint comes from the
      // building metadata, and only the chunk holding its centre draws the pitched roof.
      const whole = r.style !== 'flat' ? this.opts.footprintOf?.(r.building) : undefined;
      if (whole) {
        const mx = Math.floor((whole.x0 + whole.x1 + 1) / 2 / CHUNK_SIZE);
        const mz = Math.floor((whole.z0 + whole.z1 + 1) / 2 / CHUNK_SIZE);
        if (mx < range.cx0 || mx > range.cx1 || mz < range.cy0 || mz > range.cy1) continue;
      }
      if (r.style !== 'flat' && (whole || (r.rect && !this.opts.footprintOf))) {
        const skin: Skin = layout.skins.get(r.building) ?? 'green';
        const fp = whole ?? r.footprint;
        const geo = pitchedRoof(
          fp,
          r.style,
          roofColour(r.building, r.content),
          WALL_CELL[skin],
          this.kit.cells,
          y,
        );
        const cx = (fp.x0 + fp.x1 + 1) / 2;
        const cz = (fp.z0 + fp.z1 + 1) / 2;
        push(cx, cz, { geo, m: new Matrix4(), roof: r.building });
        continue;
      }
      const has = new Set(r.tiles.map((t) => `${t.tx},${t.ty}`));
      for (const t of r.tiles) {
        push(t.tx + 0.5, t.ty + 0.5, {
          geo: 'roof-flat-tile',
          m: at(t.tx + 0.5, y, t.ty + 0.5, 0),
          roof: r.building,
        });
        const py = y + 0.2;
        if (!has.has(`${t.tx},${t.ty - 1}`))
          push(t.tx + 0.5, t.ty, {
            geo: 'roof-parapet',
            m: at(t.tx + 0.5, py, t.ty, 0),
            roof: r.building,
          });
        if (!has.has(`${t.tx},${t.ty + 1}`))
          push(t.tx + 0.5, t.ty + 1, {
            geo: 'roof-parapet',
            m: at(t.tx + 0.5, py, t.ty + 1, Math.PI),
            roof: r.building,
          });
        if (!has.has(`${t.tx - 1},${t.ty}`))
          push(t.tx, t.ty + 0.5, {
            geo: 'roof-parapet',
            m: at(t.tx, py, t.ty + 0.5, Math.PI / 2),
            roof: r.building,
          });
        if (!has.has(`${t.tx + 1},${t.ty}`))
          push(t.tx + 1, t.ty + 0.5, {
            geo: 'roof-parapet',
            m: at(t.tx + 1, py, t.ty + 0.5, -Math.PI / 2),
            roof: r.building,
          });
      }
    }
    // Upper levels: floor slab per building and chunk, stair runs of this level.
    if (range.z > 0) {
      for (const s of slabGeometry(tiles, range, baseY, this.kit.cells)) {
        push(s.cx, s.cz, { geo: s.geo, m: new Matrix4(), slab: s.building });
      }
    }
    for (const s of stairsGeometry(tiles, range, baseY, this.kit.cells)) {
      push(s.cx, s.cz, { geo: s.geo, m: new Matrix4(), slab: s.building });
    }
    for (const s of railingGeometry(tiles, range, baseY, this.kit.cells)) {
      push(s.cx, s.cz, { geo: s.geo, m: new Matrix4(), slab: s.building });
    }
    // Blocks of flats: balconies, panel joints, entrance canopies, roof vents (hidden with the
    // level / the roof like the slabs).
    const blokOf = this.opts.blokOf;
    if (blokOf) {
      const outward = (e: TownEdge) => {
        const [ix, iy, ox, oy] =
          e.axis === 'N' ? [e.tx, e.ty, e.tx, e.ty - 1] : [e.tx, e.ty, e.tx - 1, e.ty];
        if (this.lookup.at(ix, iy, range.z) === e.building) return -1;
        if (this.lookup.at(ox, oy, range.z) === e.building) return 1;
        return 0;
      };
      const x0 = range.cx0 * CHUNK_SIZE;
      const z0 = range.cy0 * CHUNK_SIZE;
      const x1 = (range.cx1 + 1) * CHUNK_SIZE;
      const z1 = (range.cy1 + 1) * CHUNK_SIZE;
      for (const p of blokFacade(
        layout.edges,
        segments,
        range.z,
        baseY,
        blokOf,
        outward,
        (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1,
        (c) => this.kit.cells.uv(c),
      )) {
        push(
          p.x,
          p.z,
          p.roof
            ? { geo: p.geo, m: new Matrix4(), roof: p.building }
            : { geo: p.geo, m: new Matrix4(), slab: p.building },
        );
      }
    }
    for (const p of props) {
      if (!this.kit.geometries.has(p.name)) continue;
      push(p.x, p.z, { geo: p.name, m: at(p.x, baseY + (p.y ?? 0), p.z, p.rotY, p.scale ?? 1) });
    }

    for (const [k, items] of perChunk) {
      const geos = new Map<string | BufferGeometry, BufferGeometry>();
      const want = (g: string | BufferGeometry) => {
        if (geos.has(g)) return;
        const geo = typeof g === 'string' ? this.kit.geometries.get(g) : g;
        if (geo) geos.set(g, geo);
      };
      for (const it of items) {
        want(it.geo);
        for (const name of it.variants ?? []) want(name);
      }
      let batch: Batch;
      let mesh: BatchedMesh;
      const shared = this.opts.sharedBatch?.(k);
      if (shared) {
        mesh = shared.mesh;
        let verts = 0;
        let index = 0;
        for (const [key, g] of geos) {
          if (shared.ids.has(key)) continue;
          verts += g.getAttribute('position').count;
          index += g.index?.count ?? 0;
        }
        const needInstances = mesh.instanceCount + items.length;
        if (needInstances > mesh.maxInstanceCount) {
          mesh.setInstanceCount(Math.max(needInstances, mesh.maxInstanceCount * 2));
        }
        if (verts > mesh.unusedVertexCount || index > mesh.unusedIndexCount) {
          shared.maxVerts = Math.max(shared.maxVerts * 2, shared.maxVerts + verts);
          shared.maxIndex = Math.max(shared.maxIndex * 2, shared.maxIndex + index);
          mesh.setGeometrySize(shared.maxVerts, shared.maxIndex);
        }
        const own: (string | BufferGeometry)[] = [];
        for (const [key, g] of geos) {
          if (shared.ids.has(key)) continue;
          shared.ids.set(key, mesh.addGeometry(g));
          // Level-only geometry (roofs, slabs, stairs) goes with the level.
          if (typeof key !== 'string') own.push(key);
        }
        batch = { mesh, ids: shared.ids, shared: { instances: [], geometries: own } };
      } else {
        let verts = 0;
        let index = 0;
        for (const g of geos.values()) {
          verts += g.getAttribute('position').count;
          index += g.index?.count ?? 0;
        }
        mesh = new BatchedMesh(items.length, verts, index, this.kit.material);
        mesh.name = `town:${k},${range.z}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        batch = { mesh, ids: new Map() };
        for (const [key, g] of geos) batch.ids.set(key, mesh.addGeometry(g));
      }
      for (const it of items) {
        const gid = batch.ids.get(it.geo);
        if (gid === undefined) continue;
        const instance = mesh.addInstance(gid);
        mesh.setMatrixAt(instance, it.m);
        batch.shared?.instances.push(instance);
        if (batch.shared) mesh.setColorAt(instance, WHITE);
        if (it.edge) {
          const e = it.edge;
          const item: EdgeItem = {
            edge: e,
            batch,
            instance,
            seed: e.tx * 2 + (e.axis === 'N' ? 0 : 1) + e.ty * 7919,
            lowered: false,
            lit: false,
            broken: false,
          };
          let list = this.edgesByBuilding.get(e.building);
          if (!list) this.edgesByBuilding.set(e.building, (list = []));
          list.push(item);
          if (e.kind === 'window') {
            this.windows.push(item);
            this.windowIndex.set(`${e.tx},${e.ty},${e.axis}`, item);
          }
        }
        if (it.slab !== undefined) {
          let list = this.slabsByBuilding.get(it.slab);
          if (!list) this.slabsByBuilding.set(it.slab, (list = []));
          list.push({ batch, instance });
        }
        if (it.roof !== undefined) {
          let list = this.roofsByBuilding.get(it.roof);
          if (!list) this.roofsByBuilding.set(it.roof, (list = []));
          list.push({ batch, instance });
        }
      }
      // Per-instance colours from the start (one shader variant, no hitch on the first dim).
      if (mesh.instanceCount > 0 && !batch.shared) mesh.setColorAt(0, WHITE);
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.batches.set(k, batch);
      if (!batch.shared) this.root.add(mesh);
    }
    this.key = '-';
    this.cut = NO_CUTAWAY;
  }

  /** Lowers the walls / hides the roof of the player's building (only touched buildings). */
  setCutaway(c: Cutaway): void {
    const key = cutawayKey(c);
    if (key === this.key) return;
    const prev = this.cut;
    this.key = key;
    this.cut = c;
    this.vector?.setCutaway(c);
    const touched = new Set([prev.building, c.building]);
    // Buildings between the camera and the player, before and now.
    for (const p of [prev, c]) for (const b of p.occluders ?? []) touched.add(b);
    // Neighbours around the player (their walls may hide it: `CUT_NEAR`), before and now.
    for (const p of [prev, c]) {
      if (p.building === NO_BUILDING) continue;
      for (let y = p.ty - CUT_NEAR - 1; y <= p.ty + CUT_NEAR + 1; y++)
        for (let x = p.tx - CUT_NEAR - 1; x <= p.tx + CUT_NEAR + 1; x++) {
          const b = this.lookup.at(x, y, p.z ?? 0);
          if (b !== NO_BUILDING) touched.add(b);
        }
    }
    const level = c.z ?? 0;
    const dim = c.building !== NO_BUILDING && this.z < level ? c.building : NO_BUILDING;
    if (dim !== this.dimmed) {
      this.tint(this.dimmed, WHITE);
      this.tint(dim, DIM);
      this.dimmed = dim;
    }
    for (const b of touched) {
      // Levels above the player's are not drawn in the player's building (spec 3.1).
      // Occluders too: cut down to the player's floor.
      const hidden = isLevelHidden(c, b, this.z);
      const here = this.z === level;
      for (const it of this.edgesByBuilding.get(b) ?? []) {
        it.batch.mesh.setVisibleAt(it.instance, !hidden);
        const lowered =
          here && isEdgeLowered(c, it.edge.building, it.edge.axis, it.edge.tx, it.edge.ty);
        if (lowered !== it.lowered) {
          it.lowered = lowered;
          this.apply(it);
        }
      }
      for (const r of this.roofsByBuilding.get(b) ?? []) {
        r.batch.mesh.setVisibleAt(r.instance, !hidden && !isRoofHidden(c, b));
      }
      for (const r of this.slabsByBuilding.get(b) ?? []) {
        r.batch.mesh.setVisibleAt(r.instance, !hidden);
      }
    }
  }

  /** Night windows: lit ones switch to the `-lit` module (emission from the material). */
  setMinute(minute: number): void {
    const m = Math.floor(minute);
    if (m === this.litMinute) return;
    this.litMinute = m;
    for (const it of this.windows) {
      const lit = this.isLit(it, m);
      if (lit !== it.lit) {
        it.lit = lit;
        this.apply(it);
      }
    }
  }

  /**
   * Windows lit by a switched-on room light (`tx,ty,axis` of this level, from `litWindowKeys`):
   * at night they use the same `-lit` module as the decorative lit windows.
   */
  setRoomLit(keys: ReadonlySet<string>): void {
    this.roomLit = keys;
    if (this.litMinute < 0) return;
    for (const it of this.windows) {
      const lit = this.isLit(it, this.litMinute);
      if (lit !== it.lit) {
        it.lit = lit;
        this.apply(it);
      }
    }
  }

  private isLit(it: EdgeItem, m: number): boolean {
    if (it.edge.interior || it.edge.skin === 'burnt') return false;
    if (windowLit(it.seed, m)) return true;
    return isLightNight(m) && this.roomLit.has(`${it.edge.tx},${it.edge.ty},${it.edge.axis}`);
  }

  /** Smashed window (sim `openingChanged` broken): frame without glass. */
  setWindowBroken(tx: number, ty: number, axis: 'N' | 'W', broken: boolean): void {
    const it = this.windowIndex.get(`${tx},${ty},${axis}`);
    if (!it || it.broken === broken) return;
    it.broken = broken;
    this.apply(it);
  }

  /** Skin of the doorway at an edge (door leaf choice), undefined if none. */
  doorSkin(tx: number, ty: number, axis: 'N' | 'W'): Skin | undefined {
    const b = this.lookup.edge(axis, tx, ty, 0);
    for (const it of this.edgesByBuilding.get(b) ?? []) {
      const e = it.edge;
      if (e.tx === tx && e.ty === ty && e.axis === axis) return e.skin;
    }
    return undefined;
  }

  /** Instances (tests / dev overlay). */
  stats(): { batches: number; instances: number } {
    let instances = 0;
    for (const b of this.batches.values())
      instances += b.shared ? b.shared.instances.length : b.mesh.instanceCount;
    return { batches: this.batches.size, instances };
  }

  dispose(): void {
    this.vector?.dispose();
    this.vector = undefined;
    for (const b of this.batches.values()) {
      if (!b.shared) {
        b.mesh.dispose();
        continue;
      }
      // Shared column batch: only this level's instances and geometries leave.
      for (const i of b.shared.instances) b.mesh.deleteInstance(i);
      for (const g of b.shared.geometries) {
        const id = b.ids.get(g);
        if (id !== undefined) b.mesh.deleteGeometry(id);
        b.ids.delete(g);
      }
    }
    this.batches.clear();
    this.root.clear();
  }

  /** Colour of every instance of building `b` on this level. */
  private tint(b: BuildingId, c: Color): void {
    if (b === NO_BUILDING) return;
    for (const it of this.edgesByBuilding.get(b) ?? []) it.batch.mesh.setColorAt(it.instance, c);
    for (const r of this.roofsByBuilding.get(b) ?? []) r.batch.mesh.setColorAt(r.instance, c);
    for (const r of this.slabsByBuilding.get(b) ?? []) r.batch.mesh.setColorAt(r.instance, c);
  }

  /** Building dimmed on this level (tests). */
  dimmedBuilding(): BuildingId {
    return this.dimmed;
  }

  private apply(it: EdgeItem): void {
    const name = edgeModule(it.edge.kind, it.edge.skin, it.edge.content, {
      lowered: it.lowered,
      lit: it.lit,
      broken: it.broken,
    });
    const gid = it.batch.ids.get(name);
    if (gid !== undefined) it.batch.mesh.setGeometryIdAt(it.instance, gid);
  }
}

/** Highest level the client draws (blueprint floors go up to z = 15). */
export const MAX_LEVEL = 15;

/**
 * Town batches of the upper levels z = 1.. of `range` (stops at the first level without chunks).
 * Each level hides itself above the player's floor in the player's building (`setCutaway`).
 */
export function loadUpperLevels(
  source: ChunkSource,
  range: ChunkRange,
  kit: TownKit,
): TownStructures[] {
  const out: TownStructures[] = [];
  for (let z = range.z + 1; z <= MAX_LEVEL; z++) {
    let any = false;
    for (let cy = range.cy0; cy <= range.cy1 && !any; cy++)
      for (let cx = range.cx0; cx <= range.cx1 && !any; cx++)
        any = source.getChunk(cx, cy, z) !== undefined;
    if (!any) break;
    const level = new TownStructures(source, kit);
    level.loadRange({ ...range, z });
    out.push(level);
  }
  return out;
}
