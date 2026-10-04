import {
  createClock,
  dayOf,
  DEFAULT_CLOCK_START,
  DEFAULT_DAY_LENGTH_MINUTES,
  gameMinuteAt,
  type ClockStart,
} from '../core/clock.js';
import { fromBase64, utf8Decode } from './codec.js';
import { SAVE_FORMAT, SAVE_READABLE_VERSIONS, SaveError } from './format.js';

/**
 * Save summary for lists (server, „Kontynuuj”): where the character stands and which game day it
 * is, read straight from a save (v1–v3) without loading it. Light entry
 * `@deadzone/sim/save-summary`: no bitecs, worker, DOM or content — only the JSON of the save.
 */

/** A named place of the world plan (e.g. `planWorld(...).settlements`): centre in tiles. */
export interface SummaryPlace {
  name: string;
  x: number;
  y: number;
}

export interface SaveSummaryOptions {
  /** Named places (world plan settlements); none / empty → `place` null. */
  places?: readonly SummaryPlace[] | undefined;
  /** `worldSettings.dayLengthMinutes` of the game (not in the save; default 60). */
  dayLengthMinutes?: number | undefined;
  /** Game clock start (`createSim({ clockStart })`; default day 1, 09:00). */
  clockStart?: ClockStart | undefined;
  /** Which player (default 0 = the local / first character). */
  playerId?: number | undefined;
}

export interface SaveSummary {
  /** Player position in tiles (= metres), f32 as saved. */
  x: number;
  y: number;
  /** Level (floor, integer; 0 = ground). */
  z: number;
  /** Name of the nearest place of `places`, null without places. */
  place: string | null;
  /** Game day (1 = first day). */
  day: number;
}

interface SummaryFields {
  format?: unknown;
  version?: unknown;
  tick?: unknown;
  players?: unknown;
  components?: { Position?: { x?: unknown; y?: unknown; z?: unknown } };
}

function asFile(save: unknown): SummaryFields {
  let v = save;
  try {
    if (v instanceof ArrayBuffer) v = new Uint8Array(v);
    if (v instanceof Uint8Array) v = utf8Decode(v);
    if (typeof v === 'string') v = JSON.parse(v) as unknown;
  } catch {
    throw new SaveError('not-a-save', 'save: not a Deadzone save');
  }
  const f = v as SummaryFields | null;
  if (!f || typeof f !== 'object' || f.format !== SAVE_FORMAT)
    throw new SaveError('not-a-save', 'save: not a Deadzone save');
  if (typeof f.version !== 'number' || !SAVE_READABLE_VERSIONS.includes(f.version))
    throw new SaveError('unsupported-version', `save: unsupported version ${String(f.version)}`);
  return f;
}

/** Element `eid` of a saved typed array (`{$t: 'Float32Array', b: base64}`). */
function f32At(field: unknown, eid: number): number {
  const t = field as { $t?: unknown; b?: unknown } | undefined;
  if (!t || t.$t !== 'Float32Array' || typeof t.b !== 'string')
    throw new SaveError('corrupt', 'save: no player position');
  const bytes = fromBase64(t.b);
  if ((eid + 1) * 4 > bytes.length) throw new SaveError('corrupt', 'save: no player position');
  const copy = new Uint8Array(4);
  copy.set(bytes.subarray(eid * 4, eid * 4 + 4));
  return new Float32Array(copy.buffer)[0]!;
}

/** Nearest place to (x, y) (ties: first in the list), or null. */
export function nearestPlace(
  places: readonly SummaryPlace[] | undefined,
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

/**
 * `{x, y, z, place, day}` of a save: the parsed save JSON (as the server stores it), or its
 * bytes / text (`saveWorld` output). Throws `SaveError` (`not-a-save`, `unsupported-version`,
 * `corrupt` when the player is missing).
 */
export function saveSummary(save: unknown, opts: SaveSummaryOptions = {}): SaveSummary {
  const f = asFile(save);
  const pid = opts.playerId ?? 0;
  const entry = Array.isArray(f.players)
    ? (f.players as unknown[]).find((p) => Array.isArray(p) && p[0] === pid)
    : undefined;
  const eid = (entry as [number, number] | undefined)?.[1];
  if (typeof eid !== 'number' || !Number.isInteger(eid) || eid < 0)
    throw new SaveError('corrupt', `save: no player ${pid}`);
  const pos = f.components?.Position;
  const x = f32At(pos?.x, eid);
  const y = f32At(pos?.y, eid);
  const z = Math.floor(f32At(pos?.z, eid));
  const tick = typeof f.tick === 'number' && f.tick >= 0 ? f.tick : 0;
  const clock = createClock(
    opts.dayLengthMinutes ?? DEFAULT_DAY_LENGTH_MINUTES,
    opts.clockStart ?? DEFAULT_CLOCK_START,
  );
  return { x, y, z, place: nearestPlace(opts.places, x, y), day: dayOf(gameMinuteAt(clock, tick)) };
}

export { SaveError, type SaveErrorCode } from './format.js';
