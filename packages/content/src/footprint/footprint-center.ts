import type { Footprint } from '../schemas/common/footprint.js';
import { rotatedFootprint } from './rotated-footprint.js';

/**
 * Środek zajętego prostokąta w kaflach (dla 1×1 to `x + 0.5, y + 0.5`, jak dotąd). Render
 * stawia tu model i obraca go o −rot·90° wokół osi pionowej.
 */
export function footprintCenter(
  x: number,
  y: number,
  rot: number,
  fp: Footprint,
): { x: number; y: number } {
  const r = rotatedFootprint(rot, fp);
  return { x: x + r.w / 2, y: y + r.h / 2 };
}
