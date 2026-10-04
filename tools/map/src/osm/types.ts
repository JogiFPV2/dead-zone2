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
  kind: RoadKind;
  /** Carriageway width (m). */
  width: number;
  /** Sidewalk each side (m, 0 = none / mapped separately). */
  sidewalk: number;
  name?: string;
  bridge?: 1;
  tunnel?: 1;
  layer?: number;
  pts: number[];
}

export interface OsmRail {
  id: number;
  kind: 'rail' | 'tram' | 'siding' | 'disused';
  bridge?: 1;
  pts: number[];
}

export interface OsmWaterway {
  id: number;
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
  kind: AreaKind;
  name?: string;
  /** Outer ring first, then holes (each a closed flat ring). */
  rings: number[][];
}

export interface OsmBuilding {
  id: number;
  type: BuildingType;
  kind: BuildingKind;
  typeFrom: Source;
  levels: number;
  levelsFrom: Source;
  /** Tall single storey (church nave, hall). */
  tall?: 1;
  name?: string;
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
