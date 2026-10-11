import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  DZSV_ENVELOPE_VERSION,
  DZSV_FLAG_GZIP,
  DZSV_HEADER_MAX_BYTES,
  DZSV_MAGIC,
  DZSV_PREFIX_BYTES,
  type SaveEnvelopeHeader,
} from '@deadzone/protocol';
import { saveEnvelopeHeaderSchema } from '@deadzone/protocol/schema';
import { SAVE_READABLE_VERSIONS } from '@deadzone/sim';
import { HttpError, invalidEnvelope, invalidState } from '../errors.js';

export interface ParsedEnvelope {
  header: SaveEnvelopeHeader;
  /** Uncompressed canonical state JSON. */
  state: unknown;
  sha256: string;
  sizeBytes: number;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Parses a DZSV envelope (docs/backend.md §4.1): magic, envelope version, flags, header length,
 * zod header, then gunzip with an output limit and JSON. Body size is limited by Fastify.
 */
export function parseEnvelope(
  bytes: Uint8Array,
  opts: { saveFormatVersion: number; maxStateBytes: number },
): ParsedEnvelope {
  if (bytes.length < DZSV_PREFIX_BYTES + 2) throw invalidEnvelope('envelope too short');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== DZSV_MAGIC) throw invalidEnvelope('bad magic');
  const envelopeVersion = view.getUint16(4, true);
  if (envelopeVersion > DZSV_ENVELOPE_VERSION) {
    throw new HttpError(
      426,
      'unsupported_format_version',
      'envelope version is newer than the server',
    );
  }
  if (envelopeVersion !== DZSV_ENVELOPE_VERSION) throw invalidEnvelope('unknown envelope version');
  const flags = view.getUint16(6, true);
  if (flags !== DZSV_FLAG_GZIP) throw invalidEnvelope('state must be gzip, no other flags');
  const headerLength = view.getUint32(8, true);
  if (headerLength < 2 || headerLength > DZSV_HEADER_MAX_BYTES) {
    throw invalidEnvelope('bad header length');
  }
  const bodyStart = DZSV_PREFIX_BYTES + headerLength;
  if (bodyStart >= bytes.length) throw invalidEnvelope('missing state');

  let rawHeader: unknown;
  try {
    rawHeader = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        bytes.subarray(DZSV_PREFIX_BYTES, bodyStart),
      ),
    );
  } catch {
    throw invalidEnvelope('header is not UTF-8 JSON');
  }
  const parsed = saveEnvelopeHeaderSchema.safeParse(rawHeader);
  if (!parsed.success) throw invalidEnvelope('invalid header');
  const header = parsed.data;

  // Every version the sim can load up to the configured newest one (docs/backend.md §4.3): the
  // sim migrates v1/v2 on load and the next autosave writes the current version.
  if (header.formatVersion > opts.saveFormatVersion) {
    throw new HttpError(
      426,
      'unsupported_format_version',
      `save format ${header.formatVersion} is newer than the server (${opts.saveFormatVersion})`,
    );
  }
  if (!SAVE_READABLE_VERSIONS.includes(header.formatVersion)) {
    throw new HttpError(
      426,
      'unsupported_format_version',
      `save format ${header.formatVersion} is no longer supported`,
    );
  }
  if (header.rawSize > opts.maxStateBytes) {
    throw new HttpError(413, 'payload_too_large', 'state too large');
  }

  let raw: Uint8Array;
  try {
    raw = gunzipSync(bytes.subarray(bodyStart), { maxOutputLength: opts.maxStateBytes });
  } catch (err) {
    if (err instanceof RangeError || (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new HttpError(413, 'payload_too_large', 'state too large');
    }
    throw invalidEnvelope('state is not valid gzip');
  }
  if (raw.length !== header.rawSize) throw invalidState('rawSize does not match the state');

  let state: unknown;
  try {
    state = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw invalidEnvelope('state is not UTF-8 JSON');
  }
  return { header, state, sha256: sha256Hex(bytes), sizeBytes: bytes.length };
}
