/**
 * Sun position for Stalowa Wola — one shared, pure function so the renderer (sun light,
 * shadows) and the sim (light level, zombie sight) agree on where the sun is.
 *
 * World axes (same as `apps/game/src/sim/coords.ts` `simToWorld` and the sim grid):
 * - world +X = sim +x = **east**
 * - world +Y = **up** (sim `z` levels × floor height)
 * - world +Z = sim +y = **south** (the sim's y grows to the south, the map is north-up)
 * so **north = −Z**.
 *
 * Assumptions:
 * - `timeOfDayHours` is **local apparent solar time** (12:00 = sun due south, highest). No time
 *   zone, DST or equation of time — the game clock is treated as a sundial.
 * - Declination from the day of year (Cooper's formula, ±23.44°, error < ~1°); no refraction.
 * - The sim only counts days: `dayOfYearForGameDay` maps game day 1 to `GAME_START_DAY_OF_YEAR`.
 *
 * Determinism: no `Date`, no state, no dependencies — the same inputs always give the same
 * result in one JS engine. Results are rounded to 1e-9 so tiny last-bit differences of
 * `Math.sin`/`Math.cos` between engines (browser vs. server) don't leak into sim decisions.
 */

/** Stalowa Wola (degrees). */
export const SUN_LATITUDE_DEG = 50.58;
export const SUN_LONGITUDE_DEG = 22.05;

/**
 * Game day 1 = 3 July 1993 = day 184 of the year (same as the HUD calendar,
 * `apps/game/src/hud/v2/calendar.ts` `CALENDAR_START`): summer, long days.
 */
export const GAME_START_DAY_OF_YEAR = 184;

export interface SunPosition {
  /** Compass bearing of the sun, radians clockwise from north (0 = N, π/2 = E, π = S, 3π/2 = W). */
  readonly azimuth: number;
  /** Height above the horizon, radians (negative = below, i.e. night). */
  readonly elevation: number;
  /** True when `elevation > 0`. */
  readonly aboveHorizon: boolean;
  /** Unit vector from the ground **towards the sun** in world axes (+X east, +Y up, +Z south). */
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const AXIAL_TILT = 23.44 * DEG;
const DAYS_PER_YEAR = 365;
const round9 = (v: number): number => {
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r; // no -0
};

/** Game day (from 1) → day of year 1..365 (wraps every 365 days). */
export function dayOfYearForGameDay(
  gameDay: number,
  startDayOfYear: number = GAME_START_DAY_OF_YEAR,
): number {
  const d = Math.floor(startDayOfYear - 1 + (gameDay - 1));
  return (((d % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) + 1;
}

/** Solar declination (radians) for a day of year 1..365 (Cooper 1969). */
export function solarDeclination(dayOfYear: number): number {
  return AXIAL_TILT * Math.sin((TAU * (284 + dayOfYear)) / DAYS_PER_YEAR);
}

/**
 * Sun position at Stalowa Wola for local solar time `timeOfDayHours` (0..24, fractions allowed,
 * wraps) on `dayOfYear` (1..365, fractions allowed). Pure and deterministic.
 */
export function sunAt(
  timeOfDayHours: number,
  dayOfYear: number,
  latitudeDeg: number = SUN_LATITUDE_DEG,
): SunPosition {
  const lat = latitudeDeg * DEG;
  const dec = solarDeclination(dayOfYear);
  const h = (((timeOfDayHours % 24) + 24) % 24) - 12;
  const hourAngle = h * 15 * DEG; // negative before noon (east), positive after (west)

  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  const cosH = Math.cos(hourAngle);
  const sinH = Math.sin(hourAngle);

  const sinEl = Math.max(-1, Math.min(1, sinLat * sinDec + cosLat * cosDec * cosH));
  const elevation = Math.asin(sinEl);
  // Bearing from north, clockwise. atan2 gives it measured from south; + π turns it to north.
  let azimuth = Math.atan2(sinH, cosH * sinLat - (sinDec / cosDec) * cosLat) + Math.PI;
  azimuth = ((azimuth % TAU) + TAU) % TAU;

  const cosEl = Math.cos(elevation);
  return {
    azimuth: round9(azimuth),
    elevation: round9(elevation),
    aboveHorizon: elevation > 0,
    direction: {
      x: round9(cosEl * Math.sin(azimuth)), // east
      y: round9(sinEl), // up
      z: round9(-cosEl * Math.cos(azimuth)), // south (north = −Z)
    },
  };
}
