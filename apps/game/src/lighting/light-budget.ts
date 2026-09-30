/** A lamp position on the floor plane (world X, Z). */
export interface BudgetLamp {
  readonly x: number;
  readonly z: number;
  /** Broken lamps never get a light. */
  readonly working: boolean;
}

export interface LightBudget {
  /** Max real lights (the rest keep only the bulb and glow decal). */
  readonly maxLights: number;
  /** Lamps farther than this from the focus never get a light. */
  readonly maxDistance: number;
  /**
   * An already lit lamp keeps its light unless a candidate is closer by more than this, so lights
   * don't flicker between two lamps at similar distances.
   */
  readonly hysteresis: number;
}

export const DEFAULT_LIGHT_BUDGET: LightBudget = { maxLights: 4, maxDistance: 36, hysteresis: 2 };

/**
 * Picks which lamps get a real light: the nearest working lamps to the focus (camera target),
 * at most `maxLights`, within `maxDistance`. Result is sorted nearest first (ties by index), so
 * the first entries can be the ones with shadows. `previous` = last result (hysteresis).
 */
export function selectLamps(
  lamps: readonly BudgetLamp[],
  fx: number,
  fz: number,
  budget: LightBudget = DEFAULT_LIGHT_BUDGET,
  previous: readonly number[] = [],
): number[] {
  const kept = new Set(previous);
  const max2 = budget.maxDistance * budget.maxDistance;
  const scored: { i: number; d: number; score: number }[] = [];
  lamps.forEach((l, i) => {
    if (!l.working) return;
    const d = Math.hypot(l.x - fx, l.z - fz);
    if (d * d > max2) return;
    scored.push({ i, d, score: kept.has(i) ? d - budget.hysteresis : d });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored
    .slice(0, Math.max(0, budget.maxLights))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((s) => s.i);
}
