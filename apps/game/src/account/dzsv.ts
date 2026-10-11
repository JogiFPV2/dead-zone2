import {
  DZSV_ENVELOPE_VERSION,
  DZSV_FLAG_GZIP,
  DZSV_HEADER_MAX_BYTES,
  DZSV_MAGIC,
  DZSV_PREFIX_BYTES,
  type CloudSaveReason,
  type SaveEnvelopeHeader,
} from '@deadzone/protocol';

/**
 * DZSV envelope (docs/backend.md §4.1) around the sim's save JSON: `DZSV`, u16 envelope version,
 * u16 flags (1 = gzip), u32 header length, UTF-8 JSON header, gzip of the state. Same layout as
 * the server's `parseEnvelope` (apps/server/src/save/envelope.ts).
 */
export interface EnvelopeMeta {
  characterId: string;
  worldSeed: number;
  worldgenVersion: number;
  gameDay: number;
  reason: CloudSaveReason;
  /** Save format of the state (sim `SAVE_VERSION`). */
  formatVersion: number;
  simVersion?: string;
  createdAt?: string;
}

async function gzip(bytes: Uint8Array, mode: 'gzip-in' | 'gzip-out'): Promise<Uint8Array> {
  const stream =
    mode === 'gzip-in' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Hex SHA-256 (`X-DZSV-SHA256`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sim save (UTF-8 JSON bytes) → DZSV envelope bytes. */
export async function encodeEnvelope(state: Uint8Array, m: EnvelopeMeta): Promise<Uint8Array> {
  const header: SaveEnvelopeHeader = {
    formatVersion: m.formatVersion,
    simVersion: m.simVersion ?? '0.1.0',
    world_seed: m.worldSeed,
    worldgen_version: m.worldgenVersion,
    characterId: m.characterId,
    gameDay: Math.max(0, Math.floor(m.gameDay)),
    reason: m.reason,
    rawSize: state.byteLength,
    createdAt: m.createdAt ?? new Date().toISOString(),
  };
  const h = new TextEncoder().encode(JSON.stringify(header));
  if (h.byteLength > DZSV_HEADER_MAX_BYTES) throw new Error('DZSV header too large');
  const body = await gzip(state, 'gzip-in');
  const out = new Uint8Array(DZSV_PREFIX_BYTES + h.byteLength + body.byteLength);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = DZSV_MAGIC.charCodeAt(i);
  view.setUint16(4, DZSV_ENVELOPE_VERSION, true);
  view.setUint16(6, DZSV_FLAG_GZIP, true);
  view.setUint32(8, h.byteLength, true);
  out.set(h, DZSV_PREFIX_BYTES);
  out.set(body, DZSV_PREFIX_BYTES + h.byteLength);
  return out;
}

/** DZSV envelope → header and the sim save bytes; throws on a malformed envelope. */
export async function decodeEnvelope(
  bytes: Uint8Array,
): Promise<{ header: SaveEnvelopeHeader; state: Uint8Array }> {
  if (bytes.byteLength < DZSV_PREFIX_BYTES + 2) throw new Error('DZSV: too short');
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== DZSV_MAGIC) throw new Error('DZSV: bad magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(4, true) !== DZSV_ENVELOPE_VERSION) throw new Error('DZSV: version');
  if (view.getUint16(6, true) !== DZSV_FLAG_GZIP) throw new Error('DZSV: flags');
  const len = view.getUint32(8, true);
  if (len < 2 || len > DZSV_HEADER_MAX_BYTES || DZSV_PREFIX_BYTES + len >= bytes.byteLength) {
    throw new Error('DZSV: header length');
  }
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(DZSV_PREFIX_BYTES, DZSV_PREFIX_BYTES + len)),
  ) as SaveEnvelopeHeader;
  const state = await gzip(bytes.subarray(DZSV_PREFIX_BYTES + len), 'gzip-out');
  return { header, state };
}
