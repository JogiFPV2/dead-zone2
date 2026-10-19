import type { AreaKind, OsmBuilding, RoadKind } from '../osm/types.js';
import { dm, type PlanFeatures, type WorldPlanInput } from './plan.js';

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
  /** OSM id (infra: track ends and switches between rails). */
  id: number;
  /** Electrified (`contact_line`): catenary. */
  el: boolean;
  /** Siding / spur (`service=*`): a dead end gets a buffer stop. */
  siding: boolean;
  pts: Float64Array;
}
export interface IPower {
  id: number;
  kind: 'hv110' | 'hv220' | 'hv400' | 'lv';
  circuits: 1 | 2;
  pts: Float64Array;
}
export interface IRailNode {
  kind: 'switch' | 'buffer_stop' | 'level_crossing';
  x: number;
  y: number;
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
  /** Sort key of each item (query order); insertion index unless given. */
  private readonly order: number[] = [];
  private sorted = true;
  private stamp: Uint32Array = new Uint32Array(0);
  private gen = 0;

  add(item: T, box: Box, order?: number): void {
    const i = this.items.push(item) - 1;
    this.boxes.push(box);
    const o = order ?? i;
    if (this.order.length && o < this.order[this.order.length - 1]!) this.sorted = false;
    this.order.push(o);
    for (let cy = Math.floor(box.y0 / INDEX_CELL); cy <= Math.floor(box.y1 / INDEX_CELL); cy++)
      for (let cx = Math.floor(box.x0 / INDEX_CELL); cx <= Math.floor(box.x1 / INDEX_CELL); cx++) {
        const k = cy * 65536 + cx;
        const l = this.cells.get(k);
        if (l) l.push(i);
        else this.cells.set(k, [i]);
      }
  }

  /** All item indices in query order. */
  ordered(): number[] {
    const idx = this.items.map((_, i) => i);
    if (this.sorted) return idx;
    const o = this.order;
    return idx.sort((a, b) => o[a]! - o[b]! || a - b);
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
    if (this.sorted) return out.sort((a, b) => a - b);
    // Items added out of order (lazily loaded OSM tiles): by key, so the result does not depend
    // on which tile came first.
    const o = this.order;
    return out.sort((a, b) => o[a]! - o[b]! || a - b);
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
  readonly power = new Grid<IPower>();
  readonly railNodes = new Grid<IRailNode>();
  readonly waters = new Grid<IWater>();
  readonly areas = new Grid<IArea>();
  readonly buildings = new Grid<IBuilding>();
  /** Single trees and avenue trees (x, y in tiles). */
  readonly trees = new Grid<[number, number]>();
  readonly pois = new Grid<{ kind: string; x: number; y: number; name?: string | undefined }>();

  /** Features already indexed, by layer and id (lazily loaded tiles repeat edge features). */
  private readonly seen = new Set<string>();

  constructor(readonly plan: WorldPlanInput) {
    this.addFeatures(plan.features);
  }

  /**
   * Adds features (the whole plan, or one lazily loaded OSM tile). Ordered features carry their
   * global rank in the full file (`ord`, building `gid`), so query results do not depend on load
   * order; without them the file order is used (the whole plan at once).
   */
  addFeatures(f: PlanFeatures): void {
    const fresh = (layer: string, id: number) => {
      const k = `${layer}${id}`;
      if (this.seen.has(k)) return false;
      this.seen.add(k);
      return true;
    };
    // Areas in paint order (rank, then file order).
    f.areas.forEach((a, i) => {
      const rank = AREA_ORDER.indexOf(a.kind);
      // Key = file rank: a multipolygon's outer rings are separate areas with one OSM id.
      if (rank < 0 || !fresh(`a${a.part ?? ''}:`, a.ord ?? i)) return;
      const rings = a.rings.map(dm);
      this.areas.add({ kind: a.kind, rank, rings }, boxOf(rings), rank * 1e7 + (a.ord ?? i));
    });
    f.waterways.forEach((w, i) => {
      if (!fresh(`w${w.part ?? ''}:`, w.ord ?? i)) return;
      const pts = dm(w.pts);
      const r = Math.max(1, w.width / 2);
      this.waters.add({ r, pts }, boxOf(pts, r + 1), w.ord ?? i);
    });
    f.rails.forEach((r, i) => {
      if (r.kind === 'disused' || !fresh('r', r.id)) return;
      const pts = dm(r.pts);
      this.rails.add(
        { bridge: !!r.bridge, id: r.id, el: !!r.el, siding: r.kind === 'siding', pts },
        boxOf(pts, 3),
        r.ord ?? i,
      );
    });
    (f.power ?? []).forEach((w, i) => {
      if (!fresh('p', w.id)) return;
      const pts = dm(w.pts);
      this.power.add(
        { id: w.id, kind: w.kind, circuits: w.circuits, pts },
        boxOf(pts, 8),
        w.ord ?? i,
      );
    });
    for (const n of f.railNodes ?? []) {
      const x = n.x / 10;
      const y = n.y / 10;
      if (!fresh(`n${n.kind}:`, Math.round(y * 10) * 1e6 + Math.round(x * 10))) continue;
      this.railNodes.add(
        { kind: n.kind, x, y },
        { x0: x, y0: y, x1: x, y1: y },
        Math.round(y * 10) * 1e6 + Math.round(x * 10),
      );
    }
    f.roads.forEach((r, i) => {
      const rank = ROAD_ORDER.indexOf(r.kind);
      if (rank < 0 || r.tunnel || !fresh('h', r.id)) return;
      const pts = dm(r.pts);
      const half = Math.max(0.75, r.width / 2);
      const rs = r.sidewalk > 0 ? r.width / 2 + r.sidewalk : 0;
      this.roads.add(
        { kind: r.kind, r: half, rs, bridge: !!r.bridge, pts },
        boxOf(pts, Math.max(half, rs) + 1),
        Number(!!r.bridge) * 1e9 + rank * 1e7 + (r.ord ?? i),
      );
    });
    // Building ids: rank in OSM id order over the whole file (`gid` from the tile writer).
    const byId = f.buildings.some((b) => b.gid === undefined)
      ? new Map([...f.buildings].sort((a, b) => a.id - b.id).map((b, i) => [b.id, i + 1]))
      : undefined;
    for (const b of f.buildings) {
      if (!fresh('b', b.id)) continue;
      const gid = b.gid ?? byId!.get(b.id)!;
      const rings = b.rings.map(dm);
      this.buildings.add({ gid, b, rings, box: boxOf(rings) }, boxOf(rings), gid);
    }
    // Points: ordered by position (a tree / POI lives in exactly one tile).
    const pt = (x: number, y: number) => Math.round(y * 10) * 1e6 + Math.round(x * 10);
    for (let i = 0; i + 1 < f.trees.length; i += 2) {
      const x = f.trees[i]! / 10;
      const y = f.trees[i + 1]! / 10;
      this.trees.add([x, y], { x0: x, y0: y, x1: x, y1: y }, pt(x, y));
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
          this.trees.add([x, y], { x0: x, y0: y, x1: x, y1: y }, pt(x, y));
        }
      }
    }
    for (const p of f.pois) {
      const x = p.x / 10;
      const y = p.y / 10;
      this.pois.add({ kind: p.kind, x, y, name: p.name }, { x0: x, y0: y, x1: x, y1: y }, pt(x, y));
    }
  }
}
