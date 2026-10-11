import type { NamedPoint } from '@deadzone/content/places';
import type { LastLocation, SaveEnvelopeHeader } from '@deadzone/protocol';
import { parseEnvelope } from './envelope.js';
import {
  stateMinuteOfDay,
  summarizeLocation,
  type SaveSummaryFn,
  type SummaryResult,
} from './location.js';
import { validateState } from './state.js';

export interface ValidateOptions {
  /** Newest accepted sim save version; older ones the sim can still load are accepted too. */
  saveFormatVersion: number;
  maxStateBytes: number;
  /** `world_settings.dayLengthMinutes` of the character (the sim clock is not in the save). */
  dayLengthMinutes?: number | undefined;
  /** Named places of the character's map (`world_settings.map`); null = none, `place` stays null. */
  places?: readonly NamedPoint[] | null | undefined;
}

/** What the routes need from a valid envelope; the state itself stays in the worker. */
export interface ValidatedEnvelope {
  header: SaveEnvelopeHeader;
  sha256: string;
  sizeBytes: number;
  /** Sanitized `saveSummary` of the validated state; null when the summary failed. */
  location: LastLocation | null;
  /** Minute of the game day of the state (sim clock over `tick`, 0..1439). */
  minuteOfDay: number;
  /** Why `location` is null (for the log); the save itself is valid. */
  summaryFailure?: SummaryResult['failure'];
}

/**
 * Full DZSV check (envelope, gunzip, JSON, state schema). Throws `HttpError`. The location summary
 * runs only on a state that passed validation.
 */
export function validateEnvelope(
  bytes: Uint8Array,
  opts: ValidateOptions,
  summary?: SaveSummaryFn,
): ValidatedEnvelope {
  const env = parseEnvelope(bytes, opts);
  const state = validateState(env.state, env.header.formatVersion, env.header.world_seed);
  const { location, failure } = summarizeLocation(
    state,
    summary,
    { dayLengthMinutes: opts.dayLengthMinutes },
    opts.places,
  );
  return {
    header: env.header,
    sha256: env.sha256,
    sizeBytes: env.sizeBytes,
    location,
    minuteOfDay: stateMinuteOfDay(state.tick, opts.dayLengthMinutes),
    ...(failure ? { summaryFailure: failure } : {}),
  };
}

/** Validates DZSV envelopes: worker threads on Node (`worker-pool.ts`), inline on the Edge. */
export interface SaveValidator {
  validate(bytes: Uint8Array, opts: ValidateOptions): Promise<ValidatedEnvelope>;
  close(): Promise<void>;
}

/**
 * Validation in the calling isolate (Supabase Edge Function: no worker threads). The platform's
 * per-request CPU and memory limits take the place of the worker timeout and heap cap.
 */
export function createInlineValidator(): SaveValidator {
  return {
    validate: (bytes, opts) => {
      try {
        return Promise.resolve(validateEnvelope(bytes, opts));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    },
    close: () => Promise.resolve(),
  };
}
