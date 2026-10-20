/** Auto aim (touch, no aim drag): zombies this close … */
export const AUTO_AIM_RANGE = 2.5;
/** … within this half-angle of the facing (rad, ±60°). */
export const AUTO_AIM_CONE = Math.PI / 3;

/**
 * Nearest zombie in the cone in front of the player (sim floor coordinates; `facing` = sim
 * heading, atan2(dy, dx)). Ties by id. Undefined when none.
 */
export function autoAimTarget<T extends { id: number; x: number; z: number }>(
  px: number,
  pz: number,
  facing: number,
  zombies: readonly T[],
  range = AUTO_AIM_RANGE,
  cone = AUTO_AIM_CONE,
): T | undefined {
  let best: { t: T; d: number } | undefined;
  for (const t of zombies) {
    const dx = t.x - px;
    const dz = t.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > range) continue;
    if (d > 1e-6) {
      const off = Math.atan2(
        Math.sin(Math.atan2(dz, dx) - facing),
        Math.cos(Math.atan2(dz, dx) - facing),
      );
      if (Math.abs(off) > cone) continue;
    }
    if (!best || d < best.d || (d === best.d && t.id < best.t.id)) best = { t, d };
  }
  return best?.t;
}
