import { LEVEL_HEIGHT } from '../world/instances.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Sim (x, y floor plane, z level) -> three.js world (X, Y up, Z). */
export function simToWorld(
  x: number,
  y: number,
  z: number,
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  out.x = x;
  out.y = z * LEVEL_HEIGHT;
  out.z = y;
  return out;
}

/** three.js floor point (X, Z) -> sim floor plane (x, y). */
export const worldToSimFloor = (wx: number, wz: number): { x: number; y: number } => ({
  x: wx,
  y: wz,
});

/**
 * three.js Y rotation for an object whose local +X should point along sim facing
 * (radians, measured from +x towards +y, i.e. from world +X towards +Z).
 */
export const facingToRotationY = (facing: number): number => -facing;

/**
 * Sim -> render space (floating origin, `render/floating-origin.ts`): `simToWorld` minus the
 * render origin (world X / Z). For anything placed outside the world root (camera, sun).
 */
export function simToRender(
  x: number,
  y: number,
  z: number,
  origin: { readonly x: number; readonly z: number },
  out: Vec3 = { x: 0, y: 0, z: 0 },
): Vec3 {
  simToWorld(x, y, z, out);
  out.x -= origin.x;
  out.z -= origin.z;
  return out;
}

/** Render floor point (X, Z) -> sim floor plane (x, y). */
export const renderToSimFloor = (
  rx: number,
  rz: number,
  origin: { readonly x: number; readonly z: number },
): { x: number; y: number } => worldToSimFloor(rx + origin.x, rz + origin.z);
