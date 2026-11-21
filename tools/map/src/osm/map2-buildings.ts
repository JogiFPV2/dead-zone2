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
    const noWall = b.shared.filter((k, j) => {
      const by = b.sharedBy[j] ? ids.get(b.sharedBy[j]) : undefined;
      return by !== undefined && by < id;
    });
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
      rings: [dmRing(b.outer), ...b.inner.map(dmRing)],
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
