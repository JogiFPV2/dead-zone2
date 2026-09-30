import { Vector3, type Camera } from 'three';

export interface FloorPoint {
  x: number;
  z: number;
}

/** Client pixel -> normalized device coords (-1..1, +Y up) inside `rect`. */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
    y: -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
  };
}

/** Ray/plane y = planeY intersection; undefined if parallel or the plane is behind the ray. */
export function intersectFloor(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  planeY = 0,
): FloorPoint | undefined {
  if (Math.abs(dir.y) < 1e-9) return undefined;
  const t = (planeY - origin.y) / dir.y;
  if (t < 0) return undefined;
  return { x: origin.x + dir.x * t, z: origin.z + dir.z * t };
}

/** Screen point (NDC) -> floor point. Works for the ortho camera (and perspective). */
export function ndcToFloor(
  camera: Camera,
  ndcX: number,
  ndcY: number,
  planeY = 0,
): FloorPoint | undefined {
  const origin = new Vector3(ndcX, ndcY, -1).unproject(camera);
  const dir = new Vector3(ndcX, ndcY, 1).unproject(camera).sub(origin).normalize();
  return intersectFloor(origin, dir, planeY);
}
