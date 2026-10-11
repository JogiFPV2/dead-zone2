import type {
  AreaKind,
  OsmArea,
  OsmBuilding,
  OsmPlace,
  OsmPoi,
  OsmRail,
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
  /** On-screen attribution (OSM: „© współtwórcy OpenStreetMap”). */
  attribution?: string | undefined;
}

/**
 * Bump on every change of generated chunks for the same plan (part of the version string).
 * 2: OSM rotated onto the street grid, squared outlines, vector roads + ground under them.
 */
export const GENERATOR_REV = 2;

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
