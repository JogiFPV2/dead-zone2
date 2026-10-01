import { BatchedMesh, Group, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { BuildingLookup } from '../building-lookup.js';
import { CHUNK_SIZE, type BuildingId, type ChunkRange, type ChunkSource } from '../chunk.js';
import { NO_CUTAWAY, cutawayKey, isEdgeLowered, isRoofHidden, type Cutaway } from '../cutaway.js';
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
import { pitchedRoof } from './roof.js';
import { MapTiles } from './tiles.js';

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
}

const Y_AXIS = new Vector3(0, 1, 0);

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
  private cut: Cutaway = NO_CUTAWAY;
  private key = '-';
  private litMinute = -1;

  constructor(
    private readonly source: ChunkSource,
    private readonly kit: TownKit,
  ) {
    this.root.name = 'town-structures';
    this.lookup = new BuildingLookup(source);
  }

  /** Builds the batches of `range` (+ `props`, placed into the chunk they stand in). */
  loadRange(range: ChunkRange, props: readonly PropPlacement[] = []): void {
    const tiles = new MapTiles(this.source, range.z);
    const layout = layoutTown(tiles, range);
    this.layout = layout;
    const baseY = range.z * LEVEL_HEIGHT;
    type Item = {
      geo: string | BufferGeometry;
      m: Matrix4;
      variants?: string[];
      edge?: TownEdge;
      roof?: BuildingId;
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

    for (const e of layout.edges) {
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
    for (const r of layout.roofs) {
      const y = baseY + WALL_HEIGHT;
      if (r.style !== 'flat' && r.rect) {
        const skin: Skin = layout.skins.get(r.building) ?? 'green';
        const geo = pitchedRoof(
          r.footprint,
          r.style,
          roofColour(r.building),
          WALL_CELL[skin],
          this.kit.cells,
          y,
        );
        const cx = (r.footprint.x0 + r.footprint.x1 + 1) / 2;
        const cz = (r.footprint.z0 + r.footprint.z1 + 1) / 2;
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
      let verts = 0;
      let index = 0;
      for (const g of geos.values()) {
        verts += g.getAttribute('position').count;
        index += g.index?.count ?? 0;
      }
      const mesh = new BatchedMesh(items.length, verts, index, this.kit.material);
      mesh.name = `town:${k},${range.z}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const batch: Batch = { mesh, ids: new Map() };
      for (const [key, g] of geos) batch.ids.set(key, mesh.addGeometry(g));
      for (const it of items) {
        const gid = batch.ids.get(it.geo);
        if (gid === undefined) continue;
        const instance = mesh.addInstance(gid);
        mesh.setMatrixAt(instance, it.m);
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
        if (it.roof !== undefined) {
          let list = this.roofsByBuilding.get(it.roof);
          if (!list) this.roofsByBuilding.set(it.roof, (list = []));
          list.push({ batch, instance });
        }
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.batches.set(k, batch);
      this.root.add(mesh);
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
    const touched = new Set([prev.building, c.building]);
    for (const b of touched) {
      for (const it of this.edgesByBuilding.get(b) ?? []) {
        const lowered = isEdgeLowered(c, it.edge.building, it.edge.axis, it.edge.tx, it.edge.ty);
        if (lowered !== it.lowered) {
          it.lowered = lowered;
          this.apply(it);
        }
      }
      for (const r of this.roofsByBuilding.get(b) ?? []) {
        r.batch.mesh.setVisibleAt(r.instance, !isRoofHidden(c, b));
      }
    }
  }

  /** Night windows: lit ones switch to the `-lit` module (emission from the material). */
  setMinute(minute: number): void {
    const m = Math.floor(minute);
    if (m === this.litMinute) return;
    this.litMinute = m;
    for (const it of this.windows) {
      const lit = !it.edge.interior && windowLit(it.seed, m);
      if (lit !== it.lit) {
        it.lit = lit;
        this.apply(it);
      }
    }
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
    for (const b of this.batches.values()) instances += b.mesh.instanceCount;
    return { batches: this.batches.size, instances };
  }

  dispose(): void {
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear();
    this.root.clear();
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
