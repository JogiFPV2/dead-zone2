export interface MoveKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface MoveVector {
  dx: number;
  dy: number;
}

const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v);

/**
 * WASD -> world move vector (sim x = world X, sim y = world Z), relative to camera yaw
 * (same yaw as isometricOffset: camera sits at (sin yaw, cos yaw) from the target).
 * W = screen up = away from the camera. Result has length 1, or is (0, 0).
 */
export function moveDirection(keys: MoveKeys, yaw: number): MoveVector {
  const f = Number(keys.up) - Number(keys.down);
  const r = Number(keys.right) - Number(keys.left);
  if (f === 0 && r === 0) return { dx: 0, dy: 0 };
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  // forward = (-sin, -cos), right = (cos, -sin) on the floor (X, Z).
  const x = -s * f + c * r;
  const z = -c * f - s * r;
  const len = Math.hypot(x, z);
  return { dx: snap(x / len), dy: snap(z / len) };
}

export const sameMove = (a: MoveVector, b: MoveVector, eps = 1e-6): boolean =>
  Math.abs(a.dx - b.dx) < eps && Math.abs(a.dy - b.dy) < eps;
