/**
 * map2 buildings (`tools/map2` `pnpm buildings` → `deadzone-map2-buildings-1`, local metres, outlines
 * 1:1 from OSM) → `OsmBuilding`s of the client's `deadzone-osm-1` map for `?map=stw2`: integer
 * decimetres in the stw2 raw frame, `exact` (never squared / boxed / simplified, vector walls on the
 * OSM line), courtyards as holes, levels from `height` / `building:levels` / `building:part`,
 * shared walls drawn once (`noWall` on the higher-gid side).
 */
import { orientedBox, lookTags } from './convert.js';
import { KIND_TYPE, MAX_LEVELS, defaultLevels, kindFromContext, kindFromTags } from './classify.js';
import type { OsmBuilding, OsmMap } from './types.js';

type Pt = [number, number];

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

export function map2Buildings(bs: readonly Map2Building[]): OsmBuilding[] {
  const ids = new Map(bs.map((b) => [`${b.id}:${b.ring}`, map2BuildingId(b)]));
  const out: OsmBuilding[] = [];
  for (const b of bs) {
    if (b.area < 4) continue;
    const id = map2BuildingId(b);
    let cx = 0;
    let cy = 0;
    for (const [x, y] of b.outer) {
      cx += x / b.outer.length;
      cy += y / b.outer.length;
    }
    const wx = cx + STW2_OFFSET[0];
    const wy = cy + STW2_OFFSET[1];
    if (wx < 0 || wy < 0 || wx >= STW2_WORLD || wy >= STW2_WORLD) continue;
    const { long } = orientedBox([...b.outer, b.outer[0]!]);
    const t = b.tags;
    let kind = kindFromTags(t);
    let typeFrom: OsmBuilding['typeFrom'] = 'tag';
    if (!kind) {
      const r = kindFromContext(undefined, b.area, long);
      kind = r.kind;
      typeFrom = r.from;
    }
    if (kind === 'block' && t.building === 'residential' && b.area < 250) kind = 'house';
    const tagged = b.heightFrom !== 'default';
    const levels =
      kind === 'church'
        ? 1
        : tagged
          ? Math.min(MAX_LEVELS, Math.max(1, b.levels))
          : defaultLevels(kind, b.id, b.area, long);
    const noWall = b.shared.filter((k, i) => {
      const by = b.sharedBy[i] ? ids.get(b.sharedBy[i]) : undefined;
      return by !== undefined && by < id;
    });
    out.push({
      id,
      ...(id !== b.id ? { osmId: b.id } : {}),
      type: KIND_TYPE[kind],
      kind,
      typeFrom,
      levels,
      levelsFrom: tagged && kind !== 'church' ? 'tag' : 'default',
      ...(kind === 'church' || (kind === 'gym' && b.area > 400) ? { tall: 1 as const } : {}),
      ...(t.name ? { name: t.name } : {}),
      ...lookTags(t),
      ...(b.heightFrom === 'height' || b.heightFrom === 'parts' ? { height: b.height } : {}),
      rings: [dmRing(b.outer), ...b.inner.map(dmRing)],
      exact: 1,
      ...(noWall.length ? { noWall } : {}),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** The stw2 road map with the map2 buildings in it. */
export function withMap2Buildings(map: OsmMap, bs: readonly Map2Building[]): OsmMap {
  return { ...map, buildings: map2Buildings(bs) };
}
