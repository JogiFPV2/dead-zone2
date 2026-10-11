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
/** `GET /v1/me/export` per account per hour. */
export const MAX_EXPORTS_PER_HOUR = 5;
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
/** Trail of the character map: a point every 16 m, at most 20 000 points (docs/backend.md §4.2). */
export const PLAYER_MAP_TRAIL_SPACING_M = 16;
export const PLAYER_MAP_TRAIL_MAX_POINTS = 20_000;
/** Floor plan: at most this many rooms per character (protocol 22, sim-architecture 9.42). */
export const MAX_MAP_ROOMS = 20_000;
/** Saved rooms (`PlayerMapSave.rooms`): base64 of at most 15 varint bytes per room. */
export const MAX_MAP_ROOMS_CHARS = Math.ceil((MAX_MAP_ROOMS * 15) / 3) * 4;
/** `WorldMapView.zombieSightings`: newest observations kept per character. */
export const MAX_ZOMBIE_SIGHTINGS = 64;
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

/**
 * Where the character was at the last cloud save (character card). The server derives it from the
 * validated save (sim `saveSummary`), never from client fields.
 */
export interface LastLocation {
  /** Nearest settlement of the world plan (max 64 characters); null when unknown. */
  place: string | null;
  /** Metres on the map (0..MAP_SIZE_M). */
  x: number;
  y: number;
  /** Floor. */
  z: number;
  /** Game day of the save. */
  day: number;
}

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
  /** Last location for the card; null for tombstones and before the first save with a summary. */
  lastLocation: LastLocation | null;
}

/** Account storage for „12 / 50 MB” and the alive counter. */
export interface AccountUsage {
  /** Bytes of all current saves of the account. */
  usedBytes: number;
  /** Save quota of the account (50 MiB). */
  limitBytes: number;
  /** Alive characters. */
  alive: number;
  /** Alive character limit (20). */
  aliveLimit: number;
}

export interface ListCharactersResponse {
  characters: CharacterSummary[];
  limits: { maxAlive: number; alive: number; maxSaveBytes: number; usedSaveBytes: number };
  usage: AccountUsage;
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
  | 'internal'
  /** `PUT /v1/me/settings` without `If-Match`. */
  | 'precondition_required'
  /** `PUT /v1/me/settings` with a stale `If-Match`: reload with `GET`. */
  | 'settings_version_conflict'
  /** Settings failed `validatePlayerSettings`; details in `issues`. */
  | 'invalid_settings';

export interface ApiError {
  error: ApiErrorCode;
  message: string;
  /** `invalid_settings`: zod issues of `validatePlayerSettings` (path, code, message). */
  issues?: { path: (string | number)[]; code: string; message: string }[];
}

/**
 * Body of `409 save_version_conflict` from `PUT /v1/characters/:id/save`: the `ApiError` fields plus
 * the save currently on the server (null when the server has none, e.g. never uploaded).
 */
export interface SaveConflictError extends ApiError {
  error: 'save_version_conflict';
  server: SaveConflictServer | null;
}

/** The current server save named by a 409 `save_version_conflict`. */
export interface SaveConflictServer {
  version: number;
  gameDay: number;
  /** Minute of the game day (0..1439, sim clock); null for saves stored before it was recorded. */
  minuteOfDay: number | null;
  updatedAt: string;
}

/**
 * `GET /v1/me/export` (RODO, data access): everything the server keeps about the account, as one
 * JSON download. Save blobs are not inlined: each living save carries a short-lived signed URL.
 */
export interface AccountExport {
  format: 'deadzone-account-export';
  formatVersion: 1;
  exportedAt: string;
  profile: { id: string; displayName: string | null; createdAt: string };
  settings: PlayerSettingsResponse;
  usage: AccountUsage;
  /** All characters, tombstones included. */
  characters: AccountExportCharacter[];
}

export interface AccountExportCharacter extends Omit<CharacterSummary, 'save' | 'lastLocation'> {
  /** Stored last location (kept for tombstones too). */
  lastLocation: LastLocation | null;
  /** Current save of a living character; null for tombstones and characters without a save. */
  save: AccountExportSave | null;
}

export interface AccountExportSave {
  version: number;
  sizeBytes: number;
  /** SHA-256 of the DZSV envelope (hex). */
  sha256: string;
  gameDay: number;
  minuteOfDay: number | null;
  updatedAt: string;
  /** Signed URL of the DZSV blob (private bucket), valid for `expiresInSeconds`. */
  downloadUrl: string;
  expiresInSeconds: number;
}

/**
 * `GET /v1/me/settings` and the `PUT` answer. `version` is also the `ETag` (`"<version>"`); the next
 * `PUT` sends it in `If-Match`. `settings` null (version 0) = never stored, use the defaults.
 */
export interface PlayerSettingsResponse {
  /** `PlayerSettings` of `@deadzone/ui/settings` as stored (validated by the server). */
  settings: Record<string, unknown> | null;
  version: number;
  updatedAt: string | null;
}
