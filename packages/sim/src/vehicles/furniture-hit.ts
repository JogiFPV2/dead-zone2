import type { VehicleTypeDef } from '../content/adapter.js';
import type { SimWorld } from '../core/world.js';
import {
  furnitureCovering,
  furnitureWeightKg,
  isFixedFurniture,
  vehiclePushFurniture,
} from '../physics/furniture.js';
import type { VehicleConfig } from './config.js';
import { obbExtent, obbOf, obbVsObb, zoneAt } from './geometry.js';
import type { Impact } from './collide.js';
import type { Vehicle } from './types.js';

const f = Math.fround;

/**
 * Car against furniture footprints (`w.furniture`, map pieces and moved ones, docs 9.73). A light
 * movable piece (≤ `furnitureLightKg`, not a fixture) hit faster than `furnitureKnockSpeed` is
 * knocked one tile aside (`furnitureMoved` cause `vehicle`) and the car loses `furnitureSlow` of
 * its normal speed; anything else (heavy, fixed, slow, or no room to shove it) stops the car like
 * a wall. Both report `vehicleImpact` target `furniture` (body damage; crash injuries by the
 * speed lost). Returns true when the car was pushed out.
 */
export function collideFurniture(
  w: SimWorld,
  v: Vehicle,
  t: VehicleTypeDef,
  cfg: VehicleConfig,
  out: Impact[],
): boolean {
  if (!w.furniture) return false;
  const o = obbOf(v, t);
  const { ex, ey } = obbExtent(o);
  const z = Math.floor(v.z);
  const done = new Set<string>();
  let hit = false;
  for (let ty = Math.floor(v.y - ey); ty <= Math.floor(v.y + ey); ty++) {
    for (let tx = Math.floor(v.x - ex); tx <= Math.floor(v.x + ex); tx++) {
      const p = furnitureCovering(w, tx, ty, z);
      if (!p || done.has(p.origin)) continue;
      done.add(p.origin);
      const r = p.rect;
      const box = { x: r.x + r.w / 2, y: r.y + r.h / 2, hx: 1, hy: 0, hl: r.w / 2, hw: r.h / 2 };
      const m = obbVsObb(box, obbOf(v, t));
      if (!m) continue;
      const vn = -(v.vx * m.nx + v.vy * m.ny);
      const cx = Math.max(r.x, Math.min(r.x + r.w, v.x));
      const cy = Math.max(r.y, Math.min(r.y + r.h, v.y));
      const light =
        !isFixedFurniture(w, p.contentId) && furnitureWeightKg(w, p) <= cfg.furnitureLightKg;
      if (light && vn > cfg.furnitureKnockSpeed) {
        // Shove along the dominant axis away from the car.
        const ax = Math.abs(m.nx) >= Math.abs(m.ny);
        const dx = ax ? -Math.sign(m.nx) : 0;
        const dy = ax ? 0 : -Math.sign(m.ny);
        if (vehiclePushFurniture(w, p, dx, dy, undefined)) {
          const lost = vn * cfg.furnitureSlow;
          v.vx = f(v.vx + lost * m.nx);
          v.vy = f(v.vy + lost * m.ny);
          const energy = 0.5 * t.mass * (vn * vn - (vn - lost) * (vn - lost));
          out.push(impactOf(v, o, energy, lost, cx, cy, m.nx, m.ny));
          continue;
        }
      }
      v.x = f(v.x + m.nx * m.depth);
      v.y = f(v.y + m.ny * m.depth);
      if (vn > 0) {
        const e = cfg.restitution;
        v.vx = f(v.vx + (1 + e) * vn * m.nx);
        v.vy = f(v.vy + (1 + e) * vn * m.ny);
        if (vn > 1) v.angVel = f(v.angVel * 0.6);
        const energy = 0.5 * t.mass * vn * vn * (1 - e * e);
        out.push(impactOf(v, o, energy, vn, cx, cy, m.nx, m.ny));
      }
      hit = true;
    }
  }
  return hit;
}

function impactOf(
  v: Vehicle,
  o: ReturnType<typeof obbOf>,
  energy: number,
  closing: number,
  x: number,
  y: number,
  nx: number,
  ny: number,
): Impact {
  return {
    vehicle: v,
    targetKind: 'furniture',
    target: 0,
    eid: -1,
    energy: f(energy),
    closing: f(closing),
    x: f(x),
    y: f(y),
    nx: f(nx),
    ny: f(ny),
    zone: zoneAt(o, x, y),
  };
}
