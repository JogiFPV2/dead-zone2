import type { LampDef } from '../../lighting/street-lamps.js';
import { CHUNK_SIZE, NO_BUILDING, type ChunkRange } from '../chunk.js';
import { hash01 } from './modules.js';
import type { MapTiles } from './tiles.js';
import type { PropPlacement } from './town-structures.js';

export interface TownDecor {
  props: PropPlacement[];
  lamps: LampDef[];
}

const TREES = ['prop-tree', 'prop-tree-tall', 'prop-tree-autumn', 'prop-tree'] as const;
export const LAMP_SPACING = 18;
export const POLE_SPACING = 30;
export const TREE_DENSITY = 0.009;

/**
 * Procedural, deterministic decor derived from the map (the map format has no decor layer yet):
 * street lamps on the curb side of sidewalks every 18 m (alternating sides, arm over the road,
 * ~1 in 4 broken), power poles every 30 m on the verge just behind the outer sidewalk edge (skipped where there is
 * none: medians, lots, buildings), trees and grass tufts on
 * open grass away from roads, paths, buildings and walls (or the given trees, e.g. from
 * OpenStreetMap), never on a dirt track or path or right at its edge.
 * Visual only: the sim does not collide with it.
 */
export function townDecor(
  tiles: MapTiles,
  range: ChunkRange,
  /** Trees at fixed spots (OSM scenes, sim tiles): replace the random grass trees. */
  trees?: readonly (readonly [number, number])[],
): TownDecor {
  const props: PropPlacement[] = [];
  const lamps: LampDef[] = [];
  const x0 = range.cx0 * CHUNK_SIZE;
  const z0 = range.cy0 * CHUNK_SIZE;
  const x1 = (range.cx1 + 1) * CHUNK_SIZE;
  const z1 = (range.cy1 + 1) * CHUNK_SIZE;
  const f = (x: number, z: number) => tiles.floor(x, z);
  const road = (x: number, z: number) => f(x, z) === 'base:asphalt';
  const walk = (x: number, z: number) => f(x, z) === 'base:sidewalk';
  /** Free verge tile for a power pole: grass / dirt, no building, not right by a road. */
  const verge = (x: number, z: number, dx: number, dz: number) => {
    const t = f(x, z);
    if (t !== 'base:grass' && t !== 'base:dirt') return false;
    if (tiles.building(x, z) !== NO_BUILDING) return false;
    return !road(x + dx, z + dz) && !walk(x + dx, z + dz);
  };
  /**
   * Something within r tiles: not open ground, a building or a wall. `onGrass`: dirt counts too
   * (dirt tiles are mostly unpaved tracks and trodden paths: no plants or rocks on them).
   */
  const busy = (x: number, z: number, r: number, onGrass = false) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = f(x + dx, z + dz);
        if (t !== 'base:grass' && (onGrass || t !== 'base:dirt')) return true;
        if (tiles.building(x + dx, z + dz) !== NO_BUILDING) return true;
        if (tiles.edge('N', x + dx, z + dz) || tiles.edge('W', x + dx, z + dz)) return true;
      }
    }
    return false;
  };
  /** Inside a dirt area (5 × 5 dirt tiles), not on a narrow track or path. */
  const openDirt = (x: number, z: number) => {
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) if (f(x + dx, z + dz) !== 'base:dirt') return false;
    return !busy(x, z, 2);
  };
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const t = f(x, z);
      if (t === 'base:sidewalk') {
        lampsAt(f, x, z, lamps);
        // Power poles just off the outer edge of the sidewalk, on the verge / lawn behind it:
        // never on the sidewalk or the road, never in a narrow median by the carriageway.
        const mx = ((x % POLE_SPACING) + POLE_SPACING) % POLE_SPACING;
        const mz = ((z % POLE_SPACING) + POLE_SPACING) % POLE_SPACING;
        if (mx === 7 && walk(x, z + 1) && verge(x, z - 1, 0, -1) && !tiles.edge('N', x, z))
          props.push({ name: 'prop-electricity-pole', x: x + 0.5, z: z - 0.5, rotY: 0 });
        if (mz === 19 && walk(x + 1, z) && verge(x - 1, z, -1, 0) && !tiles.edge('W', x, z))
          props.push({ name: 'prop-electricity-pole', x: x - 0.5, z: z + 0.5, rotY: Math.PI / 2 });
        continue;
      }
      if (t !== 'base:grass' && t !== 'base:dirt') continue;
      const h = hash01(x, z, 21);
      if (!trees && t === 'base:grass' && h < TREE_DENSITY && !busy(x, z, 2, true)) {
        const name = TREES[Math.floor(hash01(x, z, 22) * TREES.length)] ?? 'prop-tree';
        props.push({
          name,
          x: x + 0.5,
          z: z + 0.5,
          rotY: hash01(x, z, 23) * Math.PI * 2,
          scale: 0.9 + hash01(x, z, 24) * 0.25,
        });
      } else if (h < 0.04 && t === 'base:grass' && !busy(x, z, 1, true)) {
        props.push({
          name: 'prop-grass-large',
          x: x + 0.5,
          z: z + 0.5,
          rotY: hash01(x, z, 25) * 6.28,
        });
      } else if (h > 0.995 && t === 'base:dirt' && openDirt(x, z)) {
        props.push({ name: 'prop-rock-a', x: x + 0.5, z: z + 0.5, rotY: hash01(x, z, 26) * 6.28 });
      }
    }
  }
  for (const [x, z] of trees ?? []) {
    if (x < x0 || z < z0 || x >= x1 || z >= z1) continue;
    const tx = Math.floor(x);
    const tz = Math.floor(z);
    const name = TREES[Math.floor(hash01(tx, tz, 22) * TREES.length)] ?? 'prop-tree';
    props.push({
      name,
      x,
      z,
      rotY: hash01(tx, tz, 23) * Math.PI * 2,
      scale: 0.9 + hash01(tx, tz, 24) * 0.3,
    });
  }
  return { props, lamps };
}

function lamp(x: number, z: number, armX: number, armZ: number): LampDef {
  return { x, z, armX, armZ, working: hash01(Math.floor(x), Math.floor(z), 31) > 0.25 };
}

/**
 * Street lamps of the sidewalk tile (x, z): on the curb side every LAMP_SPACING m (alternating
 * sides), arm over the road, ~1 in 4 broken.
 */
export function lampsAt(
  f: (x: number, z: number) => string | undefined,
  x: number,
  z: number,
  lamps: LampDef[],
): void {
  // No lamp on the track bed or right by it (level crossings, sidewalks along the railway).
  if (nearRail(f, x, z)) return;
  const road = (x: number, z: number) => f(x, z) === 'base:asphalt';
  // Curb side of an east-west road: the road is right below (south) or above (north).
  const crossRoad = road(x - 1, z) || road(x + 1, z);
  if (!crossRoad && road(x, z + 1) && ((x % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING === 0)
    lamps.push(lamp(x + 0.5, z + 0.45, 0, 1));
  if (
    !crossRoad &&
    road(x, z - 1) &&
    ((x % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING === LAMP_SPACING / 2
  )
    lamps.push(lamp(x + 0.5, z + 0.55, 0, -1));
  const alongRoad = road(x, z - 1) || road(x, z + 1);
  if (
    !alongRoad &&
    road(x + 1, z) &&
    ((z % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING === LAMP_SPACING / 2
  )
    lamps.push(lamp(x + 0.45, z + 0.5, 1, 0));
  if (!alongRoad && road(x - 1, z) && ((z % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING === 0)
    lamps.push(lamp(x + 0.55, z + 0.5, -1, 0));
}

/** Track bed this close (tiles) to a lamp's sidewalk tile keeps the lamp away. */
export const LAMP_RAIL_CLEAR = 2;

function nearRail(f: (x: number, z: number) => string | undefined, x: number, z: number): boolean {
  for (let dz = -LAMP_RAIL_CLEAR; dz <= LAMP_RAIL_CLEAR; dz++)
    for (let dx = -LAMP_RAIL_CLEAR; dx <= LAMP_RAIL_CLEAR; dx++)
      if (f(x + dx, z + dz) === 'base:rail') return true;
  return false;
}

/** Street lamps only (generated maps: the window around the player; no props, cheap). */
export function streetLampsOf(tiles: MapTiles, range: ChunkRange): LampDef[] {
  const lamps: LampDef[] = [];
  const f = (x: number, z: number) => tiles.floor(x, z);
  for (let z = range.cy0 * CHUNK_SIZE; z < (range.cy1 + 1) * CHUNK_SIZE; z++)
    for (let x = range.cx0 * CHUNK_SIZE; x < (range.cx1 + 1) * CHUNK_SIZE; x++)
      if (f(x, z) === 'base:sidewalk') lampsAt(f, x, z, lamps);
  return lamps;
}
