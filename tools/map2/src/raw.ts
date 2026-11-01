/** `deadzone-osm-raw-2` (scripts/extract.py): WGS84, node ids kept. */
export interface RawWay {
  id: number;
  nodes: number[];
  t: Record<string, string>;
}
export interface RawArea {
  id: number;
  kind: 'water';
  name: string;
  rings: { outer: [number, number][]; inner: [number, number][][] }[];
}
export interface RawPlace {
  id: number;
  lon: number;
  lat: number;
  place: string;
  name: string;
}
export interface RawOsm2 {
  format: 'deadzone-osm-raw-2';
  bbox: [number, number, number, number];
  source: string;
  license: string;
  /** Node id → [lon, lat]. */
  nodes: Record<string, [number, number]>;
  ways: RawWay[];
  areas: RawArea[];
  places: RawPlace[];
}
