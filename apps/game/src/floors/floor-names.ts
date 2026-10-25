/**
 * Floor names and counts (deadzone-hud-v2-spec „Piętra (UI)”): `PIWNICA` below ground
 * (`PIWNICA −2` when the building has several basement levels), `PARTER` at z = 0,
 * `N PIĘTRO` above.
 */

/** Minus sign used in floor labels (typographic, not a hyphen). */
const MINUS = '−';

/** Full floor name for the HUD floor badge, the toast and the plan header. */
export function floorName(z: number, zMin = Math.min(0, z)): string {
  if (z > 0) return `${z} PIĘTRO`;
  if (z === 0) return 'PARTER';
  // Several basement levels: the deeper ones get their number (−1 stays plain „PIWNICA”).
  return zMin < -1 && z < -1 ? `PIWNICA ${MINUS}${-z}` : 'PIWNICA';
}

/** Short label of the big map's floor selector: `4`, `P`, `−1`. */
export const floorShort = (z: number): string =>
  z === 0 ? 'P' : z < 0 ? `${MINUS}${-z}` : String(z);

/** Polish plural: 1 → one, 2–4 (not 12–14) → few, else many. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

/** Chip `5 KONDYGNACJI · P + 4 PIĘTRA` (levels above ground and the ground floor). */
export function storeysChip(zMin: number, zMax: number): string {
  const levels = zMax - zMin + 1;
  const ups = Math.max(0, zMax);
  const head = `${levels} ${plural(levels, 'KONDYGNACJA', 'KONDYGNACJE', 'KONDYGNACJI')}`;
  return ups > 0 ? `${head} · P + ${ups} ${plural(ups, 'PIĘTRO', 'PIĘTRA', 'PIĘTER')}` : head;
}

/** Map tag next to the selected building: `BLOK · P+4`, `DOM · P`. */
export const buildingTag = (kind: string, zMax: number): string =>
  `${kind} · ${zMax > 0 ? `P+${zMax}` : 'P'}`;

/** `3 KLATKI`, `1 KLATKA`. */
export const stairwellsChip = (n: number): string =>
  `${n} ${plural(n, 'KLATKA', 'KLATKI', 'KLATEK')}`;
