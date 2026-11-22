/**
 * map2 land (`tools/map2` `pnpm land` → `deadzone-map2-land-1`, local metres, 1:1 from OSM) →
 * the ground of the client's `deadzone-osm-1` map for `?map=stw2`: areas (water, forest, parks,
 * fields, landuse… with holes) classified like the old converter (`classifyArea`), hedges as
 * scrub strips, waterways with kind and width from tags, railways of every kind (sidings, trams,
 * disused, catenary), power lines, single trees, tree rows, rail nodes and POIs. Integer
 * decimetres in the stw2 raw frame (same as `map2-buildings.ts`).
 */
import { classifyArea, type Tags } from './classify.js';
import { hedgeStrips, powerLine, streetWidth } from './convert.js';
import { OSM_RAW_SHIFT, STW2_OFFSET, STW2_WORLD } from './map2-buildings.js';
import type {
  OsmArea,
  OsmMap,
  OsmPoi,
  OsmPower,
  OsmRail,
  OsmRailNode,
  OsmWaterway,
} from './types.js';

type Pt = readonly [number, number];

/** The fields of `tools/map2` `Land2` used here. */
export interface Map2Land {
  areas: { id: number; way: boolean; ring: number; tags: Tags; outer: Pt[]; inner: Pt[][] }[];
  lines: { id: number; tags: Tags; pts: Pt[] }[];
  nodes: { id: number; tags: Tags; xy: Pt }[];
}

/** Relation areas get ids above every way id; ring k of a relation: + k · `REL_RING`. */
const REL_BASE = 1e10;
const REL_RING = 1e8;

const world = ([x, y]: Pt): Pt => [x + STW2_OFFSET[0], y + STW2_OFFSET[1]];
/** A point inside the world square plus a margin (m). */
const inWorld = (p: Pt, margin = 50): boolean => {
  const [x, y] = world(p);
  return x >= -margin && y >= -margin && x < STW2_WORLD + margin && y < STW2_WORLD + margin;
};
const dm = (v: number) => Math.round((v - OSM_RAW_SHIFT) * 10);
const flat = (pts: readonly Pt[]): number[] =>
  pts.flatMap((p) => {
    const [x, y] = world(p);
    return [dm(x), dm(y)];
  });
/** Closed flat ring (first vertex repeated at the end when OSM did not close it). */
const ring = (pts: readonly Pt[]): number[] => {
  const f = flat(pts);
  const n = f.length;
  return f[0] === f[n - 2] && f[1] === f[n - 1] ? f : [...f, f[0]!, f[1]!];
};

const RAILS = new Set(['rail', 'light_rail', 'tram', 'narrow_gauge', 'disused', 'preserved']);
const WATERWAYS = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'brook']);
/** Default widths (m) when a waterway has no `width`; the San and the Vistula are wide rivers. */
export function waterwayWidth(kind: OsmWaterway['kind'], t: Tags): number {
  const w = streetWidth(t);
  if (Number.isFinite(w) && w > 0 && w < 400) return w;
  if (kind === 'river') return /^(san|wisła)$/i.test(t.name ?? '') ? 60 : 15;
  return { canal: 8, stream: 3, ditch: 1.5 }[kind];
}

export interface Map2LandStats {
  areas: Record<string, number>;
  hedgeStrips: number;
  waterways: Record<string, number>;
  rails: Record<string, number>;
  power: number;
  trees: number;
  treeRows: number;
  railNodes: number;
  pois: number;
}

/** Ground features of the stw2 map (everything but roads, buildings and places). */
export function map2Land(
  land: Map2Land,
): Pick<
  OsmMap,
  'areas' | 'waterways' | 'rails' | 'power' | 'railNodes' | 'trees' | 'treeRows' | 'pois'
> & { stats: Map2LandStats } {
  const inc = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const stats: Map2LandStats = {
    areas: {},
    hedgeStrips: 0,
    waterways: {},
    rails: {},
    power: 0,
    trees: 0,
    treeRows: 0,
    railNodes: 0,
    pois: 0,
  };
  const areas: OsmArea[] = [];
  for (const a of land.areas) {
    const kind = classifyArea(a.tags);
    if (!kind || !a.outer.some((p) => inWorld(p))) continue;
    inc(stats.areas, kind);
    areas.push({
      id: a.way ? a.id : REL_BASE + a.ring * REL_RING + a.id,
      kind,
      ...(a.tags.name ? { name: a.tags.name } : {}),
      rings: [ring(a.outer), ...a.inner.map(ring)],
    });
  }
  const waterways: OsmWaterway[] = [];
  const rails: OsmRail[] = [];
  const power: OsmPower[] = [];
  const treeRows: number[][] = [];
  for (const l of land.lines) {
    const t = l.tags;
    if (!l.pts.some((p) => inWorld(p))) continue;
    if (t.barrier === 'hedge') {
      for (const q of hedgeStrips(l.pts)) {
        areas.push({ id: l.id, kind: 'scrub', rings: [ring(q)] });
        stats.hedgeStrips++;
      }
      continue;
    }
    const rw = t.railway;
    if (rw && RAILS.has(rw)) {
      const kind: OsmRail['kind'] =
        rw === 'tram' ? 'tram' : rw === 'disused' ? 'disused' : t.service ? 'siding' : 'rail';
      inc(stats.rails, kind);
      rails.push({
        id: l.id,
        kind,
        ...(t.bridge && t.bridge !== 'no' ? { bridge: 1 as const } : {}),
        ...(t.electrified === 'contact_line' && rw !== 'disused' ? { el: 1 as const } : {}),
        pts: flat(l.pts),
      });
      continue;
    }
    const pw = powerLine(t);
    if (pw) {
      stats.power++;
      power.push({ id: l.id, ...pw, pts: flat(l.pts) });
      continue;
    }
    const ww = t.waterway;
    if (ww && WATERWAYS.has(ww) && t.tunnel !== 'culvert') {
      const kind: OsmWaterway['kind'] =
        ww === 'drain' ? 'ditch' : ww === 'brook' ? 'stream' : (ww as OsmWaterway['kind']);
      inc(stats.waterways, kind);
      waterways.push({
        id: l.id,
        kind,
        width: waterwayWidth(kind, t),
        ...(t.name ? { name: t.name } : {}),
        pts: flat(l.pts),
      });
      continue;
    }
    if (t.natural === 'tree_row') {
      stats.treeRows++;
      treeRows.push(flat(l.pts));
    }
  }
  const trees: number[] = [];
  const pois: OsmPoi[] = [];
  const railVertex = new Set<string>();
  for (const r of rails)
    for (let i = 0; i + 1 < r.pts.length; i += 2) railVertex.add(`${r.pts[i]},${r.pts[i + 1]}`);
  const railNodes: OsmRailNode[] = [];
  for (const n of land.nodes) {
    if (!inWorld(n.xy, 0)) continue;
    const t = n.tags;
    const [x, y] = flat([n.xy]) as [number, number];
    if (t.natural === 'tree') {
      trees.push(x, y);
      stats.trees++;
      continue;
    }
    const rk = t.railway;
    if (rk === 'switch' || rk === 'buffer_stop' || rk === 'level_crossing') {
      if (railVertex.has(`${x},${y}`)) {
        railNodes.push({ kind: rk, x, y });
        stats.railNodes++;
      }
      continue;
    }
    const kind =
      t.amenity ??
      (t.highway === 'bus_stop' || t.highway === 'street_lamp' ? t.highway : undefined) ??
      (t.shop ? `shop:${t.shop}` : undefined);
    if (kind) {
      pois.push({ kind, x, y, ...(t.name ? { name: t.name } : {}) });
      stats.pois++;
    }
  }
  return { areas, waterways, rails, power, railNodes, trees, treeRows, pois, stats };
}

/** The stw2 map (roads, buildings) with the map2 ground in it. */
export function withMap2Land(map: OsmMap, land: Map2Land): { map: OsmMap; stats: Map2LandStats } {
  const { stats, ...g } = map2Land(land);
  return { map: { ...map, ...g }, stats };
}
