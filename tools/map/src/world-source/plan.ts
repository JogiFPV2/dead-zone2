import type {
  AreaKind,
  OsmArea,
  OsmBuilding,
  OsmPlace,
  OsmPoi,
  OsmPower,
  OsmRail,
  OsmRailNode,
  OsmRoad,
  OsmWaterway,
} from '../osm/types.js';

/**
 * A world plan as the lazy chunk generator reads it (`generator.ts`): vector features in tiles of
 * one square world (x east, y south, 1 tile = 1 m), coordinates as integer decimetres in flat
 * `[x0, y0, x1, y1, …]` arrays — the `deadzone-osm-1` feature shape. Two providers today:
 * the OpenStreetMap file of Stalowa Wola (`osmPlan`) and the procedural plan-4 (`plan4Plan`).
 */
export interface PlanFeatures {
  roads: readonly OsmRoad[];
  rails: readonly OsmRail[];
  /** Power lines (optional). */
  power?: readonly OsmPower[] | undefined;
  /** Railway switches, buffer stops, level crossings (optional). */
  railNodes?: readonly OsmRailNode[] | undefined;
  waterways: readonly OsmWaterway[];
  areas: readonly OsmArea[];
  buildings: readonly OsmBuilding[];
  /** Single trees, flat decimetre points. */
  trees: readonly number[];
  /** Tree rows / avenues (polylines, a tree every 7 m). */
  treeRows: readonly (readonly number[])[];
  pois: readonly OsmPoi[];
  places: readonly OsmPlace[];
}

/** Base land cover under the vector areas (plan-4: forest / fields from noise); undefined = grass. */
export type LandCover = (x: number, y: number) => AreaKind | undefined;

export interface WorldPlanInput {
  /** Map id, e.g. `osm-stw`, `plan-4`. */
  id: string;
  /**
   * Generator version string (`osm-stw-<data hash>-g<rev>`, `plan-4-s<seed>-g<rev>`): seed +
   * version = world. Saves store its numeric form (`generatorVersionNumber`).
   */
  version: string;
  seed: number;
  /** World square edge in tiles (16 384). */
  size: number;
  /** Playable chunk rectangle (inclusive); buildings crossing its edge are left out. */
  bounds: { cx0: number; cy0: number; cx1: number; cy1: number };
  features: PlanFeatures;
  /** Start hint (tiles); the generator snaps it to the nearest free sidewalk. */
  start: { x: number; y: number };
  landCover?: LandCover | undefined;
  /**
   * Precomputed zone kinds of every chunk in the bounds (row-major, `CHUNK_KINDS` indices): lazily
   * loaded maps cannot compute them from features they do not have yet.
   */
  chunkKinds?: Uint8Array | undefined;
  /** On-screen attribution (OSM: „© współtwórcy OpenStreetMap”). */
  attribution?: string | undefined;
}

/**
 * Bump on every change of generated chunks for the same plan (part of the version string).
 * 2: OSM rotated onto the street grid, squared outlines, vector roads + ground under them.
 * 3: whole 16 km square (world 22 528 m, rotated square shifted inside), lazily loaded tiles,
 *    feature order by global rank, outlines squared to their own axis off the street grid.
 * 4: off-grid buildings turned onto the grid (tile data), huge halls in sections with gates,
 *    furniture of big rooms (rack rows, hall workshops), zone kinds from the chunks around.
 * 5–11 (#197): blok facades, bins by blocks, storeys from height, infra (power, track,
 *    crossings, catenary), room kits, cover zones.
 * 12: main #249 merged in: furniture placed by footprint, building kinds, its room kits.
 * 13: cover zones and HV tower / catenary mast feet per chunk (`SimChunk.zones` / `blockers`).
 * 14: main #257 merged in: #254 kits (tables with chairs, lamps, switches), toilet, seats a tile apart.
 * 15: #267 TV, VCR and radio stand on a worktop (TV stand, table), never on a bare tile.
 * 16: HV line clearings (przecinki): no trees and no woods cover within 15 / 20 / 30 m of 110 / 220 / 400 kV lines.
 * 17: window tiles kept clear (furniture, yard props, kitchen / bathroom fittings), wall segments cut out of window and door corridors.
 * 18: building outlines cleaned (jogs < 1.5 m dropped, > 8 corners → box when it fits, odd
 *     outlines boxed or Douglas–Peucker 0.7 m), windows every 2.25 m per wall run (+ one
 *     per room), never at a corner or beside a door.
 * 19–20: unused (reserved for #373 / #376, shipped as 22 / 23).
 * 21: building look in the chunk meta (`look`, `wallColor`, `roofColor`, `trimColor`,
 *     `roofShape`, `condition`, `heightM`, `tower`; look-palette.ts, look.ts).
 * 22: level crossings span the carriageway, one set of signs per road side; no track under road
 *     viaducts, no catenary mast on a road.
 * 23: reserved for #376.
 * 26: taken by #390 (level crossings where OSM marks none).
 * 27: paved areas (plazas, `area:highway`) keep the ground under them (`under`) and ship their
 *     rings (`GenColumn.paved`): drawn as smooth polygons, no stair-stepped sidewalk tiles.
 * 30: look variety (#385): hue-balanced palette weights, per-building jitter (L ±6 %, H ±4°),
 *     rural house weights, condition placement (rail, industrial, settlement edge, centre).
 * 31: flat-roof variants (light membrane, brownish tar) for block, kamienica, school, police,
 *     hospital, service (look-palette roofsV4) (#387).
 * 33: railings along both side edges of every bridge deck (not only across the track under it);
 *     paved ground under decks near tracks becomes dirt (#376).
 * 34: level crossings where OSM marks none (track × at-grade carriageway); OSM level_crossing
 *     nodes away from any carriageway dropped (#390).
 * 37: level crossing plates centred on the road axis and sheared along an oblique road (parallel
 *     tracks on one road give one continuous band at rail height); one set of crossing signs /
 *     barriers per road side; no track gap at the ends of sheared plates (#391, #392).
 */
export const GENERATOR_REV = 37;

/** Numeric generator version for saves (`WorldSource.generatorVersion`): 31-bit FNV-1a of the string. */
export function generatorVersionNumber(version: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < version.length; i++) {
    h ^= version.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h & 0x7fffffff || 1;
}

/** Decimetre flat array → tile floats. */
export function dm(f: readonly number[]): Float64Array {
  const out = new Float64Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = f[i]! / 10;
  return out;
}
