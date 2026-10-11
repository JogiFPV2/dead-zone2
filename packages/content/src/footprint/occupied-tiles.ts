import type { Footprint } from '../schemas/common/footprint.js';
import { rotatedFootprint } from './rotated-footprint.js';

export interface TileXY {
  x: number;
  y: number;
}

/**
 * Kafle zajęte przez mebel z obiektu mapy `{x, y, rot}`. Kotwica: `x/y` to zawsze kafel
 * o najmniejszym x i y (północno-zachodni róg) prostokąta `rotatedFootprint(rot, fp)`, przy
 * każdym obrocie; mebel rozciąga się w +x i +y. Kolejność: wierszami (y), potem x.
 */
export function occupiedTiles(x: number, y: number, rot: number, fp: Footprint): TileXY[] {
  const r = rotatedFootprint(rot, fp);
  const tiles: TileXY[] = [];
  for (let dy = 0; dy < r.h; dy++)
    for (let dx = 0; dx < r.w; dx++) tiles.push({ x: x + dx, y: y + dy });
  return tiles;
}
