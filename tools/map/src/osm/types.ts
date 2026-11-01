/**
 * Compact OSM map of Stalowa Wola (`stw-map.json`, format `deadzone-osm-1`): OpenStreetMap features
 * already mapped to the game's kinds, in local metres of a UTM 34N (EPSG:32634) square — x = E − E0
 * (east), y = N1 − N (south), (0, 0) = the square's north-west corner, 1 m = 1 tile.
 * Data © współtwórcy OpenStreetMap, ODbL 1.0 (separate artifact, see `docs/osm.md`).
 *
 * Coordinates are integer decimetres, flat `[x0, y0, x1, y1, …]` (half the size of float pairs).
 */
export const OSM_FORMAT = 'deadzone-osm-1';
export const OSM_ATTRIBUTION = '© współtwórcy OpenStreetMap';

/** Our 12 catalogue building types (`tools/map/src/catalog.ts`). */
export const BUILDING_TYPES = [
  'hospital',
  'school',
  'gym',
  'gas-station',
  'police',
  'grocery',
  'pharmacy',
  'house',
  'kostka',
  'house-garage',
  'shack',
  'ruin',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

/**
 * Finer kind (interior program, walls, default floor count). Kinds without a catalogue type of
 * their own (`block`, `church`, `industrial`, `station`, `office`, `garage`) borrow the closest
 * type — listed as gaps in the report.
 */
export const BUILDING_KINDS = [
  'house',
  'block',
  'kostka',
  'shop',
  'pharmacy',
  'hospital',
  'school',
  'gym',
  'church',
  'police',
  'fire-station',
  'office',
  'station',
  'fuel',
  'industrial',
  'garage',
  'shed',
  'ruin',
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/** Where a value came from: the feature's own tags (or a POI inside it), the landuse around it, or a default. */
export type Source = 'tag' | 'landuse' | 'default';

export type RoadKind =
  | 'motorway'
  | 'trunk'
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'residential'
  | 'service'
  | 'track'
  | 'footway'
  | 'path'
  | 'steps'
  | 'cycleway';

export interface OsmRoad {
  id: number;
  /** Rank in the whole file (lazily loaded tiles: query order independent of load order). */
  ord?: number;
  kind: RoadKind;
  /** Carriageway width (m). */
  width: number;
  /** Sidewalk each side (m, 0 = none / mapped separately). */
  sidewalk: number;
  name?: string;
  bridge?: 1;
  tunnel?: 1;
  layer?: number;
  /** map2 (`?map=stw2`): 0 = no centre line (one-way carriageway). */
  cl?: 0;
  /** map2: lane lines, offsets from the axis (m, left of the way direction > 0). */
  ll?: number[];
  /** map2: kerb-corner asphalt strip at a junction (no lamps, no crossings, no markings). */
  fill?: 1;
  pts: number[];
}

export interface OsmRail {
  id: number;
  /** Rank in the whole file (lazily loaded tiles: query order independent of load order). */
  ord?: number;
  kind: 'rail' | 'tram' | 'siding' | 'disused';
  bridge?: 1;
  /** `electrified=contact_line` (catenary masts and wires). */
  el?: 1;
  pts: number[];
}

/** Power line (`power=line` / `minor_line`): every vertex a tower / pole. */
export interface OsmPower {
  id: number;
  /** Rank in the whole file (lazily loaded tiles). */
  ord?: number;
  /** By `voltage`: 110 / 220 / 400 kV lines, `lv` = low voltage (`minor_line`, ≤ 1 kV). */
  kind: 'hv110' | 'hv220' | 'hv400' | 'lv';
  /** Circuits (`circuits`, or `cables` / 3): 2 = double-circuit towers. */
  circuits: 1 | 2;
  pts: number[];
}

/** Railway point features (on a rail vertex): switches, buffer stops, level crossings. */
export interface OsmRailNode {
  kind: 'switch' | 'buffer_stop' | 'level_crossing';
  /** Decimetres. */
  x: number;
  y: number;
}

export interface OsmWaterway {
  id: number;
  /** Rank in the whole file (lazily loaded tiles: query order independent of load order). */
  ord?: number;
  /** Piece of a large feature clipped to one tile (+ margin): indexed apart from other pieces. */
  part?: number;
  kind: 'river' | 'stream' | 'canal' | 'ditch';
  width: number;
  name?: string;
  pts: number[];
}

export type AreaKind =
  | 'water'
  | 'forest'
  | 'park'
  | 'grass'
  | 'meadow'
  | 'farmland'
  | 'orchard'
  | 'allotments'
  | 'residential'
  | 'industrial'
  | 'commercial'
  | 'cemetery'
  | 'parking'
  | 'pitch'
  | 'railway'
  | 'scrub'
  | 'wetland'
  | 'sand'
  | 'paved'
  | 'fuel'
  | 'construction'
  | 'military';

export interface OsmArea {
  id: number;
  /** Rank in the whole file (lazily loaded tiles: query order independent of load order). */
  ord?: number;
  /** Piece of a large feature clipped to one tile (+ margin): indexed apart from other pieces. */
  part?: number;
  kind: AreaKind;
  name?: string;
  /** Outer ring first, then holes (each a closed flat ring). */
  rings: number[][];
}

export interface OsmBuilding {
  id: number;
  /** Global building id: rank in OSM id order over the whole file (tiles keep it). */
  gid?: number;
  type: BuildingType;
  kind: BuildingKind;
  typeFrom: Source;
  levels: number;
  levelsFrom: Source;
  /** Tall single storey (church nave, hall). */
  tall?: 1;
  name?: string;
  /** OSM look tags (look-spec.md §A): building:colour, roof:colour, roof:shape, roof:levels, height (m). */
  colour?: string;
  roofColour?: string;
  roofShape?: string;
  roofLevels?: number;
  height?: number;
  /** Raw building:levels when tagged (`levels` above is clamped / defaulted). */
  osmLevels?: number;
  /** OSM way id when `id` is not one (procedural maps leave it out; OSM tiles: `id`). */
  osmId?: number;
  /** Outer ring (closed), holes after it. */
  rings: number[][];
}

export interface OsmPoi {
  kind: string;
  x: number;
  y: number;
  name?: string;
}

export interface OsmPlace {
  name: string;
  kind:
    'city' | 'town' | 'suburb' | 'village' | 'hamlet' | 'neighbourhood' | 'quarter' | 'locality';
  x: number;
  y: number;
}

export interface OsmMap {
  format: typeof OSM_FORMAT;
  crs: 'EPSG:32634';
  /** UTM easting / northing of the north-west corner. */
  E0: number;
  N1: number;
  size: number;
  attribution: typeof OSM_ATTRIBUTION;
  license: 'ODbL-1.0';
  source: string;
  roads: OsmRoad[];
  rails: OsmRail[];
  /** Power lines (optional: older files have none). */
  power?: OsmPower[];
  /** Railway switches, buffer stops and level crossings (optional). */
  railNodes?: OsmRailNode[];
  waterways: OsmWaterway[];
  areas: OsmArea[];
  buildings: OsmBuilding[];
  /** Single trees, flat decimetre points. */
  trees: number[];
  /** Tree rows / avenues (polylines). */
  treeRows: number[][];
  pois: OsmPoi[];
  places: OsmPlace[];
}
