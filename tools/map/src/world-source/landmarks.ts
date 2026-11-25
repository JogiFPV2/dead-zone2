import type { BuildingKind, BuildingType, OsmBuilding, OsmMap } from '../osm/types.js';

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
  /**
   * Catalogue type: the renderer keeps the fixed skin of catalogue types (school, hospital…), so a
   * building whose wall colour we set must not be one (`kostka` takes the colour).
   */
  type?: BuildingType;
  levels?: number;
  colour?: string;
  roofColour?: string;
  roofShape?: string;
  /** Wall content (e.g. `base:wall-plank` for log walls). */
  wall?: string;
  /** Tall single storey (church nave): gets a tower when it is a church. */
  tall?: 1 | 0;
}

/**
 * Plastered walls: the renderer tints the `plaster` skin with the building's wall colour; office
 * and school walls keep a fixed skin, so a fix with `colour` needs this wall.
 */
const PLASTER = 'base:plaster-wall';

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
  // Hotel Hutnik (zdjęcie z Google Maps, 25.11): trzy kondygnacje, tynk w kolorze przybrudzonego
  // różu, płaski dach z okapem, galeria na filarach wzdłuż frontu, neon HUTNIK na dachu.
  359173119: {
    note: 'Hotel Hutnik',
    kind: 'office',
    wall: PLASTER,
    levels: 3,
    colour: '#b7a0a2',
    roofShape: 'flat',
  },
  // Dawna Dyrekcja HSW, dziś Urząd Miasta (Kwiatkowskiego 1; zdjęcie z Google Maps, 25.11):
  // modernizm lat 30., trzy kondygnacje, jasnobrązowe płyty między pilastrami z ciemnej cegły
  // klinkierowej, zegar na narożnym ryzalicie, płaski dach.
  550251793: {
    note: 'Urząd Miasta, dawna Dyrekcja HSW',
    kind: 'office',
    type: 'kostka',
    wall: PLASTER,
    levels: 3,
    colour: '#a7805f',
    roofShape: 'flat',
  },
  // MDK (zdjęcie z Google Maps, 25.11): jasnoszary tynk; bryła z STW2_SPLITS.
  291332391: { note: 'Miejski Dom Kultury', type: 'kostka', wall: PLASTER, colour: '#e2dfd7' },
  // MB Szkaplerznej (1898–1907, zdjęcie z Google Maps, 25.11): neogotyk z czerwonej cegły, jedna
  // wieża w fasadzie z zegarem i ciemnym, ostrym hełmem.
  291346795: {
    note: 'Kościół MB Szkaplerznej',
    wall: 'base:brick-wall',
    colour: '#9a4b37',
    roofColour: '#3b3836',
  },
  // Kapucyni (poł. XVIII w., zdjęcie z Google Maps, 25.11): biały tynk, barokowy szczyt fasady,
  // bez wieży (tylko sygnaturka), klasztor obok tak samo biały, ciemny dach z lukarnami.
  291349371: {
    note: 'Kościół Zwiastowania Pańskiego (Kapucyni)',
    wall: PLASTER,
    colour: '#e9e5dc',
    roofColour: '#3f4042',
    tall: 0,
  },
  3869084: {
    note: 'Klasztor Kapucynów',
    wall: PLASTER,
    kind: 'office',
    levels: 2,
    colour: '#e9e5dc',
    roofColour: '#3f4042',
  },
  // Relation 2732840: a plain building (building=yes, address only) taken for a church.
  2732840: { note: 'Budynek przy Siedlanowskiego 3', kind: 'shop' },
  // Former synagogue in Rozwadów (1910): a prayer house, not a house.
  359595404: { note: 'Dawna synagoga w Rozwadowie', kind: 'church', tall: 0 },
  // Lubomirski palace (Muzeum Regionalne, Sandomierska 1): museum rooms, not a family house.
  359594171: { note: 'Pałac Lubomirskich (Muzeum Regionalne)', kind: 'office', levels: 2 },
};

/**
 * A building drawn as two parts with their own fixes (OSM maps one outline, the real building has
 * wings of different height). `cut`: a line through two outline corners (stw2 world metres);
 * `left` / `right`: the parts on each side of the directed line (x0, y0) → (x1, y1).
 */
export interface BuildingSplit {
  note: string;
  cut: readonly [number, number, number, number];
  left: BuildingFix;
  right: BuildingFix;
}

export const STW2_SPLITS: Readonly<Record<number, BuildingSplit>> = {
  // Miejski Dom Kultury (dawny ZDK Huty, 1952, proj. H. Szwemin-Pater): „bryła złożona z trzech
  // części usytuowanych liniowo”, rzut odwróconego T; skrzydło frontowe trójkondygnacyjne (kasy,
  // hol, westybul), za nim dwukondygnacyjna sala widowiskowa na 750 osób z zapleczem (G. Stojak,
  // journals.ur.edu.pl, art. 8996). Front = szersze wschodnie skrzydło od placu (paved) przy
  // 1 Sierpnia; cięcie przez wewnętrzne narożniki skrzydła.
  291332391: {
    note: 'Miejski Dom Kultury',
    cut: [17027.0, 20628.8, 17040.0, 20655.1],
    left: { note: 'MDK: sala widowiskowa i zaplecze', kind: 'gym', levels: 2 },
    right: { note: 'MDK: skrzydło frontowe', kind: 'office', levels: 3 },
  },
};

/** Id of the second part of a split building (above every OSM way id). */
export const splitPartId = (id: number) => id * 10 + 1;
/** Gid of the second part (above every tile gid). */
export const splitPartGid = (gid: number) => 2_000_000 + gid;

/** Tile ring coordinates (dm, `world = raw / 10 + 3072`). */
const RAW = (w: number) => (w - 3072) * 10;

/**
 * Closed ring clipped to one side of a line (Sutherland–Hodgman on a half plane). `side` +1: left
 * of the directed line. Returns the closed ring and the edge indexes lying on the cut.
 */
export function clipRing(
  ring: readonly number[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  side: 1 | -1,
): { ring: number[]; cutEdges: number[] } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // Signed distance; corners within 5 units (0.5 m) of the line lie on it (OSM corners of a
  // straight wall are rarely exactly collinear).
  const f = (x: number, y: number) => {
    const d = (side * (dx * (y - ay) - dy * (x - ax))) / len;
    return Math.abs(d) < 5 ? 0 : d;
  };
  // `e`: the source edge (vertex i starts edge i; a crossing lies on edge i); `v`: a vertex.
  const pts: { x: number; y: number; e: number; v: boolean }[] = [];
  const n = ring.length / 2 - 1; // closed: last == first
  for (let i = 0; i < n; i++) {
    const px = ring[i * 2]!;
    const py = ring[i * 2 + 1]!;
    const qx = ring[i * 2 + 2]!;
    const qy = ring[i * 2 + 3]!;
    const fp = f(px, py);
    const fq = f(qx, qy);
    if (fp >= 0) pts.push({ x: px, y: py, e: i, v: true });
    if (fp * fq < 0) {
      const t = fp / (fp - fq);
      pts.push({ x: px + (qx - px) * t, y: py + (qy - py) * t, e: i, v: false });
    }
  }
  const out: number[] = [];
  const cutEdges: number[] = [];
  pts.forEach((p, k) => {
    out.push(Math.round(p.x), Math.round(p.y));
    const q = pts[(k + 1) % pts.length]!;
    // Along the source outline: q ends p's edge (next vertex) or is a crossing on it.
    const along = q.v ? q.e === (p.e + 1) % n : q.e === p.e;
    if (!along) cutEdges.push(k);
  });
  if (pts.length) out.push(out[0]!, out[1]!);
  return { ring: out, cutEdges };
}

function splitBuilding(b: OsmBuilding): OsmBuilding[] {
  const sp = STW2_SPLITS[b.osmId ?? b.id];
  if (!sp || b.rings.length !== 1) return [b];
  const [x0, y0, x1, y1] = sp.cut.map(RAW) as [number, number, number, number];
  const osmId = b.osmId ?? b.id;
  // Outer `noWall` indexes do not survive the clip (MDK has none): both parts draw all walls.
  const base: OsmBuilding = { ...b };
  delete base.noWall;
  const L = clipRing(b.rings[0]!, x0, y0, x1, y1, 1);
  const R = clipRing(b.rings[0]!, x0, y0, x1, y1, -1);
  // The shared wall belongs to the taller part (the lower one would leave a hole above its roof).
  const lowerLeft = (sp.left.levels ?? b.levels) < (sp.right.levels ?? b.levels);
  const part = (
    f: BuildingFix,
    c: { ring: number[]; cutEdges: number[] },
    noWall: boolean,
    extra: Partial<OsmBuilding>,
  ) =>
    fixWith(
      {
        ...base,
        osmId,
        rings: [c.ring],
        ...(noWall && c.cutEdges.length ? { noWall: c.cutEdges } : {}),
        ...extra,
      },
      f,
    );
  return [
    // The taller part keeps the building's ids: it is the main part, whose look (palette type
    // from its kind and floors) both parts wear; the lower one skips the shared wall.
    part(lowerLeft ? sp.right : sp.left, lowerLeft ? R : L, false, {}),
    part(lowerLeft ? sp.left : sp.right, lowerLeft ? L : R, true, {
      id: splitPartId(b.id),
      ...(b.gid !== undefined ? { gid: splitPartGid(b.gid) } : {}),
    }),
  ];
}

/** Building ids replaced by a mark (their OSM way is the mark's outline). */
const MARK_WAYS: ReadonlySet<number> = new Set(
  STW2_MARKS.filter((k) => k.osm.startsWith('w')).map((k) => Number(k.osm.slice(1))),
);

function fixBuilding(b: OsmBuilding): OsmBuilding {
  const f = STW2_BUILDINGS[b.osmId ?? b.id];
  return f ? fixWith(b, f) : b;
}

function fixWith(b: OsmBuilding, f: BuildingFix): OsmBuilding {
  const out: OsmBuilding = { ...b };
  if (f.kind) out.kind = f.kind;
  if (f.type) out.type = f.type;
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
    buildings: map.buildings
      .filter((b) => !MARK_WAYS.has(b.osmId ?? b.id))
      .flatMap(splitBuilding)
      .map(fixBuilding),
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
