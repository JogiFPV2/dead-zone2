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
 * ~1 in 4 broken), power poles on the outer sidewalk edge every 24 m, trees and grass tufts on
 * open grass away from roads, buildings and walls. Visual only: the sim does not collide with it.
 */
export function townDecor(tiles: MapTiles, range: ChunkRange): TownDecor {
  const props: PropPlacement[] = [];
  const lamps: LampDef[] = [];
  const x0 = range.cx0 * CHUNK_SIZE;
  const z0 = range.cy0 * CHUNK_SIZE;
  const x1 = (range.cx1 + 1) * CHUNK_SIZE;
  const z1 = (range.cy1 + 1) * CHUNK_SIZE;
  const f = (x: number, z: number) => tiles.floor(x, z);
  const road = (x: number, z: number) => f(x, z) === 'base:asphalt';
  const walk = (x: number, z: number) => f(x, z) === 'base:sidewalk';
  const busy = (x: number, z: number, r: number) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const t = f(x + dx, z + dz);
        if (t !== 'base:grass' && t !== 'base:dirt') return true;
        if (tiles.building(x + dx, z + dz) !== NO_BUILDING) return true;
        if (tiles.edge('N', x + dx, z + dz) || tiles.edge('W', x + dx, z + dz)) return true;
      }
    }
    return false;
  };
  for (let z = z0; z < z1; z++) {
    for (let x = x0; x < x1; x++) {
      const t = f(x, z);
      if (t === 'base:sidewalk') {
        // Curb side of an east-west road: the road is right below (south) or above (north).
        const crossRoad = road(x - 1, z) || road(x + 1, z);
        if (
          !crossRoad &&
          road(x, z + 1) &&
          ((x % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING === 0
        )
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
        if (
          !alongRoad &&
          road(x - 1, z) &&
          ((z % LAMP_SPACING) + LAMP_SPACING) % LAMP_SPACING === 0
        )
          lamps.push(lamp(x + 0.55, z + 0.5, -1, 0));
        // Power poles on the outer edge (sidewalk next to the lots).
        const outerN = !walk(x, z - 1) && !road(x, z - 1) && walk(x, z + 1);
        const outerS = false;
        const outerW = !walk(x - 1, z) && !road(x - 1, z) && walk(x + 1, z);
        const outerE = false;
        const mx = ((x % POLE_SPACING) + POLE_SPACING) % POLE_SPACING;
        const mz = ((z % POLE_SPACING) + POLE_SPACING) % POLE_SPACING;
        if ((outerN || outerS) && mx === 7)
          props.push({ name: 'prop-electricity-pole', x: x + 0.5, z: z + 0.5, rotY: 0 });
        if ((outerW || outerE) && mz === 19)
          props.push({ name: 'prop-electricity-pole', x: x + 0.5, z: z + 0.5, rotY: Math.PI / 2 });
        continue;
      }
      if (t !== 'base:grass' && t !== 'base:dirt') continue;
      const h = hash01(x, z, 21);
      if (t === 'base:grass' && h < TREE_DENSITY && !busy(x, z, 2)) {
        const name = TREES[Math.floor(hash01(x, z, 22) * TREES.length)] ?? 'prop-tree';
        props.push({
          name,
          x: x + 0.5,
          z: z + 0.5,
          rotY: hash01(x, z, 23) * Math.PI * 2,
          scale: 0.9 + hash01(x, z, 24) * 0.25,
        });
      } else if (h < 0.04 && !busy(x, z, 0)) {
        props.push({
          name: 'prop-grass-large',
          x: x + 0.5,
          z: z + 0.5,
          rotY: hash01(x, z, 25) * 6.28,
        });
      } else if (h > 0.995 && t === 'base:dirt') {
        props.push({ name: 'prop-rock-a', x: x + 0.5, z: z + 0.5, rotY: hash01(x, z, 26) * 6.28 });
      }
    }
  }
  return { props, lamps };

  function lamp(x: number, z: number, armX: number, armZ: number): LampDef {
    return { x, z, armX, armZ, working: hash01(Math.floor(x), Math.floor(z), 31) > 0.25 };
  }
}
