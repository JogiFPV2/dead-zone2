/**
 * Cloud saves HTTP API `/v1` (docs/backend.md §5): character model "1 character = 1 game", one
 * current DZSV save per character, permadeath. Types and limits only; zod schemas live in
 * `@deadzone/protocol/schema` (`api-schema.ts`).
 */

import { MAP_CHUNKS } from './map.js';

/** Product limits (docs/backend.md §5.5). The server may lower them via env, never raise. */
export const MAX_ALIVE_CHARACTERS = 20;
export const MAX_ACCOUNT_SAVE_BYTES = 50 * 1024 * 1024;
export const MAX_NEW_CHARACTERS_PER_DAY = 10;
/** HTTP rate limits (§5.5): save/death uploads per account, upload bytes per day, requests per IP. */
export const MAX_SAVES_PER_HOUR = 120;
export const MAX_UPLOAD_BYTES_PER_DAY = 200 * 1024 * 1024;
export const MAX_IP_REQUESTS_PER_5_MIN = 300;
export const CHARACTER_NAME_MAX = 40;
/** Serialized size limit of `appearance` and `world_settings` (UTF-8 JSON bytes). */
export const CHARACTER_JSON_MAX_BYTES = 4096;

/** DZSV envelope (docs/backend.md §4.1). */
export const DZSV_MAGIC = 'DZSV';
export const DZSV_ENVELOPE_VERSION = 1;
export const DZSV_FLAG_GZIP = 1;
export const DZSV_PREFIX_BYTES = 12;
export const DZSV_HEADER_MAX_BYTES = 8 * 1024;
/** Worker `SaveReason`s (docs/backend.md §5.3) plus `death` for the final snapshot (§3.5). */
export const CLOUD_SAVE_REASONS = ['autosave', 'sleep', 'exit', 'manual', 'death'] as const;
export type CloudSaveReason = (typeof CLOUD_SAVE_REASONS)[number];

/** Player map limits inside the state (docs/backend.md §4.2). */
/** @deprecated Use `MAP_CHUNKS` (map.ts); kept as an alias. */
export const WORLD_CHUNKS_PER_SIDE = MAP_CHUNKS;
/** One bit per chunk: 512 × 512 / 8 = 32 KiB raw. */
export const EXPLORED_BITMAP_BYTES = (MAP_CHUNKS * MAP_CHUNKS) / 8;
export const MAX_MAP_MARKERS = 200;
export const MAP_MARKER_TEXT_MAX = 40;
/**
 * Map marker icons (content ids, drawn by the client). Single source for the sim, the client and
 * the server's save validation; Symulacja's `worldSettings.mapMarkers.icons` default (#109) is the
 * same list.
 */
export const MAP_MARKER_ICONS = [
  'base:marker-food',
  'base:marker-danger',
  'base:marker-zombies',
  'base:marker-loot',
  'base:marker-base',
  'base:marker-car',
  'base:marker-water',
  'base:marker-note',
] as const;
export type MapMarkerIcon = (typeof MAP_MARKER_ICONS)[number];
export const SAVE_MARKER_COLORS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
export type SaveMarkerColor = (typeof SAVE_MARKER_COLORS)[number];

export interface SaveEnvelopeHeader {
  formatVersion: number;
  simVersion: string;
  world_seed: number;
  worldgen_version: number;
  characterId: string;
  gameDay: number;
  reason: CloudSaveReason;
  /** Size of the uncompressed state JSON in bytes. */
  rawSize: number;
  /** ISO 8601 timestamp of the client. */
  createdAt: string;
}

export type CharacterStatus = 'alive' | 'dead';

export interface CharacterSummary {
  id: string;
  name: string;
  appearance: Record<string, unknown>;
  worldSeed: number;
  worldgenVersion: number;
  worldSettings: Record<string, unknown>;
  status: CharacterStatus;
  daysSurvived: number;
  createdAt: string;
  lastPlayedAt: string | null;
  diedAt: string | null;
  /** Current save metadata; null for tombstones and characters without a cloud save yet. */
  save: { version: number; sizeBytes: number; gameDay: number; updatedAt: string } | null;
}

export interface ListCharactersResponse {
  characters: CharacterSummary[];
  limits: { maxAlive: number; alive: number; maxSaveBytes: number; usedSaveBytes: number };
}

export interface CreateCharacterRequest {
  name: string;
  appearance?: Record<string, unknown> | undefined;
  world_settings?: Record<string, unknown> | undefined;
}

export interface OpenSaveResponse {
  characterId: string;
  /** 0 = no cloud save yet (the next `PUT` sends `If-Match: 0`). */
  version: number;
  url: string | null;
  checksum: string | null;
  sizeBytes: number;
  expiresInSeconds: number;
}

export interface PutSaveResponse {
  characterId: string;
  version: number;
  sizeBytes: number;
  checksum: string;
  gameDay: number;
}

export type ApiErrorCode =
  | 'bad_request'
  | 'invalid_envelope'
  | 'checksum_mismatch'
  | 'unauthorized'
  | 'forbidden'
  | 'character_not_found'
  | 'save_version_conflict'
  | 'character_dead'
  | 'alive_character_limit'
  | 'payload_too_large'
  | 'save_quota_exceeded'
  | 'invalid_state'
  | 'unsupported_format_version'
  | 'rate_limited'
  | 'unavailable'
  | 'internal';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}
