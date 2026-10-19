import {
  KIND_TYPE,
  classifyArea,
  classifyRoad,
  defaultLevels,
  kindFromContext,
  kindFromTags,
  levelsFromTags,
  type Tags,
} from './classify.js';
import {
  OSM_ATTRIBUTION,
  OSM_FORMAT,
  type AreaKind,
  type OsmArea,
  type OsmBuilding,
  type OsmMap,
  type OsmPlace,
  type OsmPoi,
  type OsmPower,
  type OsmRail,
  type OsmRailNode,
  type OsmRoad,
  type OsmWaterway,
} from './types.js';

/** Raw dump of `extract_osm.py` (local metres, floats). */
export interface RawOsm {
  crs: string;
  E0: number;
  N0: number;
  size: number;
  source: string;
  nodes: { id: number; p: [number, number]; t: Tags }[];
  ways: { id: number; g: [number, number][]; t: Tags }[];
  relations: {
    id: number;
    t: Tags;
    rings: { outer: [number, number][]; inner: [number, number][][] }[];
  }[];
}

type P = readonly [number, number];
const dm = (v: number) => Math.round(v * 10);
const flat = (pts: readonly P[]) => pts.flatMap(([x, y]) => [dm(x), dm(y)]);
const closed = (g: readonly P[]) =>
  g.length >= 4 && g[0]![0] === g[g.length - 1]![0] && g[0]![1] === g[g.length - 1]![1];

export function ringArea(r: readonly P[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]);
  return Math.abs(a) / 2;
}

export function pointInRing(x: number, y: number, r: readonly P[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Long side (m) and angle (rad) of the minimum-area rectangle over the ring's edge directions. */
export function orientedBox(r: readonly P[]): { long: number; short: number; angle: number } {
  let best = { area: Infinity, long: 0, short: 0, angle: 0 };
  for (let i = 1; i < r.length; i++) {
    const dx = r[i]![0] - r[i - 1]![0];
    const dy = r[i]![1] - r[i - 1]![1];
    if (dx * dx + dy * dy < 0.25) continue;
    const a = Math.atan2(dy, dx);
    const c = Math.cos(a);
    const s = Math.sin(a);
    let u0 = Infinity,
      u1 = -Infinity,
      v0 = Infinity,
      v1 = -Infinity;
    for (const [x, y] of r) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const w = u1 - u0;
    const h = v1 - v0;
    if (w * h < best.area)
      best = {
        area: w * h,
        long: Math.max(w, h),
        short: Math.min(w, h),
        angle: w >= h ? a : a + Math.PI / 2,
      };
  }
  return best;
}

/** Uniform grid over bounding boxes (spatial lookup of polygons). */
class Grid<T> {
  private cells = new Map<number, T[]>();
  constructor(private cell = 64) {}
  private key = (cx: number, cy: number) => (cx + 1000) * 4096 + (cy + 1000);
  add(item: T, x0: number, y0: number, x1: number, y1: number): void {
    for (let cy = Math.floor(y0 / this.cell); cy <= Math.floor(y1 / this.cell); cy++)
      for (let cx = Math.floor(x0 / this.cell); cx <= Math.floor(x1 / this.cell); cx++) {
        const k = this.key(cx, cy);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(item);
      }
  }
  at(x: number, y: number): readonly T[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))) ?? [];
  }
}

const bbox = (r: readonly P[]) => {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of r) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
};
const centroid = (r: readonly P[]): P => {
  const b = bbox(r);
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
};

/** Landuse kinds that give context to untyped buildings (smallest containing area wins). */
const CONTEXT: ReadonlySet<AreaKind> = new Set([
  'residential',
  'industrial',
  'commercial',
  'farmland',
  'meadow',
  'orchard',
  'allotments',
  'railway',
  'military',
]);
const POI_KEYS = ['amenity', 'shop', 'office', 'healthcare', 'craft', 'leisure'] as const;

export interface ConvertStats {
  buildings: number;
  byType: Record<string, number>;
  byKind: Record<string, number>;
  typeFrom: Record<string, number>;
  levelsFrom: Record<string, number>;
  levels: Record<string, number>;
  poisAttached: number;
}

function streetWidth(t: Tags): number {
  const w = t.width ? Number.parseFloat(t.width) : NaN;
  return Number.isFinite(w) ? w : NaN;
}

/** Raw OSM dump → compact game map (pure, deterministic for the same input). */
export function convertOsm(raw: RawOsm): { map: OsmMap; stats: ConvertStats } {
  const size = raw.size;
  const inSquare = (g: readonly P[]) =>
    g.some(([x, y]) => x >= -50 && y >= -50 && x <= size + 50 && y <= size + 50);
  const polys: { id: number; t: Tags; rings: P[][] }[] = [];
  for (const w of raw.ways)
    if (closed(w.g) && inSquare(w.g)) polys.push({ id: w.id, t: w.t, rings: [w.g] });
  for (const r of raw.relations)
    for (const ring of r.rings)
      if (inSquare(ring.outer))
        polys.push({ id: r.id, t: r.t, rings: [ring.outer, ...ring.inner] });

  // Areas (ground) and the landuse context grid.
  const areas: OsmArea[] = [];
  const ctx = new Grid<{ kind: AreaKind; ring: P[]; area: number }>(128);
  for (const p of polys) {
    if (p.t.building && p.t.building !== 'no') continue;
    const kind = classifyArea(p.t);
    if (!kind) continue;
    areas.push({
      id: p.id,
      kind,
      ...(p.t.name ? { name: p.t.name } : {}),
      rings: p.rings.map(flat),
    });
    if (CONTEXT.has(kind)) {
      const b = bbox(p.rings[0]!);
      ctx.add({ kind, ring: p.rings[0]!, area: ringArea(p.rings[0]!) }, b.x0, b.y0, b.x1, b.y1);
    }
  }

  // Hedges (`barrier=hedge`, open or closed lines): thin scrub strips per segment (cover zones).
  for (const w of raw.ways) {
    if (w.t.barrier !== 'hedge' || !inSquare(w.g)) continue;
    for (const q of hedgeStrips(w.g)) areas.push({ id: w.id, kind: 'scrub', rings: [flat(q)] });
  }

  // Buildings with POIs attached.
  const bl = polys.filter(
    (p) => p.t.building && p.t.building !== 'no' && p.t.location !== 'underground',
  );
  const bgrid = new Grid<number>(64);
  bl.forEach((p, i) => {
    const b = bbox(p.rings[0]!);
    bgrid.add(i, b.x0, b.y0, b.x1, b.y1);
  });
  const extra: Record<string, string>[] = bl.map(() => ({}));
  let poisAttached = 0;
  const poiNodes = raw.nodes.filter((n) => POI_KEYS.some((k) => n.t[k]));
  for (const n of poiNodes) {
    for (const i of bgrid.at(n.p[0], n.p[1])) {
      if (!pointInRing(n.p[0], n.p[1], bl[i]!.rings[0]!)) continue;
      const e = extra[i]!;
      for (const k of POI_KEYS) if (n.t[k] && !e[k]) e[k] = n.t[k]!;
      if (n.t.name && !e.name) e.name = n.t.name;
      poisAttached++;
      break;
    }
  }
  // Amenity areas (school grounds, hospital, fuel) tag the buildings on them.
  const amenAreas = polys.filter(
    (p) => !p.t.building && (p.t.amenity || p.t.leisure === 'sports_centre'),
  );
  const agrid = new Grid<number>(128);
  amenAreas.forEach((p, i) => {
    const b = bbox(p.rings[0]!);
    agrid.add(i, b.x0, b.y0, b.x1, b.y1);
  });

  const buildings: OsmBuilding[] = [];
  const stats: ConvertStats = {
    buildings: 0,
    byType: {},
    byKind: {},
    typeFrom: {},
    levelsFrom: {},
    levels: {},
    poisAttached,
  };
  const inc = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);
  bl.forEach((p, i) => {
    const outer = p.rings[0]!;
    const area = ringArea(outer);
    if (area < 4) return;
    const [cx, cy] = centroid(outer);
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return;
    const { long } = orientedBox(outer);
    const own: Record<string, string> = { ...p.t };
    for (const [k, v] of Object.entries(extra[i]!)) if (!own[k]) own[k] = v;
    let kind = kindFromTags(own);
    let typeFrom: OsmBuilding['typeFrom'] = 'tag';
    if (
      !kind ||
      (own.building === 'yes' && !Object.keys(extra[i]!).length && !POI_KEYS.some((k) => own[k]))
    ) {
      // building=yes: amenity area around it, else landuse + size.
      let amen: Tags | undefined;
      for (const j of agrid.at(cx, cy))
        if (pointInRing(cx, cy, amenAreas[j]!.rings[0]!)) {
          amen = amenAreas[j]!.t;
          break;
        }
      const fromAmen = amen ? kindFromTags({ building: 'yes', ...amen }) : undefined;
      if (fromAmen && area >= 60) kind = fromAmen === 'fuel' && area > 400 ? 'shop' : fromAmen;
      else if (!kind) {
        let best: { kind: AreaKind; area: number } | undefined;
        for (const c of ctx.at(cx, cy))
          if ((!best || c.area < best.area) && pointInRing(cx, cy, c.ring)) best = c;
        const r = kindFromContext(best?.kind, area, long);
        kind = r.kind;
        typeFrom = r.from;
      }
    }
    // building=residential on a small footprint: a house (villages tag them so).
    if (kind === 'block' && own.building === 'residential' && area < 250) kind = 'house';
    const tagged = levelsFromTags(own);
    const levels = kind === 'church' ? 1 : (tagged ?? defaultLevels(kind, p.id, area, long));
    const b: OsmBuilding = {
      id: p.id,
      type: KIND_TYPE[kind],
      kind,
      typeFrom,
      levels,
      levelsFrom: tagged !== undefined && kind !== 'church' ? 'tag' : 'default',
      ...(kind === 'church' || (kind === 'gym' && area > 400) ? { tall: 1 as const } : {}),
      ...(own.name ? { name: own.name } : {}),
      rings: p.rings.map(flat),
    };
    buildings.push(b);
  });
  // House + garage touching it → house-garage (the garage stays its own building).
  const hgrid = new Grid<OsmBuilding>(64);
  for (const b of buildings)
    if (b.kind === 'house') {
      const r = unflat(b.rings[0]!);
      const bb = bbox(r);
      hgrid.add(b, bb.x0, bb.y0, bb.x1, bb.y1);
    }
  for (const g of buildings) {
    if (g.kind !== 'garage') continue;
    const r = unflat(g.rings[0]!);
    if (ringArea(r) > 60) continue;
    for (const [x, y] of r) {
      const h = hgrid.at(x, y).find((hb) => nearRing(x, y, unflat(hb.rings[0]!), 1.2));
      if (h) {
        h.type = 'house-garage';
        break;
      }
    }
  }
  for (const b of buildings) {
    stats.buildings++;
    inc(stats.byType, b.type);
    inc(stats.byKind, b.kind);
    inc(stats.typeFrom, b.typeFrom);
    inc(stats.levelsFrom, b.levelsFrom);
    inc(stats.levels, String(b.levels));
  }

  const roads: OsmRoad[] = [];
  const rails: OsmRail[] = [];
  const power: OsmPower[] = [];
  const waterways: OsmWaterway[] = [];
  const treeRows: number[][] = [];
  for (const w of raw.ways) {
    const t = w.t;
    if (!inSquare(w.g)) continue;
    const rc = classifyRoad(t);
    if (rc) {
      const wt = streetWidth(t);
      roads.push({
        id: w.id,
        kind: rc.kind,
        width: Number.isFinite(wt) && wt > 1 && wt < 30 ? Math.round(wt) : rc.width,
        sidewalk: rc.sidewalk,
        ...(t.name ? { name: t.name } : {}),
        ...(t.bridge && t.bridge !== 'no' ? { bridge: 1 as const } : {}),
        ...(t.tunnel && t.tunnel !== 'no' ? { tunnel: 1 as const } : {}),
        ...(t.layer ? { layer: Number.parseInt(t.layer, 10) || 0 } : {}),
        pts: flat(w.g),
      });
      continue;
    }
    const rw = t.railway;
    if (rw && ['rail', 'light_rail', 'tram', 'narrow_gauge', 'disused', 'preserved'].includes(rw)) {
      const kind: OsmRail['kind'] =
        rw === 'tram' ? 'tram' : rw === 'disused' ? 'disused' : t.service ? 'siding' : 'rail';
      rails.push({
        id: w.id,
        kind,
        ...(t.bridge && t.bridge !== 'no' ? { bridge: 1 as const } : {}),
        ...(t.electrified === 'contact_line' && rw !== 'disused' ? { el: 1 as const } : {}),
        pts: flat(w.g),
      });
      continue;
    }
    const pw = powerLine(t);
    if (pw) {
      power.push({ id: w.id, ...pw, pts: flat(w.g) });
      continue;
    }
    const ww = t.waterway;
    if (
      ww &&
      ['river', 'stream', 'canal', 'ditch', 'drain'].includes(ww) &&
      t.tunnel !== 'culvert'
    ) {
      const kind: OsmWaterway['kind'] = ww === 'drain' ? 'ditch' : (ww as OsmWaterway['kind']);
      const wt = streetWidth(t);
      const width = Number.isFinite(wt) ? wt : { river: 30, canal: 8, stream: 3, ditch: 1.5 }[kind];
      waterways.push({
        id: w.id,
        kind,
        width,
        ...(t.name ? { name: t.name } : {}),
        pts: flat(w.g),
      });
      continue;
    }
    if (t.natural === 'tree_row') treeRows.push(flat(w.g));
  }
  const trees: number[] = [];
  const pois: OsmPoi[] = [];
  const places: OsmPlace[] = [];
  for (const n of raw.nodes) {
    const t = n.t;
    if (t.natural === 'tree') {
      trees.push(dm(n.p[0]), dm(n.p[1]));
      continue;
    }
    if (
      t.place &&
      t.name &&
      [
        'city',
        'town',
        'suburb',
        'village',
        'hamlet',
        'neighbourhood',
        'quarter',
        'locality',
      ].includes(t.place)
    ) {
      places.push({
        name: t.name,
        kind: t.place as OsmPlace['kind'],
        x: dm(n.p[0]),
        y: dm(n.p[1]),
      });
      continue;
    }
    const kind =
      t.amenity ??
      (t.highway === 'bus_stop' || t.highway === 'street_lamp' ? t.highway : undefined) ??
      (t.shop ? `shop:${t.shop}` : undefined);
    if (kind)
      pois.push({ kind, x: dm(n.p[0]), y: dm(n.p[1]), ...(t.name ? { name: t.name } : {}) });
  }
  // Fuel stations mapped as areas only: a POI at their centre.
  for (const p of polys)
    if (p.t.amenity === 'fuel') {
      const [x, y] = centroid(p.rings[0]!);
      pois.push({ kind: 'fuel', x: dm(x), y: dm(y), ...(p.t.name ? { name: p.t.name } : {}) });
    }
  // Switches, buffer stops and level crossings: rail nodes on a vertex of a kept rail.
  const railVertex = new Set<string>();
  for (const r of rails)
    for (let i = 0; i + 1 < r.pts.length; i += 2) railVertex.add(`${r.pts[i]},${r.pts[i + 1]}`);
  const railNodes: OsmRailNode[] = [];
  for (const n of raw.nodes) {
    const k = n.t.railway;
    if (k !== 'switch' && k !== 'buffer_stop' && k !== 'level_crossing') continue;
    const x = dm(n.p[0]);
    const y = dm(n.p[1]);
    if (railVertex.has(`${x},${y}`)) railNodes.push({ kind: k, x, y });
  }
  const N1 = raw.N0 + raw.size;
  return {
    map: {
      format: OSM_FORMAT,
      crs: 'EPSG:32634',
      E0: raw.E0,
      N1,
      size,
      attribution: OSM_ATTRIBUTION,
      license: 'ODbL-1.0',
      source: raw.source,
      roads,
      rails,
      power,
      railNodes,
      waterways,
      areas,
      buildings,
      trees,
      treeRows,
      pois,
      places,
    },
    stats,
  };
}

/** Power line kind and circuits of a way (`power=line` by voltage, `minor_line` = low voltage). */
export function powerLine(t: Tags): Pick<OsmPower, 'kind' | 'circuits'> | undefined {
  if (t.power !== 'line' && t.power !== 'minor_line') return undefined;
  const volts = (t.voltage ?? '')
    .split(';')
    .map((v) => Number.parseFloat(v))
    .filter((v) => Number.isFinite(v));
  const top = volts.length ? Math.max(...volts) : 0;
  const kind: OsmPower['kind'] =
    t.power === 'minor_line' || (top > 0 && top <= 1000)
      ? 'lv'
      : top >= 380_000
        ? 'hv400'
        : top >= 200_000
          ? 'hv220'
          : 'hv110';
  const circuits = Number.parseInt(t.circuits ?? '', 10);
  const cables = Number.parseInt(t.cables ?? '', 10);
  const two =
    kind !== 'lv' &&
    ((Number.isFinite(circuits) && circuits >= 2) ||
      (!Number.isFinite(circuits) && Number.isFinite(cables) && cables >= 6) ||
      volts.length >= 2);
  return { kind, circuits: two ? 2 : 1 };
}

/** Half width of a hedge strip (m): wide enough that every tile it crosses has its centre in. */
export const HEDGE_HALF_WIDTH = 0.9;

/** Closed quads (5 points) along a hedge line, one per segment, ends extended by the half width. */
export function hedgeStrips(g: readonly P[], half = HEDGE_HALF_WIDTH): P[][] {
  const out: P[][] = [];
  for (let i = 1; i < g.length; i++) {
    const [ax, ay] = g[i - 1]!;
    const [bx, by] = g[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const nx = -uy * half;
    const ny = ux * half;
    const a: P = [ax - ux * half, ay - uy * half];
    const b: P = [bx + ux * half, by + uy * half];
    const q: P[] = [
      [a[0] + nx, a[1] + ny],
      [b[0] + nx, b[1] + ny],
      [b[0] - nx, b[1] - ny],
      [a[0] - nx, a[1] - ny],
    ];
    out.push([...q, q[0]!]);
  }
  return out;
}

export function unflat(f: readonly number[]): P[] {
  const out: P[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push([f[i]! / 10, f[i + 1]! / 10]);
  return out;
}

function nearRing(x: number, y: number, r: readonly P[], d: number): boolean {
  for (let i = 1; i < r.length; i++) {
    const [ax, ay] = r[i - 1]!;
    const [bx, by] = r[i]!;
    const dx = bx - ax,
      dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    if (Math.hypot(x - ax - dx * t, y - ay - dy * t) <= d) return true;
  }
  return false;
}
