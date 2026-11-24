import type { FadeView } from '../wall-fade.js';
import { noteBuildings } from '../town/bld-v2.js';
import type { EdgeSide, OpeningView, SimEvent } from '@deadzone/protocol';
import { Group, Mesh, Vector2, type MeshStandardMaterial } from 'three';
import { BuildingLookup, type OutlineAt } from '../building-lookup.js';
import { CHUNK_SIZE, NO_BUILDING, type BuildingId } from '../chunk.js';
import type { Cutaway } from '../cutaway.js';
import { LEVEL_HEIGHT } from '../instances.js';
import {
  OpeningsView,
  sashModel,
  windowWithoutGlass,
  type OpeningEdge,
  type OpeningKind,
} from '../openings.js';
import type { LoadedChunks } from '../streaming/source.js';
import { townDecor } from '../town/decor.js';
import type { TreeSpot } from '../trees/tree-layer.js';
import type { TownKit } from '../town/kit.js';
import { doorLeaf, type Skin } from '../town/modules.js';
import { buildTerrainGeometry } from '../town/terrain-mesh.js';
import {
  TownStructures,
  cardAtlasShared,
  sharedTownBatch,
  type SharedTownBatch,
} from '../town/town-structures.js';
import { WindowPanes } from '../town/window-panes.js';
import { VectorWallPool, type OutlineOpening } from '../town/vector-walls.js';
import { terrainMaterial } from '../town/town-terrain.js';
import { MapTiles } from '../town/tiles.js';
import type { GenBuildingInfo } from './convert.js';

const key = (cx: number, cy: number, z: number) => `${cx},${cy},${z}`;

/**
 * The town kit over streamed chunks (generated maps): per near chunk and level one
 * `TownStructures` batch (walls, windows, roofs, slabs, stairs, kit trees / tufts / poles) and on
 * the ground one merged terrain mesh. The levels of a chunk share one BatchedMesh (column). Reads neighbours from the loaded chunks; buildings crossing
 * chunk borders get their pitched roof once, from the building metadata.
 */
/** Receiver of a chunk's tree props (realistic trees, `world/trees/tree-layer.ts`). */
export interface TreeSink {
  isTree(propName: string): boolean;
  load(key: string, trees: readonly TreeSpot[]): void;
  unload(key: string): void;
  /**
   * Extra plants of the chunk's scrub / hedge zones and woods (`WorldChunk.bushes` / `woods`,
   * global tiles), drawn by the painted style; absent = not planted.
   */
  zoneSpots?(
    bushes: readonly { x: number; y: number; w: number; h: number }[],
    woods: readonly { x: number; y: number; w: number; h: number }[],
  ): TreeSpot[];
}

export class StreamedTown {
  readonly root = new Group();
  /** Building at a tile of the loaded chunks (cutaway, footsteps, big map). */
  readonly lookup: BuildingLookup;
  /** Outline of a slanted (vector-walled) building, from the column holding tile (tx, ty). */
  readonly outlineAt: OutlineAt;
  private readonly terrainMat: MeshStandardMaterial;
  private readonly levels = new Map<string, TownStructures>();
  /** Glass + interior cards of every loaded level: +2 draw calls in total (bld-spec §4). */
  private readonly panes = new WindowPanes(1024, cardAtlasShared());
  private vectorPool: VectorWallPool | undefined;
  private readonly terrain = new Map<string, Mesh>();
  /** One town BatchedMesh per chunk column (all its levels): fewer draw calls / shadow draws. */
  private readonly columns = new Map<string, { batch: SharedTownBatch; levels: number }>();
  private cut: Cutaway | undefined;
  private minute = -1;
  private roomLit: ReadonlySet<string> = new Set();
  private readonly broken = new Set<string>();
  /** Main-thread build ms of the last 512 chunk levels (perf probe: 60 fps budget). */
  readonly buildMs: number[] = [];
  private builds = 0;

  constructor(
    private readonly loaded: LoadedChunks,
    private readonly kit: TownKit,
    /** Realistic style: buildings drawn as a model from outside (kit pieces hidden until cut). */
    private readonly shellOf?: (b: GenBuildingInfo) => boolean,
    /** Realistic style: tree props go to this layer (world/trees) instead of the kit batch. */
    private readonly trees?: TreeSink,
  ) {
    this.root.name = 'streamed-town';
    this.root.add(this.panes.root);
    this.vectorPool = new VectorWallPool(this.kit.material);
    this.root.add(this.vectorPool.root);
    this.lookup = new BuildingLookup(loaded, false);
    this.outlineAt = (b, tx, ty) => {
      const col = this.loaded.column(Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE));
      const m = col?.buildings?.find((x) => x.id === b);
      return m?.outline
        ? { outline: m.outline, ...(m.holes ? { holes: m.holes } : {}) }
        : undefined;
    };
    this.terrainMat = kit.terrainMaterial ?? terrainMaterial(kit.detail, kit.cells);
  }

  loadChunk(cx: number, cy: number, z: number): { bytes: number; triangles: number } {
    const t0 = performance.now();
    const out = this.build(cx, cy, z);
    this.buildMs[this.builds++ % 512] = performance.now() - t0;
    return out;
  }

  private build(cx: number, cy: number, z: number): { bytes: number; triangles: number } {
    const col = this.loaded.column(cx, cy);
    if (!col) return { bytes: 0, triangles: 0 };
    const metas = new Map<BuildingId, GenBuildingInfo>();
    for (const b of (col.buildings ?? []) as GenBuildingInfo[]) metas.set(b.id, b);
    noteBuildings(metas.values()); // bld v2: kind + footprint per building
    const range = { cx0: cx, cy0: cy, cx1: cx, cy1: cy, z };
    let bytes = 0;
    let triangles = 0;
    if (z === 0) {
      const pal = this.loaded.tilePalette;
      const rings = new Map<BuildingId, Vector2[] | undefined>();
      const vector =
        col.roads || col.under || col.areas
          ? {
              roads: col.roads ?? [],
              ...(col.areas ? { areas: col.areas } : {}),
              outlineOf: (b: BuildingId) => {
                if (rings.has(b)) return rings.get(b);
                const o = metas.get(b)?.outline;
                let r: Vector2[] | undefined;
                if (o && o.length >= 6) {
                  r = [];
                  for (let i = 0; i + 1 < o.length; i += 2) r.push(new Vector2(o[i], o[i + 1]));
                  if (r.length > 1 && r[0]!.equals(r[r.length - 1]!)) r.pop();
                }
                rings.set(b, r);
                return r;
              },
              // Also the neighbour chunks' layer (curbs at the chunk edge look across it).
              underAt: (x: number, y: number) => {
                const ncx = Math.floor(x / CHUNK_SIZE);
                const ncy = Math.floor(y / CHUNK_SIZE);
                const u = (ncx === cx && ncy === cy ? col : this.loaded.column(ncx, ncy))?.under;
                if (!u) return undefined;
                const id = u[(y - ncy * CHUNK_SIZE) * CHUNK_SIZE + (x - ncx * CHUNK_SIZE)]!;
                return id ? (pal[id] ?? undefined) : undefined;
              },
            }
          : undefined;
      const g = buildTerrainGeometry(
        new MapTiles(this.loaded, 0),
        cx,
        cy,
        this.kit.cells,
        0,
        vector,
        true,
      );
      if (g) {
        const mesh = new Mesh(g, this.terrainMat);
        mesh.position.set(cx * CHUNK_SIZE, 0, cy * CHUNK_SIZE);
        mesh.name = `terrain:${cx},${cy}`;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.terrain.set(key(cx, cy, 0), mesh);
        const n = g.getAttribute('position').count;
        bytes += n * 40 + (g.index?.count ?? 0) * 4;
        triangles += (g.index?.count ?? n) / 3;
      }
    }
    const colKey = `${cx},${cy}`;
    let column = this.columns.get(colKey);
    if (!column) {
      column = { batch: sharedTownBatch(this.kit, `town:${colKey}`), levels: 0 };
      this.columns.set(colKey, column);
      this.root.add(column.batch.mesh);
    }
    column.levels++;
    const shared = column.batch;
    const shellOf = this.shellOf;
    const level = new TownStructures(this.loaded, this.kit, {
      lookup: this.lookup,
      panes: this.panes,
      vectorPool: this.vectorPool,
      // Every piece of this level (also one poking over the chunk edge) goes into this column.
      sharedBatch: () => shared,
      footprintOf: (b) => {
        const m = metas.get(b);
        return m?.rect ? { x0: m.x0, z0: m.y0, x1: m.x1, z1: m.y1 } : undefined;
      },
      outlineOf: (b) => {
        const m = metas.get(b);
        return m?.outline
          ? { outline: m.outline, floors: m.floors, ...(m.holes ? { holes: m.holes } : {}) }
          : undefined;
      },
      shelled: shellOf
        ? (b) => {
            const m = metas.get(b);
            return !!m && shellOf(m);
          }
        : undefined,
      blokOf: (b) => {
        const m = metas.get(b);
        if (!m || m.kind !== 'block' || m.floors < 3) return undefined;
        return {
          floors: m.floors,
          x0: m.x0,
          y0: m.y0,
          x1: m.x1,
          y1: m.y1,
          outline: m.outline,
          // About a third of the blocks were insulated after 2000 (blok-p4-docieplony).
          insulated: (Math.imul(b, 2654435761) >>> 0) % 3 === 0,
          seed: b % 97,
        };
      },
    });
    const trees: [number, number][] = [];
    // Plan trees with their species, for a sink that draws species (painted style: pines in the
    // woods, limes along streets); the kit draws them as generic trees.
    const speciesTrees: TreeSpot[] = [];
    if (z === 0) {
      for (const d of col.decor ?? []) {
        if (d.kind !== 'base:tree') continue;
        const x = cx * CHUNK_SIZE + d.x;
        const tz = cy * CHUNK_SIZE + d.y;
        if (d.species && this.trees?.zoneSpots)
          speciesTrees.push({ x, z: tz, y: 0, species: d.species });
        else trees.push([x, tz]);
      }
    }
    // Power poles come from the plan's OSM lines (infra layer), not every 30 m along sidewalks.
    let props =
      z === 0
        ? townDecor(new MapTiles(this.loaded, 0), range, trees).props.filter(
            (p) => p.name !== 'prop-electricity-pole',
          )
        : [];
    if (this.trees && z === 0) {
      const sink = this.trees;
      sink.load(`${cx},${cy}`, [
        ...props
          .filter((p) => sink.isTree(p.name))
          .map((p) => ({ x: p.x, z: p.z, y: p.y ?? 0, prop: p.name })),
        ...speciesTrees,
        ...(sink.zoneSpots?.(col.bushes ?? [], col.woods ?? []) ?? []),
      ]);
      props = props.filter((p) => !sink.isTree(p.name));
    }
    level.loadRange(range, props);
    level.root.position.y = 0;
    this.levels.set(key(cx, cy, z), level);
    this.root.add(level.root);
    if (this.cut) level.setCutaway(this.cut);
    level.setRoomLit(this.roomLitOf(key(cx, cy, z)));
    if (this.minute >= 0) level.setMinute(this.minute);
    for (const b of this.broken) {
      const [tx, ty, bz, axis] = b.split(',');
      if (Number(bz) === z) level.setWindowBroken(Number(tx), Number(ty), axis as 'N' | 'W', true);
    }
    const s = level.stats();
    triangles += s.instances * 24;
    bytes += s.instances * 64;
    return { bytes, triangles };
  }

  unloadChunk(cx: number, cy: number, z: number): void {
    const k = key(cx, cy, z);
    if (z === 0) this.trees?.unload(`${cx},${cy}`);
    const level = this.levels.get(k);
    if (level) {
      this.root.remove(level.root);
      level.dispose();
      this.levels.delete(k);
      const colKey = `${cx},${cy}`;
      const column = this.columns.get(colKey);
      if (column && --column.levels <= 0) {
        this.root.remove(column.batch.mesh);
        column.batch.mesh.dispose();
        this.columns.delete(colKey);
      }
    }
    const t = this.terrain.get(k);
    if (t) {
      this.root.remove(t);
      t.geometry.dispose();
      this.terrain.delete(k);
    }
  }

  setCutaway(c: Cutaway): void {
    this.cut = c;
    for (const l of this.levels.values()) l.setCutaway(c);
  }

  /** Wall fade (every frame), see `TownStructures.setFade`. */
  setFade(v: FadeView | undefined, dtMs: number): void {
    for (const l of this.levels.values()) l.setFade(v, dtMs);
  }

  setMinute(minute: number): void {
    this.minute = minute;
    for (const l of this.levels.values()) l.setMinute(minute);
  }

  /** Windows lit by room lights (`litWindowKeys`: `tx,ty,z,axis`), split per loaded level. */
  setRoomLit(keys: ReadonlySet<string>): void {
    this.roomLit = keys;
    for (const [k, l] of this.levels) l.setRoomLit(this.roomLitOf(k));
  }

  private roomLitOf(levelKey: string): Set<string> {
    const out = new Set<string>();
    for (const w of this.roomLit) {
      const [tx, ty, z, axis] = w.split(',');
      const k = key(
        Math.floor(Number(tx) / CHUNK_SIZE),
        Math.floor(Number(ty) / CHUNK_SIZE),
        Number(z),
      );
      if (k === levelKey) out.add(`${tx},${ty},${axis}`);
    }
    return out;
  }

  setWindowBroken(tx: number, ty: number, z: number, axis: 'N' | 'W', broken: boolean): void {
    const k = `${tx},${ty},${z},${axis}`;
    if (broken) this.broken.add(k);
    else this.broken.delete(k);
    const l = this.levels.get(key(Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE), z));
    l?.setWindowBroken(tx, ty, axis, broken);
  }

  doorSkin(tx: number, ty: number, z: number, axis: 'N' | 'W'): Skin | undefined {
    const l = this.levels.get(key(Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE), z));
    return l?.doorSkin(tx, ty, axis);
  }

  /** Spot of an exterior door / window on a slanted building's outline (level z). */
  openingPlace(tx: number, ty: number, z: number, axis: 'N' | 'W'): OutlineOpening | undefined {
    const l = this.levels.get(key(Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE), z));
    return l?.openingPlace(tx, ty, axis);
  }

  /** Window module kind at an edge (`shop` = witryna). */
  windowKind(tx: number, ty: number, z: number, axis: 'N' | 'W'): 'shop' | 'window' | undefined {
    const l = this.levels.get(key(Math.floor(tx / CHUNK_SIZE), Math.floor(ty / CHUNK_SIZE), z));
    return l?.windowKind(tx, ty, axis);
  }

  /** Loaded level batches (tests, perf overlay). */
  stats(): { levels: number; terrain: number; instances: number } {
    let instances = 0;
    for (const l of this.levels.values()) instances += l.stats().instances;
    return { levels: this.levels.size, terrain: this.terrain.size, instances };
  }

  dispose(): void {
    for (const k of [...this.levels.keys(), ...this.terrain.keys()]) {
      const [cx, cy, z] = k.split(',').map(Number);
      this.unloadChunk(cx!, cy!, z!);
    }
    this.terrainMat.dispose();
    this.panes.dispose();
    this.vectorPool?.dispose();
  }
}

/** Opening surface the game uses (one view over a map, or the streamed per-chunk views). */
export interface OpeningsLike {
  readonly root: Group;
  /** Bumped whenever the set of edges changes (door targets are cached by it). */
  readonly revision?: number;
  edges(kind: OpeningKind): readonly OpeningEdge[];
  info(tx: number, ty: number, z: number, side: EdgeSide): ReturnType<OpeningsView['info']>;
  setStates(list: readonly OpeningView[]): void;
  applyEvents(events: readonly SimEvent[]): void;
  setCutaway(c: Cutaway): void;
  update(nowS: number): void;
  /** Lit room windows (`litWindowKeys`): covered ones glow by their `lightPass`. */
  setLitWindows?(keys: ReadonlySet<string>): void;
  /** Player position (sim x / y, level): door glow on that level, faded by distance. */
  setViewer?(x: number, y: number, z: number): void;
}

/**
 * Doors, panes and fences of the streamed ground level: one `OpeningsView` per near chunk; sim
 * state (`view.openings` + events since) is replayed into views of chunks that load later. A
 * geometry-less master view answers state queries for every edge.
 */
export class StreamedOpenings implements OpeningsLike {
  readonly root = new Group();
  revision = 0;
  private readonly views = new Map<string, OpeningsView>();
  private readonly master: OpeningsView;
  private lastStates: readonly OpeningView[] = [];
  private eventsSince: SimEvent[] = [];
  private cut: Cutaway | undefined;
  private lit: ReadonlySet<string> = new Set();
  private viewer: { x: number; y: number; z: number } | undefined;

  constructor(
    private readonly loaded: LoadedChunks,
    private readonly town: StreamedTown | undefined,
    private readonly kit: TownKit | undefined,
  ) {
    this.root.name = 'streamed-openings';
    this.master = new OpeningsView(loaded, town?.lookup ?? new BuildingLookup(loaded, false));
  }

  loadChunk(cx: number, cy: number, z: number): void {
    // Every storey: doors and windows open one by one on upper floors too.
    const town = this.town;
    const kit = this.kit;
    const ax = (e: OpeningEdge) => (e.side === 'n' ? 'N' : 'W');
    const view = new OpeningsView(
      this.loaded,
      town?.lookup ?? new BuildingLookup(this.loaded, false),
      kit && town
        ? {
            kit,
            leafOf: (e) => doorLeaf(town.doorSkin(e.tx, e.ty, e.z, ax(e)) ?? 'interior'),
            // Open or smashed: the wall module drops its glass (open: the sash swings in).
            onWindow: (e, state) =>
              town.setWindowBroken(e.tx, e.ty, e.z, ax(e), windowWithoutGlass(state)),
            sashOf: (e) => sashModel(town.windowKind(e.tx, e.ty, e.z, ax(e))),
            placeOf: (e) => town.openingPlace(e.tx, e.ty, e.z, ax(e)),
          }
        : undefined,
    );
    view.loadRange({ cx0: cx, cy0: cy, cx1: cx, cy1: cy, z });
    view.setStates(this.lastStates);
    if (this.eventsSince.length) view.applyEvents(this.eventsSince);
    if (this.cut) view.setCutaway(this.cut);
    view.setLitWindows(this.lit);
    if (this.viewer) view.setViewer(this.viewer.x, this.viewer.y, this.viewer.z);
    this.views.set(key(cx, cy, z), view);
    this.root.add(view.root);
    this.revision++;
  }

  unloadChunk(cx: number, cy: number, z: number): void {
    const k = key(cx, cy, z);
    const v = this.views.get(k);
    if (!v) return;
    this.root.remove(v.root);
    v.dispose();
    this.views.delete(k);
    this.revision++;
  }

  edges(kind: OpeningKind): readonly OpeningEdge[] {
    const out: OpeningEdge[] = [];
    for (const v of this.views.values()) out.push(...v.edges(kind));
    return out;
  }

  info(tx: number, ty: number, z: number, side: EdgeSide) {
    return this.master.info(tx, ty, z, side);
  }

  setStates(list: readonly OpeningView[]): void {
    this.lastStates = list;
    this.eventsSince = [];
    this.master.setStates(list);
    for (const v of this.views.values()) v.setStates(list);
  }

  applyEvents(events: readonly SimEvent[]): void {
    const relevant = events.filter(
      (e) => e.type === 'openingChanged' || e.type === 'openingPressure',
    );
    if (!relevant.length) return;
    // Keep only state changes for replay (pressure fades on its own); bounded.
    for (const e of relevant) if (e.type === 'openingChanged') this.eventsSince.push(e);
    if (this.eventsSince.length > 4096) this.eventsSince.splice(0, this.eventsSince.length - 4096);
    this.master.applyEvents(relevant);
    for (const v of this.views.values()) v.applyEvents(relevant);
  }

  setCutaway(c: Cutaway): void {
    this.cut = c;
    for (const v of this.views.values()) v.setCutaway(c);
  }

  update(nowS: number): void {
    for (const v of this.views.values()) v.update(nowS);
  }

  setViewer(x: number, y: number, z: number): void {
    for (const v of this.views.values()) v.setViewer(x, y, z);
    this.viewer = { x, y, z };
  }

  setLitWindows(keys: ReadonlySet<string>): void {
    this.lit = keys;
    for (const v of this.views.values()) v.setLitWindows(keys);
  }

  /** Loaded per-chunk views (tests). */
  get size(): number {
    return this.views.size;
  }

  dispose(): void {
    for (const k of [...this.views.keys()]) {
      const [cx, cy, z] = k.split(',').map(Number);
      this.unloadChunk(cx!, cy!, z!);
    }
    this.master.dispose();
  }
}

export { NO_BUILDING, LEVEL_HEIGHT };
