import type { BuildingKind, OsmBuilding, OsmMap } from '../osm/types.js';

/**
 * Landmarks of `?map=stw2` (Paweł 25.11: „charakterystyczne miejsca mają być rozpoznawalne”).
 *
 * Two parts:
 * - `STW2_MARKS`: tall structures OSM maps as `man_made` (factory chimneys, water towers, silos,
 *   bell towers) and the Ty2 steam engine at Rozwadów station. The stw2 tiles keep no `man_made`
 *   tag, so the generator drew them as ordinary buildings: the 120 m chimney of the CHP plant was
 *   a 16-storey box with windows. Their building is dropped from the plan (`applyLandmarks`) and
 *   the chunk holding the mark gets a `GenMark` (game: `world/landmarks/mark-layer.ts`).
 * - `STW2_BUILDINGS`: per-building corrections by OSM way id (kind, floors, colour) where the
 *   automatic classification is wrong (St Florian's wooden church was a 9-floor block of flats).
 *
 * Data: `man_made` features and their `height` from the Geofabrik podkarpackie extract
 * (2026-11-19), positions = the stw2 world frame of `tools/map2` (local + STW2_OFFSET, metres).
 * Heights without a tag are typical values (marked `h0`). © OpenStreetMap contributors, ODbL.
 */
export type MarkKind = 'chimney' | 'water-tower' | 'silo' | 'bell-tower' | 'steam-engine';

export interface LandmarkMark {
  /** OSM element (`n` node / `w` way), for checks and credits. */
  osm: `${'n' | 'w'}${number}`;
  kind: MarkKind;
  /** Centre, stw2 world metres. */
  x: number;
  y: number;
  /** Footprint radius (m) from the OSM outline; nodes: a typical size. */
  r: number;
  /** Height (m): OSM `height` when tagged. */
  h: number;
  /** `h` is a typical value (no OSM `height`). */
  h0?: 1;
  /** Yaw (rad) of oriented models (steam engine: along the platform). */
  rot?: number;
}

/** A mark in a chunk (`GenColumn.marks`, render only; world metres). */
export interface GenMark {
  kind: MarkKind;
  x: number;
  y: number;
  r: number;
  h: number;
  rot?: number;
  /** Stable seed (colour bands, details). */
  seed: number;
}

/** Half length (m) of the Ty2 engine with its tender (22.5 m over buffers). */
export const ENGINE_HALF = 11.2;
/** Half width (m) of the engine (gauge 1435 mm, body ≈ 3.1 m). */
export const ENGINE_HALF_W = 1.6;

/** Typical heights (m) of untagged structures. */
const H0: Record<MarkKind, number> = {
  chimney: 30,
  'water-tower': 25,
  silo: 18,
  'bell-tower': 11,
  'steam-engine': 4.5,
};
/** Typical radii (m) of OSM nodes (no outline). */
const R0: Record<MarkKind, number> = {
  chimney: 1.6,
  'water-tower': 4.5,
  silo: 2.5,
  'bell-tower': 2.5,
  'steam-engine': 1.6,
};

const m = (
  osm: LandmarkMark['osm'],
  kind: MarkKind,
  x: number,
  y: number,
  r: number,
  h?: number,
  rot?: number,
): LandmarkMark => ({
  osm,
  kind,
  x,
  y,
  r: r || R0[kind],
  h: h ?? H0[kind],
  ...(h === undefined ? { h0: 1 as const } : {}),
  ...(rot !== undefined ? { rot } : {}),
});

/** Generated from the extract (tools: see the module doc), sorted by kind. */
export const STW2_MARKS: readonly LandmarkMark[] = [
  // Elektrociepłownia / Elektrownia Stalowa Wola (EC): two tall stacks and smaller ones.
  m('w306373763', 'chimney', 18783.6, 22148.3, 5.7, 120),
  m('w306373762', 'chimney', 18835.5, 22212, 5.8, 95),
  m('w677099942', 'chimney', 18923.5, 22395.7, 3.8, 58),
  m('w1456861497', 'chimney', 16905.4, 22020.7, 1.6, 59),
  m('n13361132157', 'chimney', 16278.3, 22390.9, 0, 40),
  m('n13361174189', 'chimney', 16656.3, 22103.7, 0, 30),
  m('n13361174190', 'chimney', 16649.6, 22106.1, 0, 34),
  m('n2958502307', 'chimney', 2113.9, 18716.2, 0),
  m('n12742102385', 'chimney', 1484, 10325.9, 0),
  m('w1431241098', 'chimney', 23482.4, 29098.2, 1.6),
  m('w1456863475', 'water-tower', 17210.9, 22174.3, 4.7, 32),
  m('w1154013465', 'water-tower', 15336.1, 17088.3, 6.5),
  m('w439951625', 'water-tower', 18316.8, 7005.1, 5.6),
  m('n14339603233', 'water-tower', 16114.2, 22511.4, 0),
  m('n14339603234', 'silo', 16104.8, 22518.5, 0),
  m('n14339603235', 'silo', 16108.8, 22517.2, 0),
  m('n14339603238', 'silo', 16111.1, 22522.8, 0),
  m('n14346044070', 'silo', 16012.5, 23490.7, 0),
  m('n14346044071', 'silo', 16018.5, 23489.2, 0),
  m('n14346044072', 'silo', 16024.3, 23487.3, 0),
  m('w541008395', 'silo', 5935.1, 23306, 3.1),
  m('w541008396', 'silo', 5931.4, 23300.5, 3.1),
  m('w541008397', 'silo', 5927.9, 23294.9, 3.1),
  m('w541008398', 'silo', 5924.4, 23289, 3.1),
  m('w541008399', 'silo', 5919.1, 23280.9, 3.1),
  m('w541008400', 'silo', 5915.8, 23275, 3.1),
  m('w541008401', 'silo', 5912.2, 23269.7, 3.1),
  m('w541008402', 'silo', 5908.7, 23263.9, 3.1),
  m('w546346632', 'silo', 8490.5, 19708.3, 4.2),
  m('w546346634', 'silo', 8484.9, 19715.2, 4.2),
  m('w920263382', 'silo', 1801.9, 26281.4, 4.4),
  m('w920263383', 'silo', 1786.8, 26244, 5.6),
  m('w920263384', 'silo', 1774.7, 26256, 5.1),
  // St Florian's wooden belfry (Centrum), others in the villages.
  m('w1424946349', 'bell-tower', 17589.1, 20464.8, 3.6),
  m('w541023496', 'bell-tower', 12933.3, 28366.9, 3.1),
  m('w1116317208', 'bell-tower', 24982.4, 26699.4, 4.3),
  // Ty2-16 by the platform of Stalowa Wola Rozwadów (tourism=attraction node); parallel to the
  // nearest siding (58° in the world x/y frame). `rot`: long axis = (cos, sin) in world x, y.
  m('n5167018268', 'steam-engine', 16249.6, 18064.8, 0, undefined, 1.01),
];

/** Correction of one building (OSM way / relation id → fields of `OsmBuilding`). */
export interface BuildingFix {
  /** What the building is (for the reader). */
  note: string;
  kind?: BuildingKind;
  levels?: number;
  colour?: string;
  roofColour?: string;
  roofShape?: string;
  /** Wall content (e.g. `base:wall-plank` for log walls). */
  wall?: string;
  /** Tall single storey (church nave): gets a tower when it is a church. */
  tall?: 1 | 0;
}

/** Wooden log walls (St Florian, 1802, larch / pine logs, dark brown). */
const LOG = '#6b4a32';

export const STW2_BUILDINGS: Readonly<Record<number, BuildingFix>> = {
  // building=yes, historic=building, start_date=1802 + bell tower next to it: one-storey log
  // church, not a 9-floor block. No tower of its own (the belfry stands apart).
  291342206: {
    note: 'Kościół św. Floriana, drewniany (1802)',
    kind: 'church',
    levels: 1,
    colour: LOG,
    wall: 'base:wall-plank',
    roofShape: 'gabled',
    tall: 0,
  },
  // Dom Gościnny „Hutnik” (art déco, 1938–48): two storeys, flat roof on pillars (Wikipedia,
  // szlak COP).
  359173119: { note: 'Hotel Hutnik (art déco)', kind: 'office', levels: 2, roofShape: 'flat' },
  // Relation 2732840: a plain building (building=yes, address only) taken for a church.
  2732840: { note: 'Budynek przy Siedlanowskiego 3', kind: 'shop' },
  // Former synagogue in Rozwadów (1910): a prayer house, not a house.
  359595404: { note: 'Dawna synagoga w Rozwadowie', kind: 'church', tall: 0 },
  // Lubomirski palace (Muzeum Regionalne, Sandomierska 1): museum rooms, not a family house.
  359594171: { note: 'Pałac Lubomirskich (Muzeum Regionalne)', kind: 'office', levels: 2 },
};

/** Building ids replaced by a mark (their OSM way is the mark's outline). */
const MARK_WAYS: ReadonlySet<number> = new Set(
  STW2_MARKS.filter((k) => k.osm.startsWith('w')).map((k) => Number(k.osm.slice(1))),
);

function fixBuilding(b: OsmBuilding): OsmBuilding {
  const f = STW2_BUILDINGS[b.osmId ?? b.id];
  if (!f) return b;
  const out: OsmBuilding = { ...b };
  if (f.kind) out.kind = f.kind;
  if (f.levels) out.levels = f.levels;
  if (f.colour) out.colour = f.colour;
  if (f.roofColour) out.roofColour = f.roofColour;
  if (f.roofShape) out.roofShape = f.roofShape;
  if (f.wall) out.wall = f.wall;
  if (f.tall === 1) out.tall = 1;
  else if (f.tall === 0) delete out.tall;
  return out;
}

/**
 * stw2 tile → the same tile with the landmark fixes: corrected buildings, structures that are
 * marks taken out of the buildings. Other maps pass through untouched.
 */
export function applyLandmarks(map: OsmMap, mapId: string | undefined): OsmMap {
  if (mapId !== 'stw2') return map;
  return {
    ...map,
    buildings: map.buildings.filter((b) => !MARK_WAYS.has(b.osmId ?? b.id)).map(fixBuilding),
  };
}

/** Marks whose centre lies in chunk (cx, cy) of size C (m). */
export function chunkMarks(mapId: string, cx: number, cy: number, C: number): GenMark[] {
  if (mapId !== 'stw2') return [];
  const x0 = cx * C;
  const y0 = cy * C;
  const out: GenMark[] = [];
  STW2_MARKS.forEach((k, i) => {
    if (k.x < x0 || k.x >= x0 + C || k.y < y0 || k.y >= y0 + C) return;
    out.push({
      kind: k.kind,
      x: k.x,
      y: k.y,
      r: k.r,
      h: k.h,
      ...(k.rot !== undefined ? { rot: k.rot } : {}),
      seed: i + 1,
    });
  });
  return out;
}

/**
 * Sim blockers (`SimChunk.blockers`, chunk-local metres) of the marks of a chunk: the square
 * around each solid base (a steam engine: the box around its rotated body), clipped to the chunk.
 */
export function markBlockers(
  marks: readonly GenMark[],
  X0: number,
  Y0: number,
  C: number,
): { x0: number; y0: number; x1: number; y1: number }[] {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return marks.map((k) => {
    const c = Math.abs(Math.cos(k.rot ?? 0));
    const sn = Math.abs(Math.sin(k.rot ?? 0));
    const engine = k.kind === 'steam-engine';
    const ex = engine ? ENGINE_HALF * c + ENGINE_HALF_W * sn : k.r;
    const ey = engine ? ENGINE_HALF * sn + ENGINE_HALF_W * c : k.r;
    return {
      x0: r2(Math.max(0, k.x - ex - X0)),
      y0: r2(Math.max(0, k.y - ey - Y0)),
      x1: r2(Math.min(C, k.x + ex - X0)),
      y1: r2(Math.min(C, k.y + ey - Y0)),
    };
  });
}
