import { CHUNK_SIZE } from '@deadzone/content';
import { KIND_TYPE } from '../osm/classify.js';
import type {
  AreaKind,
  BuildingKind,
  OsmArea,
  OsmBuilding,
  OsmMap,
  OsmRoad,
  OsmWaterway,
  RoadKind,
} from '../osm/types.js';
import { oRectCorners, type ORect, type Pt } from '../world/geom.js';
import { GroundField, type Ground } from '../world/ground.js';
import {
  planWorld,
  type AreaKind as PlanAreaKind,
  type BuildingKind as PlanBuildingKind,
  type RoadClass,
  type WorldPlan,
} from '../world/plan.js';
import { GENERATOR_REV, type LandCover, type WorldPlanInput } from './plan.js';
import {
  OSM_ROTATION_DEG,
  OSM_WORLD_SIZE,
  rotatePt,
  rotation,
  straightenOsmMap,
  unrotatePt,
} from './straighten.js';

/**
 * World of the OSM square: 22 528 m = 704 × 704 chunks, so the 16 384 m square rotated by
 * `OSM_ROTATION_DEG` fits whole (shifted by `OSM_SHIFT`; corners beyond it are empty).
 */
export const OSM_WORLD_CHUNKS = OSM_WORLD_SIZE / CHUNK_SIZE;

/**
 * Window of the square around a point of the raw OSM frame, in the rotated world frame
 * (`OSM_ROTATION_DEG`): same size in chunks, centred on the rotated point; start rotated too.
 */
function rotatedRegion(
  centre: { x: number; y: number },
  halfChunks: number,
  start: { x: number; y: number },
): {
  bounds: { cx0: number; cy0: number; cx1: number; cy1: number };
  start: { x: number; y: number };
} {
  const r = rotation(OSM_ROTATION_DEG);
  const c = rotatePt(r, centre.x, centre.y);
  const s = rotatePt(r, start.x, start.y);
  const ccx = Math.round(c.x / CHUNK_SIZE);
  const ccy = Math.round(c.y / CHUNK_SIZE);
  return {
    bounds: {
      cx0: ccx - halfChunks,
      cy0: ccy - halfChunks,
      cx1: ccx + halfChunks - 1,
      cy1: ccy + halfChunks - 1,
    },
    start: { x: Math.round(s.x), y: Math.round(s.y) },
  };
}

/**
 * Named windows of the Stalowa Wola square (chunk bounds + start hint, tiles), in the rotated
 * world frame: the generator rotates the OSM data by `OSM_ROTATION_DEG` (streets on the axes).
 */
export const OSM_REGIONS = {
  /** 1.5 × 1.5 km around the KEN viaduct by ul. Okulickiego (raw frame centre 6272, 8512). */
  okulickiego: rotatedRegion({ x: 6272, y: 8512 }, 24, { x: 6290, y: 8520 }),
  /** The whole 16 × 16 km square (corners beyond the rotated square are empty). */
  all: {
    bounds: { cx0: 0, cy0: 0, cx1: OSM_WORLD_CHUNKS - 1, cy1: OSM_WORLD_CHUNKS - 1 },
    start: (() => {
      const s = rotatePt(rotation(OSM_ROTATION_DEG), 6290, 8520);
      return { x: Math.round(s.x), y: Math.round(s.y) };
    })(),
  },
};

/**
 * World plan from the OSM file (`deadzone-osm-1`). `dataHash` = hash of the file contents (any
 * data change → new generator version → old saves refuse to load, as they should).
 */
export function osmPlan(
  map: OsmMap,
  opts: {
    dataHash: string;
    bounds: WorldPlanInput['bounds'];
    start: { x: number; y: number };
    /** Region name (part of the version: other bounds = other buildings at the edge). */
    region: string;
    id?: string;
    /** Global rotation (degrees); default `OSM_ROTATION_DEG`. */
    rotationDeg?: number;
  },
): WorldPlanInput {
  const deg = opts.rotationDeg ?? OSM_ROTATION_DEG;
  const rot = deg === OSM_ROTATION_DEG ? '' : `-r${deg}`;
  return {
    id: opts.id ?? 'osm-stw',
    version: `osm-stw-${opts.dataHash.slice(0, 12)}-${opts.region}${rot}-g${GENERATOR_REV}`,
    seed: 0x05f3a1,
    size: OSM_WORLD_SIZE,
    bounds: opts.bounds,
    // Streets on the tile axes, outlines squared (no zigzag edges): `straighten.ts`.
    features: straightenOsmMap(map, deg),
    start: opts.start,
    attribution: map.attribution,
  };
}

const ROAD: Record<
  Exclude<RoadClass, 'rail'>,
  { kind: RoadKind; width: number; sidewalk: number }
> = {
  highway: { kind: 'trunk', width: 14, sidewalk: 0 },
  main: { kind: 'primary', width: 9, sidewalk: 1.5 },
  local: { kind: 'tertiary', width: 6, sidewalk: 0 },
  street: { kind: 'residential', width: 6, sidewalk: 1.5 },
  track: { kind: 'track', width: 3, sidewalk: 0 },
  path: { kind: 'path', width: 1.5, sidewalk: 0 },
};

const BUILDING: Partial<Record<PlanBuildingKind, BuildingKind>> = {
  house: 'house',
  tenement: 'block',
  apartment: 'block',
  shop: 'shop',
  office: 'office',
  farmhouse: 'house',
  barn: 'industrial',
  shed: 'shed',
  gas: 'fuel',
  hospital: 'hospital',
  police: 'police',
  fire: 'fire-station',
  barracks: 'block',
  hangar: 'industrial',
  military: 'office',
  industrial: 'industrial',
  warehouse: 'industrial',
  church: 'church',
  school: 'school',
  bar: 'shop',
  garage: 'garage',
  station: 'station',
  hut: 'shed',
};

const AREA: Partial<Record<PlanAreaKind, AreaKind>> = {
  yard: 'grass',
  farmyard: 'sand',
  park: 'park',
  plaza: 'paved',
  parking: 'parking',
  base: 'military',
  cemetery: 'cemetery',
  glade: 'meadow',
  orchard: 'orchard',
  lake: 'water',
  sports: 'pitch',
  industrial: 'industrial',
  block: 'residential',
  allotment: 'allotments',
  beach: 'sand',
  copse: 'forest',
  pond: 'water',
  marsh: 'wetland',
  wasteland: 'scrub',
  gravel: 'sand',
  lumber: 'sand',
};

const COVER: Partial<Record<Ground, AreaKind>> = {
  water: 'water',
  forest: 'forest',
  meadow: 'meadow',
  pasture: 'meadow',
  floodmeadow: 'meadow',
  hedge: 'scrub',
  wheat: 'farmland',
  rapeseed: 'farmland',
  plowed: 'farmland',
  corn: 'farmland',
  fallow: 'meadow',
};

const flat = (pts: readonly Pt[]): number[] =>
  pts.flatMap((p) => [Math.round(p.x * 10), Math.round(p.y * 10)]);
const ring = (pts: readonly Pt[]): number[] => flat([...pts, pts[0]!]);
function ellipse(r: ORect): Pt[] {
  const out: Pt[] = [];
  const c = Math.cos(r.a);
  const s = Math.sin(r.a);
  for (let i = 0; i < 28; i++) {
    const t = (i / 28) * Math.PI * 2;
    const u = (Math.cos(t) * r.w) / 2;
    const v = (Math.sin(t) * r.h) / 2;
    out.push({ x: r.x + u * c - v * s, y: r.y + u * s + v * c });
  }
  return out;
}

/** plan-4 (procedural, `tools/map/src/world/plan.ts`) as vector features of the same shape as OSM. */
export function planFeatures(plan: WorldPlan): OsmMap {
  const roads: OsmRoad[] = [];
  const rails: OsmMap['rails'] = [];
  plan.roads.forEach((r, i) => {
    if (r.cls === 'rail') rails.push({ id: i + 1, kind: 'rail', pts: flat(r.pts) });
    else roads.push({ id: i + 1, ...ROAD[r.cls], pts: flat(r.pts) });
  });
  const waterways: OsmWaterway[] = [
    { id: 1, kind: 'river', width: plan.riverWidth, name: plan.riverName, pts: flat(plan.river) },
    ...plan.waterways.map((w, i) => ({
      id: i + 2,
      kind: w.kind === 'tributary' ? ('river' as const) : ('stream' as const),
      width: w.width,
      ...(w.name ? { name: w.name } : {}),
      pts: flat(w.pts),
    })),
  ];
  const areas: OsmArea[] = [];
  plan.areas.forEach((a, i) => {
    const kind = AREA[a.kind];
    if (!kind) return;
    areas.push({
      id: i + 1,
      kind,
      ...(a.name ? { name: a.name } : {}),
      rings: [ring(a.round ? ellipse(a) : oRectCorners(a))],
    });
  });
  const buildings: OsmBuilding[] = [];
  plan.buildings.forEach((b, i) => {
    const kind = BUILDING[b.kind];
    if (!kind || b.w < 2.5 || b.h < 2.5) return;
    buildings.push({
      id: i + 1,
      type: KIND_TYPE[kind],
      kind,
      typeFrom: 'tag',
      levels: Math.max(1, Math.min(16, b.floors)),
      levelsFrom: 'tag',
      rings: [ring(oRectCorners(b))],
    });
  });
  const trees: number[] = [];
  for (const line of plan.treeLines)
    for (const p of line.pts) trees.push(Math.round(p.x * 10), Math.round(p.y * 10));
  return {
    format: 'deadzone-osm-1',
    crs: 'EPSG:32634',
    E0: 0,
    N1: 0,
    size: plan.size,
    attribution: '© współtwórcy OpenStreetMap',
    license: 'ODbL-1.0',
    source: `plan-4 seed ${plan.seed}`,
    roads,
    rails,
    waterways,
    areas,
    buildings,
    trees,
    treeRows: [],
    pois: [],
    places: plan.settlements.map((s) => ({
      name: s.name,
      kind: s.kind,
      x: Math.round(s.x * 10),
      y: Math.round(s.y * 10),
    })),
  };
}

/** plan-4 as a world plan: features from `planWorld(seed, size)`, land cover from its ground field. */
export function plan4Plan(seed: number, size = 16384): WorldPlanInput {
  const plan = planWorld({ seed, size });
  const field = new GroundField(plan);
  const cover: LandCover = (x, y) => {
    const g = field.at(x, y);
    return COVER[g];
  };
  const s = plan.settlements[plan.start] ?? plan.settlements[0];
  const n = size / CHUNK_SIZE;
  return {
    id: 'plan-4',
    version: `plan-4-s${seed}-z${size}-g${GENERATOR_REV}`,
    seed,
    size,
    bounds: { cx0: 0, cy0: 0, cx1: n - 1, cy1: n - 1 },
    features: planFeatures(plan),
    start: s ? { x: s.x, y: s.y } : { x: size / 2, y: size / 2 },
    landCover: cover,
  };
}

/**
 * Window of an OSM map for a region (static data file of a smaller playable piece): whole
 * raw-frame features whose bounding box touches the (un-rotated) region's chunk bounds +
 * `marginTiles` (no clipping, so
 * buildings and roads at the edge stay intact); all named places stay.
 */
export function cropOsmMap(
  map: OsmMap,
  bounds: { cx0: number; cy0: number; cx1: number; cy1: number },
  marginTiles = 128,
  /** Rotation of the world frame the bounds are in: the crop covers their raw-frame preimage. */
  rotationDeg = OSM_ROTATION_DEG,
): OsmMap {
  const r = rotation(rotationDeg);
  const corners = [
    [bounds.cx0 * CHUNK_SIZE - marginTiles, bounds.cy0 * CHUNK_SIZE - marginTiles],
    [(bounds.cx1 + 1) * CHUNK_SIZE + marginTiles, bounds.cy0 * CHUNK_SIZE - marginTiles],
    [bounds.cx0 * CHUNK_SIZE - marginTiles, (bounds.cy1 + 1) * CHUNK_SIZE + marginTiles],
    [(bounds.cx1 + 1) * CHUNK_SIZE + marginTiles, (bounds.cy1 + 1) * CHUNK_SIZE + marginTiles],
  ].map(([x, y]) => unrotatePt(r, x!, y!));
  const x0 = Math.min(...corners.map((c) => c.x)) * 10;
  const y0 = Math.min(...corners.map((c) => c.y)) * 10;
  const x1 = Math.max(...corners.map((c) => c.x)) * 10;
  const y1 = Math.max(...corners.map((c) => c.y)) * 10;
  const hits = (f: readonly number[]) => {
    let ax = Infinity;
    let ay = Infinity;
    let bx = -Infinity;
    let by = -Infinity;
    for (let i = 0; i + 1 < f.length; i += 2) {
      ax = Math.min(ax, f[i]!);
      bx = Math.max(bx, f[i]!);
      ay = Math.min(ay, f[i + 1]!);
      by = Math.max(by, f[i + 1]!);
    }
    return bx >= x0 && ax <= x1 && by >= y0 && ay <= y1;
  };
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const trees: number[] = [];
  for (let i = 0; i + 1 < map.trees.length; i += 2) {
    if (inside(map.trees[i]!, map.trees[i + 1]!)) trees.push(map.trees[i]!, map.trees[i + 1]!);
  }
  return {
    ...map,
    roads: map.roads.filter((r) => hits(r.pts)),
    rails: map.rails.filter((r) => hits(r.pts)),
    waterways: map.waterways.filter((w) => hits(w.pts)),
    areas: map.areas.filter((a) => hits(a.rings[0] ?? [])),
    buildings: map.buildings.filter((b) => hits(b.rings[0] ?? [])),
    trees,
    treeRows: map.treeRows.filter((r) => hits(r)),
    pois: map.pois.filter((p) => inside(p.x, p.y)),
  };
}
