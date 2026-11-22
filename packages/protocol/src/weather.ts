import { dayOfYearForGameDay } from './sun.js';

/**
 * Weather and the moon (protocol 50, docs 9.45 / 9.90): shared, pure functions so the sim (light,
 * sight, hearing, cold, wetness) and the renderer (sky, rain, snow, fog, lightning) agree.
 * Determinism: no `Date`, no state; the weather of a world is a function of its seed and the game
 * minute (see `weatherAt`), so it needs no save and is the same on every engine.
 */
export const WEATHER_KINDS = ['clear', 'overcast', 'rain', 'storm', 'fog', 'snow'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

/** What one kind of weather does (values at full strength; the sim blends them in transitions). */
export interface WeatherEffects {
  /** Cloud cover 0..1: dims the sky and the moon, softens shadows. */
  cloud: number;
  /** Sight range × this (players and zombies), on top of the light. */
  sightMul: number;
  /** Noise radius × this (rain and wind mask footsteps). */
  hearingMul: number;
  /** Added to the ambient temperature (°C). */
  tempC: number;
  /** Wetness gained per game minute outdoors (0..100 scale of the `wetness` stat). */
  wetPerMin: number;
}

export const WEATHER_EFFECTS: Readonly<Record<WeatherKind, WeatherEffects>> = {
  clear: { cloud: 0.1, sightMul: 1, hearingMul: 1, tempC: 0, wetPerMin: 0 },
  overcast: { cloud: 0.85, sightMul: 0.95, hearingMul: 1, tempC: -2, wetPerMin: 0 },
  rain: { cloud: 0.95, sightMul: 0.8, hearingMul: 0.7, tempC: -4, wetPerMin: 0.6 },
  storm: { cloud: 1, sightMul: 0.65, hearingMul: 0.5, tempC: -5, wetPerMin: 1.2 },
  fog: { cloud: 0.6, sightMul: 0.45, hearingMul: 1, tempC: -3, wetPerMin: 0.05 },
  snow: { cloud: 0.9, sightMul: 0.7, hearingMul: 0.85, tempC: -22, wetPerMin: 0.2 },
};

/**
 * Chance weights per kind in summer and in winter (Polish climate, roughly); spring and autumn
 * blend them by the day of year. No snow in summer, no storms in winter.
 */
export const WEATHER_WEIGHTS: Readonly<Record<'summer' | 'winter', Record<WeatherKind, number>>> = {
  summer: { clear: 42, overcast: 24, rain: 18, storm: 9, fog: 7, snow: 0 },
  winter: { clear: 22, overcast: 34, rain: 8, storm: 0, fog: 16, snow: 20 },
};

/** Weather now (`SimViewPatch.weather`): the kind and the blended strength of its effects. */
export interface WeatherView {
  kind: WeatherKind;
  /** The kind it is turning from (same as `kind` once the transition is over). */
  from: WeatherKind;
  /** Progress of the transition `from` → `kind`, 0..1 (rounded to 0.05). */
  blend: number;
  /** Blended effects (rounded to 0.05; `tempC` to 0.5). */
  cloud: number;
  sightMul: number;
  hearingMul: number;
  tempC: number;
  /** Lit fraction of the moon 0..1 (0 = new, 1 = full; rounded to 0.05). */
  moon: number;
  /** Snow lying on the ground 0..1 (`snowCover`; rounded to 0.05). */
  snow: number;
}

/**
 * Snow on the ground: grows while it snows (full after `growMinutes`), melts afterwards at a rate
 * per kind (minutes from full to none; rain melts fast, overcast and fog slowly).
 */
export const SNOW_COVER = {
  growMinutes: 120,
  meltMinutes: { clear: 300, overcast: 720, rain: 90, storm: 90, fog: 720, snow: 0 } as Record<
    WeatherKind,
    number
  >,
  /** Spells of history looked at (older snow has melted by then). */
  memorySpells: 8,
};

export interface WeatherTiming {
  /** Game minutes of one weather spell (a new kind may start at every spell boundary). */
  spellMinutes: number;
  /** Game minutes of the transition at the start of a spell. */
  fadeMinutes: number;
}

export const DEFAULT_WEATHER_TIMING: WeatherTiming = { spellMinutes: 360, fadeMinutes: 40 };

const MINUTES_PER_DAY = 1440;
const TAU = Math.PI * 2;
const r05 = (v: number): number => Math.round(v * 20) / 20;

/** Deterministic 0..1 hash of (seed, n) (integer mixing, same on every engine). */
function hash01(seed: number, n: number): number {
  let h = Math.imul(seed | 0, 0x27d4eb2d) ^ Math.imul(n | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 0 in high summer (around 15 July), 1 in deep winter (around 15 January). */
export function winterness(dayOfYear: number): number {
  return Math.round(((1 + Math.cos((TAU * (dayOfYear - 15)) / 365)) / 2) * 1e6) / 1e6;
}

/** Kind of weather of spell `n` (absolute spell index) on `dayOfYear`. */
export function spellKind(seed: number, n: number, dayOfYear: number): WeatherKind {
  const w = winterness(dayOfYear);
  let total = 0;
  for (const k of WEATHER_KINDS)
    total += WEATHER_WEIGHTS.summer[k] * (1 - w) + WEATHER_WEIGHTS.winter[k] * w;
  let u = hash01(seed, n) * total;
  for (const k of WEATHER_KINDS) {
    u -= WEATHER_WEIGHTS.summer[k] * (1 - w) + WEATHER_WEIGHTS.winter[k] * w;
    if (u < 0) return k;
  }
  return 'clear';
}

/** Synodic month (days). */
export const SYNODIC_DAYS = 29.530588853;
/**
 * Moon age (days since new moon) at game day 1, 00:00 = 3 July 1993 (from the new moon of 6 Jan
 * 2000, 18:14 UTC; the full moon came late that evening).
 */
export const GAME_START_MOON_AGE = 13.21;

/** Moon age in days (0 = new, ~14.77 = full) at an absolute game minute (day 1 starts at 0). */
export function moonAge(absMinute: number): number {
  const days = absMinute / MINUTES_PER_DAY + GAME_START_MOON_AGE;
  return ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
}

/** Lit fraction of the moon 0..1 at an absolute game minute. */
export function moonIllumination(absMinute: number): number {
  const phase = (TAU * moonAge(absMinute)) / SYNODIC_DAYS;
  return Math.round(((1 - Math.cos(phase)) / 2) * 1e6) / 1e6;
}

/**
 * Weather at an absolute game minute (`minute` counted from game day 1, 00:00 = 0) of a world with
 * `seed`. Spells of `spellMinutes`; each spell picks a kind by the season; the first
 * `fadeMinutes` blend from the previous spell's kind.
 */
export function weatherAt(
  seed: number,
  minute: number,
  timing: WeatherTiming = DEFAULT_WEATHER_TIMING,
  forced?: WeatherKind,
): WeatherView {
  const n = Math.floor(minute / timing.spellMinutes);
  const into = minute - n * timing.spellMinutes;
  const doy = (m: number) => dayOfYearForGameDay(Math.floor(m / MINUTES_PER_DAY) + 1);
  const kind = forced ?? spellKind(seed, n, doy(minute));
  const from = forced ?? spellKind(seed, n - 1, doy(Math.max(0, minute - into - 1)));
  const t = from === kind ? 1 : Math.min(1, into / Math.max(1, timing.fadeMinutes));
  const a = WEATHER_EFFECTS[from];
  const b = WEATHER_EFFECTS[kind];
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    kind,
    from: t >= 1 ? kind : from,
    blend: r05(t),
    cloud: r05(mix(a.cloud, b.cloud)),
    sightMul: r05(mix(a.sightMul, b.sightMul)),
    hearingMul: r05(mix(a.hearingMul, b.hearingMul)),
    tempC: Math.round(mix(a.tempC, b.tempC) * 2) / 2,
    moon: r05(moonIllumination(minute)),
    snow: r05(snowCover(seed, minute, timing, forced)),
  };
}

/** Snow lying on the ground 0..1 at `minute` (from the last `memorySpells` spells). */
export function snowCover(
  seed: number,
  minute: number,
  timing: WeatherTiming = DEFAULT_WEATHER_TIMING,
  forced?: WeatherKind,
): number {
  if (forced) return forced === 'snow' ? 1 : 0;
  const len = timing.spellMinutes;
  const n = Math.floor(minute / len);
  let cover = 0;
  for (let k = n - SNOW_COVER.memorySpells; k <= n; k++) {
    const start = Math.max(0, k * len);
    const end = Math.min(minute, k * len + len);
    const dur = end - start;
    if (dur <= 0) continue;
    const kind = spellKind(seed, k, dayOfYearForGameDay(Math.floor(start / MINUTES_PER_DAY) + 1));
    if (kind === 'snow') cover = Math.min(1, cover + dur / SNOW_COVER.growMinutes);
    else cover = Math.max(0, cover - dur / SNOW_COVER.meltMinutes[kind]);
  }
  return cover;
}

/** Wetness per game minute outdoors of a view (blended like the other effects). */
export function weatherWetPerMin(v: WeatherView): number {
  const a = WEATHER_EFFECTS[v.from].wetPerMin;
  const b = WEATHER_EFFECTS[v.kind].wetPerMin;
  return a + (b - a) * v.blend;
}
