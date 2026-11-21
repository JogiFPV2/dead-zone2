/**
 * map2 buildings (`tools/map2` `pnpm buildings` → `deadzone-map2-buildings-1`, local metres, outlines
 * 1:1 from OSM) → `OsmBuilding`s of the client's `deadzone-osm-1` map for `?map=stw2`: integer
 * decimetres in the stw2 raw frame, `exact` (never squared / boxed / simplified, vector walls on the
 * OSM line), courtyards as holes, levels from `height` / `building:levels` / `building:part`,
 * shared walls drawn once (`noWall` on the higher-gid side).
 */
import {
  CONTEXT,
  Grid,
  POI_KEYS,
  bbox,
  lookTags,
  nearRing,
  orientedBox,
  pointInRing,
} from './convert.js';
import {
  KIND_TYPE,
  MAX_LEVELS,
  classifyArea,
  defaultLevels,
  kindFromContext,
  kindFromTags,
  type Tags,
} from './classify.js';
import type { Map2Land } from './map2-land.js';
import type { AreaKind, BuildingKind, OsmBuilding, OsmMap } from './types.js';

type Pt = readonly [number, number];

/** The fields of `tools/map2` `Building2` used here. */
export interface Map2Building {
  id: number;
  rel: boolean;
  ring: number;
  outer: Pt[];
  inner: Pt[][];
  shared: number[];
  sharedBy: string[];
  tags: Record<string, string>;
  levels: number;
  roofLevels: number;
  height: number;
  heightFrom: 'height' | 'levels' | 'parts' | 'default';
  area: number;
}

/**
 * stw2 frame (same numbers as `tools/map2` `to-osm.ts`, kept in sync by the stw2 tiles test): world
 * = local + `STW2_OFFSET`; raw = world − `OSM_RAW_SHIFT`; world square `STW2_WORLD`.
 */
export const STW2_OFFSET: Pt = [17000, 19000];
export const OSM_RAW_SHIFT = (22528 - 16384) / 2;
export const STW2_WORLD = 32768;

/** Relation outlines get ids above every way id; ring k of a relation: + k · `REL_RING`. */
const REL_BASE = 1e10;
const REL_RING = 1e8;

export const map2BuildingId = (b: Pick<Map2Building, 'id' | 'rel' | 'ring'>): number =>
  b.rel ? REL_BASE + b.ring * REL_RING + b.id : b.id;

/** Recesses / bumps up to about 3 m deep are smoothed out of the outlines (Paweł, 21.11.2026; was 2 m). */
export const NOTCH_DEPTH = 3.2;
/** Widest notch (chord, m) that is smoothed: longer runs are real bends, not notches. */
const NOTCH_WIDTH = 8;

const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
};
/** Turn at `b` on a → b → c below NOTCH_TURN. */
const NOTCH_TURN = (25 * Math.PI) / 180;
const straight = (a: Pt, b: Pt, c: Pt): boolean => {
  const t = Math.abs(
    Math.atan2(
      (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]),
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]),
    ),
  );
  return t < NOTCH_TURN;
};
const ringArea = (r: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
};

const cross = (a: Pt, b: Pt, c: Pt, d: Pt): Pt | undefined => {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return undefined;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  return [a[0] + rx * t, a[1] + ry * t];
};
/** Corner notch: the walls meeting there turn by at least this much. */
const CORNER_TURN = (45 * Math.PI) / 180;

interface Node {
  p: Pt;
  /** Index in the input ring, -1 for a corner made by smoothing. */
  src: number;
}

/**
 * Ring (open, no repeated first point) without its small recesses and bumps, up to NOTCH_DEPTH
 * deep and NOTCH_WIDTH wide:
 * - on a straight wall, a run of 1–3 vertices close to the chord that skips them is dropped;
 * - at a corner, a run of 1–3 vertices is replaced by the point where the two walls meeting
 *   there would cross (a cut or a stepped corner becomes a plain corner).
 * Vertices that end a shared wall (`shared`: edge k = vertex k → k + 1; the neighbour keeps those)
 * are never moved. Returns the ring and the new index of every kept edge (`-1` = gone).
 */
export function smoothRing(
  ring: readonly Pt[],
  shared: readonly number[] = [],
): { ring: Pt[]; edge: number[] } {
  let nodes: Node[] = ring.map((p, src) => ({ p, src }));
  const fixed = new Set<number>();
  for (const k of shared) {
    fixed.add(k);
    fixed.add((k + 1) % ring.length);
  }
  const isFixed = (v: Node): boolean => v.src >= 0 && fixed.has(v.src);
  const area0 = Math.abs(ringArea(ring));
  const areaOk = (next: readonly Node[]): boolean =>
    Math.abs(Math.abs(ringArea(next.map((v) => v.p))) - area0) <= area0 * 0.08;
  // Replaces nodes s+1 … s+k with `mid` (none or one corner); null when it wraps badly.
  const splice = (s: number, k: number, mid: Node[]): Node[] => {
    const n = nodes.length;
    const drop = new Set(Array.from({ length: k }, (_, j) => (s + 1 + j) % n));
    const out: Node[] = [];
    for (let i = 0; i < n; i++) {
      if (drop.has(i)) continue;
      out.push(nodes[i]!);
      if (i === s) out.push(...mid);
    }
    return out;
  };
  let changed = true;
  // Every pass drops a vertex or squares a corner; the cap only guards odd rings.
  for (let pass = 0; changed && pass < ring.length * 2; pass++) {
    changed = false;
    const n = nodes.length;
    if (n <= 4) break;
    for (let s = 0; s < n && !changed; s++) {
      for (let k = 3; k >= 0 && !changed; k--) {
        const run = Array.from({ length: k }, (_, j) => nodes[(s + 1 + j) % n]!);
        if (run.some(isFixed)) continue;
        const a = nodes[s]!;
        const d = nodes[(s + k + 1) % n]!;
        const p = nodes[(s + n - 1) % n]!.p;
        const q = nodes[(s + k + 2) % n]!.p;
        if (Math.hypot(d.p[0] - a.p[0], d.p[1] - a.p[1]) > NOTCH_WIDTH) continue;
        if (k > 0 && n - k >= 4 && straight(p, a.p, d.p) && straight(a.p, d.p, q)) {
          // On a straight wall: the walls before and after run along the chord.
          if (run.some((v) => segDist(v.p, a.p, d.p) > NOTCH_DEPTH)) continue;
          const next = splice(s, k, []);
          if (!areaOk(next)) continue;
          nodes = next;
          changed = true;
          continue;
        }
        // At a corner: wall p → a and wall d → q meet at x, which replaces a … d.
        if (n - k < 5 || isFixed(a) || isFixed(d)) continue;
        const turn = Math.abs(
          Math.atan2(
            (a.p[0] - p[0]) * (q[1] - d.p[1]) - (a.p[1] - p[1]) * (q[0] - d.p[0]),
            (a.p[0] - p[0]) * (q[0] - d.p[0]) + (a.p[1] - p[1]) * (q[1] - d.p[1]),
          ),
        );
        if (turn < CORNER_TURN) continue;
        const x = cross(p, a.p, d.p, q);
        if (!x) continue;
        // x stays on both walls (extends or trims them, never past their far end).
        const onWall = (far: Pt, near: Pt): boolean =>
          (x[0] - far[0]) * (near[0] - far[0]) + (x[1] - far[1]) * (near[1] - far[1]) > 0;
        if (!onWall(p, a.p) || !onWall(q, d.p)) continue;
        const gone = [a, ...run, d];
        if (gone.some((v) => Math.hypot(v.p[0] - x[0], v.p[1] - x[1]) > NOTCH_WIDTH)) continue;
        if (gone.some((v) => Math.min(segDist(v.p, p, x), segDist(v.p, x, q)) > NOTCH_DEPTH)) {
          continue;
        }
        // …and close to the old outline (no wing grown out of a short wall).
        const old = [p, ...gone.map((v) => v.p), q];
        let near = Infinity;
        for (let i = 0; i + 1 < old.length; i++) {
          near = Math.min(near, segDist(x, old[i]!, old[i + 1]!));
        }
        if (near > NOTCH_DEPTH) continue;
        const next = splice((s + n - 1) % n, k + 2, [{ p: x, src: -1 }]);
        if (!areaOk(next)) continue;
        nodes = next;
        changed = true;
      }
    }
  }
  // Vertices left on a straight line by a dropped notch (1 cm off the chord at most).
  for (let again = true; again;) {
    again = false;
    const n = nodes.length;
    if (n <= 3) break;
    for (let s = 0; s < n; s++) {
      const v = nodes[s]!;
      if (isFixed(v)) continue;
      const a = nodes[(s + n - 1) % n]!.p;
      const d = nodes[(s + 1) % n]!.p;
      if (segDist(v.p, a, d) < 0.01) {
        nodes = nodes.filter((_, i) => i !== s);
        again = true;
        break;
      }
    }
  }
  const pos = new Map<number, number>();
  nodes.forEach((v, i) => {
    if (v.src >= 0) pos.set(v.src, i);
  });
  const edge = ring.map((_, i) => {
    const pi = pos.get(i);
    const pj = pos.get((i + 1) % ring.length);
    return pi !== undefined && pj !== undefined && (pi + 1) % nodes.length === pj ? pi : -1;
  });
  return { ring: nodes.map((v) => v.p), edge };
}

const dmRing = (r: readonly Pt[]): number[] => {
  const out = r.flatMap(([x, y]) => [
    Math.round((x + STW2_OFFSET[0] - OSM_RAW_SHIFT) * 10),
    Math.round((y + STW2_OFFSET[1] - OSM_RAW_SHIFT) * 10),
  ]);
  return [...out, out[0]!, out[1]!];
};

/**
 * What the land around a building says about it (`tools/map2` `pnpm land`): the smallest landuse
 * area holding its centre, an amenity area holding it (school grounds, hospital, fire station,
 * bus station) and POI nodes inside its outline (shop, police, post office…).
 */
interface Context {
  landuse(x: number, y: number): AreaKind | undefined;
  amenity(x: number, y: number): Tags | undefined;
  /** POI tags inside building `i` (first value of each key wins, as the old converter). */
  pois: Map<number, Tags>;
}

function context(bs: readonly Map2Building[], land: Map2Land): Context {
  const ctx = new Grid<{ kind: AreaKind; ring: readonly Pt[]; area: number }>(128);
  const amen = new Grid<{ t: Tags; ring: readonly Pt[] }>(128);
  for (const a of land.areas) {
    if (a.tags.building && a.tags.building !== 'no') continue;
    const b = bbox(a.outer);
    const kind = classifyArea(a.tags);
    // landuse=* beats the area's own classification (landuse=residential with a name is still
    // residential; landuse=grass is not context).
    const lu = a.tags.landuse ? classifyArea({ landuse: a.tags.landuse }) : kind;
    if (lu && CONTEXT.has(lu))
      ctx.add(
        { kind: lu, ring: a.outer, area: (b.x1 - b.x0) * (b.y1 - b.y0) },
        b.x0,
        b.y0,
        b.x1,
        b.y1,
      );
    if (a.tags.amenity || a.tags.leisure === 'sports_centre')
      amen.add({ t: a.tags, ring: a.outer }, b.x0, b.y0, b.x1, b.y1);
  }
  const bgrid = new Grid<number>(64);
  bs.forEach((b, i) => {
    const r = bbox(b.outer);
    bgrid.add(i, r.x0, r.y0, r.x1, r.y1);
  });
  const pois = new Map<number, Record<string, string>>();
  for (const n of land.nodes) {
    if (!POI_KEYS.some((k) => n.tags[k])) continue;
    const [x, y] = n.xy;
    for (const i of bgrid.at(x, y)) {
      if (!pointInRing(x, y, bs[i]!.outer)) continue;
      let e = pois.get(i);
      if (!e) pois.set(i, (e = {}));
      for (const k of POI_KEYS) if (n.tags[k] && !e[k]) e[k] = n.tags[k];
      if (n.tags.name && !e.name) e.name = n.tags.name;
      break;
    }
  }
  return {
    landuse(x, y) {
      let best: { kind: AreaKind; area: number } | undefined;
      for (const c of ctx.at(x, y))
        if ((!best || c.area < best.area) && pointInRing(x, y, c.ring)) best = c;
      return best?.kind;
    },
    amenity(x, y) {
      for (const a of amen.at(x, y)) if (pointInRing(x, y, a.ring)) return a.t;
      return undefined;
    },
    pois,
  };
}

/** Kinds a POI inside may refine (an office building with a shop, a house with a pharmacy). */
const GENERIC: ReadonlySet<BuildingKind> = new Set([
  'house',
  'block',
  'kostka',
  'office',
  'industrial',
  'shed',
  'garage',
]);

/** Kind of a building from its tags, then POIs inside, the amenity area, the landuse and size. */
function kindOf(
  b: Map2Building,
  i: number,
  c: [number, number],
  long: number,
  ctx: Context | undefined,
): { kind: BuildingKind; typeFrom: OsmBuilding['typeFrom']; own: Tags } {
  const extra = ctx?.pois.get(i);
  const own: Record<string, string> = { ...b.tags };
  if (extra) for (const [k, v] of Object.entries(extra)) if (!own[k]) own[k] = v;
  // A building that says what it is (building=train_station, amenity=… on the outline) keeps
  // that; POIs inside only speak for generic outlines (a railway-guard post in a station hall).
  const self = kindFromTags(b.tags);
  let kind = self && !GENERIC.has(self) ? self : kindFromTags(own);
  let typeFrom: OsmBuilding['typeFrom'] = 'tag';
  if (!kind || (own.building === 'yes' && !extra && !POI_KEYS.some((k) => own[k]))) {
    const amen = ctx?.amenity(c[0], c[1]);
    const fromAmen = amen ? kindFromTags({ building: 'yes', ...amen }) : undefined;
    if (fromAmen && b.area >= 60) kind = fromAmen === 'fuel' && b.area > 400 ? 'shop' : fromAmen;
    else if (!kind) {
      const r = kindFromContext(ctx?.landuse(c[0], c[1]), b.area, long);
      kind = r.kind;
      typeFrom = r.from;
      // A small footprint with a house number is somebody's home, not a garage / shed (villages:
      // 35–60 m² cottages; outbuildings next to a house have no number of their own).
      if ((kind === 'garage' || kind === 'shed') && own['addr:housenumber'] && b.area >= 35)
        kind = 'house';
    }
  }
  // building=residential on a small footprint: a house (villages tag them so).
  if (kind === 'block' && own.building === 'residential' && b.area < 250) kind = 'house';
  return { kind, typeFrom, own };
}

/**
 * `land` (optional): the map2 land of the same area, so untagged buildings (`building=yes`, ~60 %
 * of the area) get their kind from POIs inside, amenity grounds and the landuse around them, like
 * the old converter does for the 16 km map.
 */
export function map2Buildings(bs: readonly Map2Building[], land?: Map2Land): OsmBuilding[] {
  const ids = new Map(bs.map((b) => [`${b.id}:${b.ring}`, map2BuildingId(b)]));
  const ctx = land ? context(bs, land) : undefined;
  const out: OsmBuilding[] = [];
  const outer = new Map<OsmBuilding, readonly Pt[]>();
  bs.forEach((b, i) => {
    if (b.area < 4) return;
    const id = map2BuildingId(b);
    let cx = 0;
    let cy = 0;
    for (const [x, y] of b.outer) {
      cx += x / b.outer.length;
      cy += y / b.outer.length;
    }
    const wx = cx + STW2_OFFSET[0];
    const wy = cy + STW2_OFFSET[1];
    if (wx < 0 || wy < 0 || wx >= STW2_WORLD || wy >= STW2_WORLD) return;
    const { long } = orientedBox([...b.outer, b.outer[0]!]);
    const { kind, typeFrom, own } = kindOf(b, i, [cx, cy], long, ctx);
    const tagged = b.heightFrom !== 'default';
    const levels =
      kind === 'church'
        ? 1
        : tagged
          ? Math.min(MAX_LEVELS, Math.max(1, b.levels))
          : defaultLevels(kind, b.id, b.area, long);
    // Small recesses / bumps smoothed (shared walls and their ends stay as the neighbour has them).
    const sm = smoothRing(b.outer, b.shared);
    const noWall = b.shared
      .filter((k, j) => {
        const by = b.sharedBy[j] ? ids.get(b.sharedBy[j]) : undefined;
        return by !== undefined && by < id;
      })
      .map((k) => sm.edge[k] ?? -1)
      .filter((k) => k >= 0);
    const ob: OsmBuilding = {
      id,
      ...(id !== b.id ? { osmId: b.id } : {}),
      type: KIND_TYPE[kind],
      kind,
      typeFrom,
      levels,
      levelsFrom: tagged && kind !== 'church' ? 'tag' : 'default',
      ...(kind === 'church' || (kind === 'gym' && b.area > 400) ? { tall: 1 as const } : {}),
      ...(own.name ? { name: own.name } : {}),
      ...lookTags(b.tags),
      ...(b.heightFrom === 'height' || b.heightFrom === 'parts' ? { height: b.height } : {}),
      rings: [dmRing(sm.ring), ...b.inner.map((r) => dmRing(smoothRing(r).ring))],
      exact: 1,
      ...(noWall.length ? { noWall } : {}),
    };
    out.push(ob);
    outer.set(ob, b.outer);
  });
  // House + garage touching it → house-garage (the garage stays its own building), as the old
  // converter does.
  const hgrid = new Grid<OsmBuilding>(64);
  for (const b of out)
    if (b.kind === 'house') {
      const r = bbox(outer.get(b)!);
      hgrid.add(b, r.x0, r.y0, r.x1, r.y1);
    }
  for (const g of out) {
    if (g.kind !== 'garage') continue;
    const r = outer.get(g)!;
    let area = 0;
    for (let k = 0; k < r.length; k++) {
      const [ax, ay] = r[k]!;
      const [bx, by] = r[(k + 1) % r.length]!;
      area += ax * by - bx * ay;
    }
    if (Math.abs(area) / 2 > 60) continue;
    for (const [x, y] of r) {
      const h = hgrid
        .at(x, y)
        .find((hb) => nearRing(x, y, [...outer.get(hb)!, outer.get(hb)![0]!], 1.2));
      if (h) {
        h.type = 'house-garage';
        break;
      }
    }
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The stw2 road map with the map2 buildings in it. */
export function withMap2Buildings(
  map: OsmMap,
  bs: readonly Map2Building[],
  land?: Map2Land,
): OsmMap {
  return { ...map, buildings: map2Buildings(bs, land) };
}
