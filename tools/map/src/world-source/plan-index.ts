import type { AreaKind, OsmBuilding, RoadKind } from '../osm/types.js';
import { dm, type WorldPlanInput } from './plan.js';

/** Grid cell of the spatial index (tiles). */
export const INDEX_CELL = 64;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface IRoad {
  kind: RoadKind;
  /** Carriageway half width (≥ 0.75). */
  r: number;
  /** Sidewalk outer radius (0 = none). */
  rs: number;
  bridge: boolean;
  pts: Float64Array;
}
export interface IRail {
  bridge: boolean;
  pts: Float64Array;
}
export interface IWater {
  r: number;
  pts: Float64Array;
}
export interface IArea {
  kind: AreaKind;
  /** Paint order (AREA_ORDER rank). */
  rank: number;
  rings: Float64Array[];
}
export interface IBuilding {
  /** Map-global building id (1-based index in OSM id order). */
  gid: number;
  b: OsmBuilding;
  rings: Float64Array[];
  box: Box;
}

/** Paint order of areas (later wins), as in the OSM scene. */
export const AREA_ORDER: readonly AreaKind[] = [
  'farmland',
  'meadow',
  'residential',
  'commercial',
  'industrial',
  'military',
  'railway',
  'construction',
  'orchard',
  'allotments',
  'cemetery',
  'grass',
  'park',
  'scrub',
  'forest',
  'wetland',
  'sand',
  'pitch',
  'paved',
  'fuel',
  'parking',
  'water',
];
export const ROAD_ORDER: readonly RoadKind[] = [
  'track',
  'path',
  'footway',
  'cycleway',
  'steps',
  'service',
  'residential',
  'tertiary',
  'secondary',
  'primary',
  'trunk',
  'motorway',
];

function boxOf(rings: readonly Float64Array[] | Float64Array, pad = 0): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const list: readonly Float64Array[] = rings instanceof Float64Array ? [rings] : rings;
  for (const r of list) {
    for (let i = 0; i + 1 < r.length; i += 2) {
      const x = r[i] ?? 0;
      const y = r[i + 1] ?? 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** Uniform grid of feature indices (one list per cell), queried by box; results in list order. */
class Grid<T> {
  private readonly cells = new Map<number, number[]>();
  readonly items: T[] = [];
  readonly boxes: Box[] = [];
  private stamp: Uint32Array = new Uint32Array(0);
  private gen = 0;

  add(item: T, box: Box): void {
    const i = this.items.push(item) - 1;
    this.boxes.push(box);
    for (let cy = Math.floor(box.y0 / INDEX_CELL); cy <= Math.floor(box.y1 / INDEX_CELL); cy++)
      for (let cx = Math.floor(box.x0 / INDEX_CELL); cx <= Math.floor(box.x1 / INDEX_CELL); cx++) {
        const k = cy * 65536 + cx;
        const l = this.cells.get(k);
        if (l) l.push(i);
        else this.cells.set(k, [i]);
      }
  }

  /** Indices of items whose box overlaps `q`, ascending (= insertion order). */
  query(q: Box): number[] {
    if (this.stamp.length < this.items.length) this.stamp = new Uint32Array(this.items.length);
    const g = ++this.gen;
    const out: number[] = [];
    for (let cy = Math.floor(q.y0 / INDEX_CELL); cy <= Math.floor(q.y1 / INDEX_CELL); cy++)
      for (let cx = Math.floor(q.x0 / INDEX_CELL); cx <= Math.floor(q.x1 / INDEX_CELL); cx++) {
        for (const i of this.cells.get(cy * 65536 + cx) ?? []) {
          if (this.stamp[i] === g) continue;
          this.stamp[i] = g;
          const b = this.boxes[i]!;
          if (b.x1 < q.x0 || b.x0 > q.x1 || b.y1 < q.y0 || b.y0 > q.y1) continue;
          out.push(i);
        }
      }
    return out.sort((a, b) => a - b);
  }
}

/**
 * Spatial index of a world plan (built once per source, cheap): roads, rails, waterways, areas,
 * buildings, trees and POIs in a 64 m grid, coordinates decoded to tiles. Everything the chunk
 * generator reads goes through `query*` (results in a fixed order: same output for any window).
 */
export class PlanIndex {
  readonly roads = new Grid<IRoad>();
  readonly rails = new Grid<IRail>();
  readonly waters = new Grid<IWater>();
  readonly areas = new Grid<IArea>();
  readonly buildings = new Grid<IBuilding>();
  /** Single trees and avenue trees (x, y in tiles). */
  readonly trees = new Grid<[number, number]>();
  readonly pois = new Grid<{ kind: string; x: number; y: number; name?: string | undefined }>();

  constructor(readonly plan: WorldPlanInput) {
    const f = plan.features;
    // Areas in paint order (rank, then file order): query results are already sorted.
    const areas = f.areas
      .map((a, i) => ({ a, i, rank: AREA_ORDER.indexOf(a.kind) }))
      .filter((e) => e.rank >= 0)
      .sort((p, q) => p.rank - q.rank || p.i - q.i);
    for (const { a, rank } of areas) {
      const rings = a.rings.map(dm);
      this.areas.add({ kind: a.kind, rank, rings }, boxOf(rings));
    }
    for (const w of f.waterways) {
      const pts = dm(w.pts);
      const r = Math.max(1, w.width / 2);
      this.waters.add({ r, pts }, boxOf(pts, r + 1));
    }
    for (const r of f.rails) {
      if (r.kind === 'disused') continue;
      const pts = dm(r.pts);
      this.rails.add({ bridge: !!r.bridge, pts }, boxOf(pts, 3));
    }
    const roads = f.roads
      .map((r, i) => ({ r, i, rank: ROAD_ORDER.indexOf(r.kind) }))
      .filter((e) => e.rank >= 0 && !e.r.tunnel)
      .sort((p, q) => Number(!!p.r.bridge) - Number(!!q.r.bridge) || p.rank - q.rank || p.i - q.i);
    for (const { r } of roads) {
      const pts = dm(r.pts);
      const half = Math.max(0.75, r.width / 2);
      const rs = r.sidewalk > 0 ? r.width / 2 + r.sidewalk : 0;
      this.roads.add(
        { kind: r.kind, r: half, rs, bridge: !!r.bridge, pts },
        boxOf(pts, Math.max(half, rs) + 1),
      );
    }
    const sorted = [...f.buildings].sort((a, b) => a.id - b.id);
    sorted.forEach((b, i) => {
      const rings = b.rings.map(dm);
      this.buildings.add({ gid: i + 1, b, rings, box: boxOf(rings) }, boxOf(rings));
    });
    for (let i = 0; i + 1 < f.trees.length; i += 2) {
      const x = f.trees[i]! / 10;
      const y = f.trees[i + 1]! / 10;
      this.trees.add([x, y], { x0: x, y0: y, x1: x, y1: y });
    }
    for (const row of f.treeRows) {
      const p = dm(row);
      for (let k = 2; k + 1 < p.length; k += 2) {
        const ax = p[k - 2]!;
        const ay = p[k - 1]!;
        const bx = p[k]!;
        const by = p[k + 1]!;
        const l = Math.hypot(bx - ax, by - ay);
        for (let d = 0; d < l; d += 7) {
          const x = ax + ((bx - ax) * d) / l;
          const y = ay + ((by - ay) * d) / l;
          this.trees.add([x, y], { x0: x, y0: y, x1: x, y1: y });
        }
      }
    }
    for (const p of f.pois) {
      const x = p.x / 10;
      const y = p.y / 10;
      this.pois.add({ kind: p.kind, x, y, name: p.name }, { x0: x, y0: y, x1: x, y1: y });
    }
  }
}
