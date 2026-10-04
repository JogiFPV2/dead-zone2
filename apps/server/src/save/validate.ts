import type { LastLocation, SaveEnvelopeHeader } from '@deadzone/protocol';
import { parseEnvelope } from './envelope.js';
import { summarizeLocation, type SaveSummaryFn, type SummaryResult } from './location.js';
import { validateState } from './state.js';

export interface ValidateOptions {
  /** Newest accepted sim save version; older ones the sim can still load are accepted too. */
  saveFormatVersion: number;
  maxStateBytes: number;
  /** `world_settings.dayLengthMinutes` of the character (the sim clock is not in the save). */
  dayLengthMinutes?: number | undefined;
}

/** What the routes need from a valid envelope; the state itself stays in the worker. */
export interface ValidatedEnvelope {
  header: SaveEnvelopeHeader;
  sha256: string;
  sizeBytes: number;
  /** Sanitized `saveSummary` of the validated state; null when the summary failed. */
  location: LastLocation | null;
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
  const { location, failure } = summarizeLocation(state, summary, {
    dayLengthMinutes: opts.dayLengthMinutes,
  });
  return {
    header: env.header,
    sha256: env.sha256,
    sizeBytes: env.sizeBytes,
    location,
    ...(failure ? { summaryFailure: failure } : {}),
  };
}
