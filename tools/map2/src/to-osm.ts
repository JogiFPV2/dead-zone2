/**
 * map2 road network → the client's OSM data format (`deadzone-osm-1`, integer decimetres, x east,
 * y south, (0, 0) = north-west corner of the world square), so the existing tile writer
 * (`tools/map` osm:tiles) and chunk generator serve `?map=stw2` without the old 27° rotation.
 * Kerb fillets become fans of narrow asphalt strips (corner asphalt inside the kerb arc).
 */
import type { Edge, Junction, Pt } from './graph.js';
import { MOTOR, type RoadClass } from './profile.js';

/** World square of `stw2` (m): local frame (origin KEN × Okulickiego) shifted by `OFFSET`. */
export const STW2_WORLD = 32768;
export const STW2_OFFSET: Pt = [17000, 19000];
/**
 * The tile writer and the game place raw OSM data at world = raw + 3 072 m (`OSM_SHIFT` in
 * tools/map straighten.ts: the old 16 km square centred in its 22.5 km world); stw2 data is
 * written in raw coordinates that land exactly on its world frame (rotation 0).
 */
export const OSM_RAW_SHIFT = (22528 - 16384) / 2;
/** Ids of the kerb-corner fill strips (above every edge index). */
const FILL_ID0 = 1e8;

const KIND: Record<RoadClass, string> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  residential: 'residential',
  living: 'residential',
  service: 'service',
  track: 'track',
  path: 'path',
  footway: 'footway',
  cycleway: 'cycleway',
  steps: 'steps',
};

const PLACE_KINDS = new Set([
  'city',
  'town',
  'suburb',
  'village',
  'hamlet',
  'neighbourhood',
  'quarter',
  'locality',
]);

export interface Map2Roads {
  edges: Edge[];
  junctions: Junction[];
  rivers: { id: number; name: string; pts: Pt[] }[];
  rails: { id: number; pts: Pt[] }[];
  places: { name: string; kind: string; xy: Pt }[];
}

const inWorld = (p: Pt) =>
  p[0] + STW2_OFFSET[0] >= 0 &&
  p[1] + STW2_OFFSET[1] >= 0 &&
  p[0] + STW2_OFFSET[0] < STW2_WORLD &&
  p[1] + STW2_OFFSET[1] < STW2_WORLD;

const dm = (pts: readonly Pt[]): number[] =>
  pts.flatMap((p) => [
    Math.round((p[0] + STW2_OFFSET[0] - OSM_RAW_SHIFT) * 10),
    Math.round((p[1] + STW2_OFFSET[1] - OSM_RAW_SHIFT) * 10),
  ]);

/** Lane lines across the carriageway (offsets from the axis, m; left of the way direction > 0). */
export function laneOffsets(width: number, lanes: number, oneway: boolean): number[] {
  const h = width / 2;
  const out: number[] = [];
  if (oneway) {
    for (let k = 1; k < lanes; k++) out.push(Math.round((-h + (k * width) / lanes) * 100) / 100);
    return out;
  }
  const per = Math.floor(lanes / 2);
  for (let k = 1; k < per; k++) {
    const o = Math.round(((k * h) / per) * 100) / 100;
    out.push(o, -o);
  }
  return out;
}

/**
 * One zig-zag strip from the junction centre to every point of a fillet arc and back (a fan of
 * 2 m asphalt strips filling the corner up to the kerb arc), one road per fillet.
 */
export function fan(o: Pt, arc: readonly Pt[], half = 1): Pt[] {
  // Each strip ends `half` short of the arc, so its round cap stops at the kerb line.
  const tip = (p: Pt): Pt => {
    const l = Math.hypot(p[0] - o[0], p[1] - o[1]);
    const k = l > half ? (l - half) / l : 0;
    return [o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k];
  };
  return arc.flatMap((p, i) => (i ? [tip(p), o] : [o, tip(p), o])).slice(0, -1);
}

export function toOsmMap(net: Map2Roads): Record<string, unknown> {
  const roads: Record<string, unknown>[] = [];
  for (const e of net.edges) {
    if (!e.pts.some(inWorld)) continue;
    const p = e.p;
    const motor = MOTOR.has(p.cls);
    const ll = motor ? laneOffsets(p.width, p.lanes, p.oneway !== 0) : [];
    roads.push({
      // Edge index: unique (the index drops repeated ids; a way splits into many edges).
      id: e.id + 1,
      kind: KIND[p.cls],
      width: p.width,
      sidewalk: Math.max(p.sidewalk[0], p.sidewalk[1]),
      ...(e.name ? { name: e.name } : {}),
      ...(p.bridge ? { bridge: 1 } : {}),
      ...(p.tunnel ? { tunnel: 1 } : {}),
      ...(p.layer ? { layer: p.layer } : {}),
      ...(motor && !p.centreLine ? { cl: 0 } : {}),
      ...(ll.length ? { ll } : {}),
      pts: dm(e.pts),
    });
  }
  let fid = 1;
  for (const j of net.junctions) {
    const o: Pt = [j.x, j.y];
    // Junctions with a one-way arm (dual carriageway, ramp) keep round joins only: a fan from
    // one carriageway's node would pave the median.
    if (!inWorld(o) || j.edges.some((id) => net.edges[id]!.p.oneway !== 0)) continue;
    for (const f of j.fillets)
      roads.push({
        id: FILL_ID0 + fid++,
        kind: 'service',
        width: 2,
        sidewalk: 0,
        fill: 1,
        pts: dm(fan(o, f)),
      });
  }
  const waterways = net.rivers
    .filter((r) => r.pts.some(inWorld))
    .map((r) => ({
      id: r.id,
      kind: 'river',
      width: /san|wisła/i.test(r.name) ? 60 : 12,
      ...(r.name ? { name: r.name } : {}),
      pts: dm(r.pts),
    }));
  const rails = net.rails
    .filter((r) => r.pts.some(inWorld))
    .map((r) => ({ id: r.id, kind: 'rail', pts: dm(r.pts) }));
  const places = net.places
    .filter((p) => PLACE_KINDS.has(p.kind) && inWorld(p.xy))
    .map((p) => {
      const [x, y] = dm([p.xy]);
      return { name: p.name, kind: p.kind, x: x!, y: y! };
    });
  return {
    format: 'deadzone-osm-1',
    crs: 'EPSG:32634',
    E0: 0,
    N1: 0,
    size: STW2_WORLD,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    source: 'OpenStreetMap (Geofabrik podkarpackie extract), tools/map2',
    roads,
    rails,
    power: [],
    railNodes: [],
    waterways,
    areas: [],
    buildings: [],
    trees: [],
    treeRows: [],
    pois: [],
    places,
  };
}
