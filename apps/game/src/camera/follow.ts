/** Frame-rate independent smoothing factor: fraction of the gap closed in `dtMs`. */
export function followFactor(dtMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return 1;
  return 1 - Math.pow(2, -Math.max(0, dtMs) / halfLifeMs);
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Moves `current` towards `goal` in place with exponential smoothing. */
export function followStep(
  current: Vec3Like,
  goal: Vec3Like,
  dtMs: number,
  halfLifeMs: number,
): void {
  const k = followFactor(dtMs, halfLifeMs);
  current.x += (goal.x - current.x) * k;
  current.y += (goal.y - current.y) * k;
  current.z += (goal.z - current.z) * k;
}
