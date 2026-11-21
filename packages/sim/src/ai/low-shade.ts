import type { SimWorld } from '../core/world.js';
import type { TileGrid } from '../world/grid.js';
import { vehicleTypes } from '../vehicles/seats.js';
import { LIGHT, type SunState } from './sky.js';

/**
 * Shadows of low casters (docs 9.45): cars, fences / gates and walls on level 0. Not cached:
 * cars move, and only players' light levels ask (every `LIGHT.everyTicks`). The ray goes from
 * the body height (standing `LIGHT.bodyHeightM`, sneaking `LIGHT.sneakBodyHeightM`) towards the
 * sun; it is blocked by a fence / wall edge it crosses while still below that edge's height, or
 * by a car body it passes over below `LIGHT.carHeightM`.
 */
const STEP_M = 0.25;
/** Farthest the ray is followed (m): beyond, a 2 m caster no longer reaches the body. */
const MAX_REACH_M = 12;

function edgeHeight(grid: TileGrid, id: number): number {
  if (id <= 0) return 0;
  const k = grid.edgeKindOf(id);
  if (k === 'fence' || k === 'gate') return LIGHT.fenceHeightM;
  if (k === 'wall') return LIGHT.wallHeightM;
  return 0;
}

export function inLowShade(
  w: SimWorld,
  grid: TileGrid,
  sun: SunState,
  x: number,
  y: number,
  bodyM: number,
): boolean {
  if (!sun.up || sun.tanEl <= 0) return false;
  const top = Math.max(LIGHT.carHeightM, LIGHT.fenceHeightM, LIGHT.wallHeightM);
  const reach = Math.min(MAX_REACH_M, (top - bodyM) / sun.tanEl);
  if (reach <= 0) return false;
  // Fences and walls: tile edges the ray crosses.
  let tx = Math.floor(x);
  let ty = Math.floor(y);
  for (let d = STEP_M; d <= reach + 1e-9; d += STEP_M) {
    const ray = bodyM + d * sun.tanEl;
    const nx = Math.floor(x + sun.hx * d);
    const ny = Math.floor(y + sun.hy * d);
    if (nx !== tx) {
      const h = edgeHeight(grid, grid.edgeW(Math.max(nx, tx), ty, 0));
      if (h > ray) return true;
    }
    if (ny !== ty) {
      const h = edgeHeight(grid, grid.edgeN(nx, Math.max(ny, ty), 0));
      if (h > ray) return true;
    }
    tx = nx;
    ty = ny;
  }
  // Cars.
  const carReach = Math.min(reach, (LIGHT.carHeightM - bodyM) / sun.tanEl);
  if (carReach <= 0) return false;
  const types = vehicleTypes(w);
  for (const v of w.physics.vehicles.values()) {
    if (Math.floor(v.z) !== 0) continue;
    const t = types[v.type];
    if (!t) continue;
    const hl = t.length / 2;
    const hw = t.width / 2;
    // Quick reject: car farther than the ray can reach.
    const r = hl + hw + carReach;
    if (Math.abs(v.x - x) > r || Math.abs(v.y - y) > r) continue;
    for (let d = 0; d <= carReach + 1e-9; d += STEP_M) {
      const px = x + sun.hx * d - v.x;
      const py = y + sun.hy * d - v.y;
      const along = px * v.hx + py * v.hy;
      const side = -px * v.hy + py * v.hx;
      if (Math.abs(along) <= hl && Math.abs(side) <= hw) return true;
    }
  }
  return false;
}
