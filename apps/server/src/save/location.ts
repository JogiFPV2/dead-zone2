import { MAP_SIZE_M } from '@deadzone/protocol';
import type { LastLocation } from '@deadzone/protocol';
import {
  DEFAULT_CLOCK_START,
  DEFAULT_DAY_LENGTH_MINUTES,
  createClock,
  gameMinuteAt,
  minuteOfDay,
} from '@deadzone/sim';
import { nearestPlace, type NamedPoint } from '@deadzone/content/places';
import { SaveError, saveSummary, type SaveSummaryOptions } from '@deadzone/sim/save-summary';

export type { SaveSummaryOptions };

/**
 * Last location of a character for the character card (docs/backend.md §5.1). It is derived from
 * the validated save state by the sim's `saveSummary` (light entry, no bitecs/DOM) inside the
 * validation worker; nothing the client sends besides the save itself is trusted. A failing or
 * broken summary gives `null` and never fails a save that passed validation.
 *
 * `place` is the nearest named place (`nearestPlace` of `@deadzone/content/places`) of the places
 * file of the character's map (`world_settings.map`, `loadPlaces` of `@deadzone/content/node`),
 * looked up by the route and passed to the worker. Maps without a places file keep `place` null.
 */

/** Longest stored place name (`characters.last_place`, code points). */
export const MAX_PLACE_CHARS = 64;
/** Floor range kept (`characters.last_z`, smallint check -128..127). */
export const MIN_Z = -128;
export const MAX_Z = 127;
/** `characters.last_day` is an `integer`. */
const MAX_DAY = 0x7fff_ffff;

/** `saveSummary(state, opts)` of `@deadzone/sim/save-summary` (#155); injectable for tests. */
export type SaveSummaryFn = (state: unknown, opts: SaveSummaryOptions) => unknown;

const defaultSaveSummary: SaveSummaryFn = (state, opts) => saveSummary(state, opts);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Control and format characters (incl. bidi overrides) never reach the UI.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function placeName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const cut = [...clean].slice(0, MAX_PLACE_CHARS).join('').trim();
  return cut || null;
}

/**
 * Checks and clamps a `saveSummary` result: x/y are finite metres clamped to the map, z an
 * integer floor clamped to `MIN_Z..MAX_Z`, day a non-negative integer, place a trimmed name of at
 * most `MAX_PLACE_CHARS` (anything else becomes null). Non-numeric coordinates or day → `null`.
 */
export function sanitizeLocation(raw: unknown): LastLocation | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  const z = s.z === undefined || s.z === null ? 0 : s.z;
  if (!finite(s.x) || !finite(s.y) || !finite(z) || !finite(s.day)) return null;
  return {
    place: placeName(s.place),
    x: Math.fround(clamp(s.x, 0, MAP_SIZE_M)),
    y: Math.fround(clamp(s.y, 0, MAP_SIZE_M)),
    z: clamp(Math.round(z), MIN_Z, MAX_Z),
    day: clamp(Math.floor(s.day), 0, MAX_DAY),
  };
}

/**
 * Minute of the game day (0..1439) at `tick`, with the same clock as `saveSummary` (day length of
 * the character, default start day 1 09:00): the clock is not stored in the save.
 */
export function stateMinuteOfDay(tick: number, dayLengthMinutes?: number): number {
  const clock = createClock(dayLengthMinutes ?? DEFAULT_DAY_LENGTH_MINUTES, DEFAULT_CLOCK_START);
  return minuteOfDay(gameMinuteAt(clock, Math.max(0, tick)));
}

/** Why no location came out of a validated save (logged by the route, never fails the save). */
export type SummaryFailure = 'save-error' | 'invalid-summary' | 'error';

export interface SummaryResult {
  location: LastLocation | null;
  /** Set when the summary threw or returned unusable values; `code` of a sim `SaveError`. */
  failure?: { kind: SummaryFailure; code?: string };
}

/**
 * Runs the sim summary on the validated state. A throw (`SaveError` with `not-a-save`,
 * `unsupported-version`, `corrupt`, or anything else) or unusable values give a null location and
 * a `failure` for the log.
 */
export function summarizeLocation(
  state: unknown,
  fn: SaveSummaryFn = defaultSaveSummary,
  opts: SaveSummaryOptions = {},
  /** Places of the character's map; null/undefined = no places file. */
  places?: readonly NamedPoint[] | null,
): SummaryResult {
  let raw: unknown;
  try {
    raw = fn(state, opts);
  } catch (err) {
    return {
      location: null,
      failure:
        err instanceof SaveError ? { kind: 'save-error', code: err.code } : { kind: 'error' },
    };
  }
  const location = sanitizeLocation(raw);
  if (!location) return { location: null, failure: { kind: 'invalid-summary' } };
  if (places && places.length > 0) {
    location.place = placeName(nearestPlace(places, location.x, location.y));
  }
  return { location };
}
