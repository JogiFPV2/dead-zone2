import type { SaveEnvelopeHeader } from '@deadzone/protocol';
import { parseEnvelope } from './envelope.js';
import { validateState } from './state.js';

export interface ValidateOptions {
  /** Newest accepted sim save version; older ones the sim can still load are accepted too. */
  saveFormatVersion: number;
  maxStateBytes: number;
}

/** What the routes need from a valid envelope; the state itself stays in the worker. */
export interface ValidatedEnvelope {
  header: SaveEnvelopeHeader;
  sha256: string;
  sizeBytes: number;
}

/** Full DZSV check (envelope, gunzip, JSON, state schema). Throws `HttpError`. */
export function validateEnvelope(bytes: Uint8Array, opts: ValidateOptions): ValidatedEnvelope {
  const env = parseEnvelope(bytes, opts);
  validateState(env.state, env.header.formatVersion, env.header.world_seed);
  return { header: env.header, sha256: env.sha256, sizeBytes: env.sizeBytes };
}
