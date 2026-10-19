import type { EdgeSide, OpeningView, SimEvent } from '@deadzone/protocol';
import { Group, Mesh, type MeshStandardMaterial } from 'three';
import { BuildingLookup } from '../building-lookup.js';
import { CHUNK_SIZE, NO_BUILDING, type BuildingId } from '../chunk.js';
import type { Cutaway } from '../cutaway.js';
import { LEVEL_HEIGHT } from '../instances.js';
import { OpeningsView, type OpeningEdge, type OpeningKind } from '../openings.js';
import type { LoadedChunks } from '../streaming/source.js';
import { townDecor } from '../town/decor.js';
import type { TownKit } from '../town/kit.js';
import { doorLeaf, type Skin } from '../town/modules.js';
import { buildTerrainGeometry } from '../town/terrain-mesh.js';
import { TownStructures, sharedTownBatch, type SharedTownBatch } from '../town/town-structures.js';
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
export class StreamedTown {
  readonly root = new Group();
  /** Building at a tile of the loaded chunks (cutaway, footsteps, big map). */
  readonly lookup: BuildingLookup;
  private readonly terrainMat: MeshStandardMaterial;
  private readonly levels = new Map<string, TownStructures>();
  private readonly terrain = new Map<string, Mesh>();
  /** One town BatchedMesh per chunk column (all its levels): fewer draw calls / shadow draws. */
  private readonly columns = new Map<string, { batch: SharedTownBatch; levels: number }>();
  private cut: Cutaway | undefined;
  private minute = -1;
  private readonly broken = new Set<string>();
  /** Main-thread build ms of the last 512 chunk levels (perf probe: 60 fps budget). */
  readonly buildMs: number[] = [];
  private builds = 0;

  constructor(
    private readonly loaded: LoadedChunks,
    private readonly kit: TownKit,
  ) {
    this.root.name = 'streamed-town';
    this.lookup = new BuildingLookup(loaded, false);
    this.terrainMat = kit.terrainMaterial ?? terrainMaterial(kit.detail);
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
    const range = { cx0: cx, cy0: cy, cx1: cx, cy1: cy, z };
    let bytes = 0;
    let triangles = 0;
    if (z === 0) {
      const pal = this.loaded.tilePalette;
      const vector =
        col.roads || col.under
          ? {
              roads: col.roads ?? [],
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
      );
      if (g) {
        const mesh = new Mesh(g, this.terrainMat);
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
    const level = new TownStructures(this.loaded, this.kit, {
      lookup: this.lookup,
      // Every piece of this level (also one poking over the chunk edge) goes into this column.
      sharedBatch: () => shared,
      footprintOf: (b) => {
        const m = metas.get(b);
        return m?.rect ? { x0: m.x0, z0: m.y0, x1: m.x1, z1: m.y1 } : undefined;
      },
      outlineOf: (b) => {
        const m = metas.get(b);
        return m?.outline ? { outline: m.outline, floors: m.floors } : undefined;
      },
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
    if (z === 0) {
      for (const d of col.decor ?? []) {
        if (d.kind === 'base:tree') trees.push([cx * CHUNK_SIZE + d.x, cy * CHUNK_SIZE + d.y]);
      }
    }
    const props = z === 0 ? townDecor(new MapTiles(this.loaded, 0), range, trees).props : [];
    level.loadRange(range, props);
    level.root.position.y = 0;
    this.levels.set(key(cx, cy, z), level);
    this.root.add(level.root);
    if (this.cut) level.setCutaway(this.cut);
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

  setMinute(minute: number): void {
    this.minute = minute;
    for (const l of this.levels.values()) l.setMinute(minute);
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

  constructor(
    private readonly loaded: LoadedChunks,
    private readonly town: StreamedTown | undefined,
    private readonly kit: TownKit | undefined,
  ) {
    this.root.name = 'streamed-openings';
    this.master = new OpeningsView(loaded, town?.lookup ?? new BuildingLookup(loaded, false));
  }

  loadChunk(cx: number, cy: number, z: number): void {
    if (z !== 0) return;
    const town = this.town;
    const kit = this.kit;
    const view = new OpeningsView(
      this.loaded,
      town?.lookup ?? new BuildingLookup(this.loaded, false),
      kit && town
        ? {
            kit,
            leafOf: (e) =>
              doorLeaf(town.doorSkin(e.tx, e.ty, e.z, e.side === 'n' ? 'N' : 'W') ?? 'interior'),
            onWindow: (e, state) =>
              town.setWindowBroken(e.tx, e.ty, e.z, e.side === 'n' ? 'N' : 'W', state === 'broken'),
          }
        : undefined,
    );
    view.loadRange({ cx0: cx, cy0: cy, cx1: cx, cy1: cy, z });
    view.setStates(this.lastStates);
    if (this.eventsSince.length) view.applyEvents(this.eventsSince);
    if (this.cut) view.setCutaway(this.cut);
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
