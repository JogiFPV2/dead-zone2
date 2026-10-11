import type { Footprint } from '../schemas/common/footprint.js';

/**
 * Rozmiar na siatce świata po obrocie: `w` wzdłuż x, `h` wzdłuż y. Przy `rot` 1 i 3 boki
 * się zamieniają (mebel 2×1 stoi wtedy w pionie, 1×2).
 */
export function rotatedFootprint(rot: number, fp: Footprint): Footprint {
  return (((rot % 4) + 4) % 4) % 2 === 1 ? { w: fp.h, h: fp.w } : { w: fp.w, h: fp.h };
}
