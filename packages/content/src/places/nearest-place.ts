/** Punkt z nazwą: wystarcza `{ name, x, y }` (`Place`, `SummaryPlace` z sima, `world.places`). */
export interface NamedPoint {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/**
 * Nazwa najbliższego miejsca do (x, y) w linii prostej, przy remisie pierwsze z listy; null dla
 * pustej listy. Ta sama semantyka co `nearestPlace` z `@deadzone/sim` (`saveSummary.place`).
 */
export function nearestPlace(
  places: readonly NamedPoint[] | null | undefined,
  x: number,
  y: number,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const p of places ?? []) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.name;
    }
  }
  return best;
}
