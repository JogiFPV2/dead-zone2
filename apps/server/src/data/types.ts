import type { CharacterStatus, LastLocation } from '@deadzone/protocol';

/** `public.characters` row (supabase/migrations). */
export interface CharacterRow {
  id: string;
  user_id: string;
  name: string;
  appearance: Record<string, unknown>;
  world_seed: number;
  worldgen_version: number;
  world_settings: Record<string, unknown>;
  status: CharacterStatus;
  days_survived: number;
  created_at: string;
  last_played_at: string | null;
  died_at: string | null;
  /** Last location (from the save summary, set by `commit_save`); all null before the first. */
  last_place: string | null;
  last_x: number | null;
  last_y: number | null;
  last_z: number | null;
  last_day: number | null;
}

/** `public.saves` row: exactly one current save per character. */
export interface SaveRow {
  character_id: string;
  storage_path: string;
  version: number;
  size_bytes: number;
  checksum: string;
  game_day: number;
  /** Minute of the game day (0..1439); null for rows from before the column. */
  minute_of_day: number | null;
  updated_at: string;
}

/** Settings columns of `public.profiles`. */
export interface SettingsRow {
  settings: Record<string, unknown> | null;
  settings_version: number;
  settings_updated_at: string | null;
}

/** `public.profiles` row (without the settings columns, see `SettingsRow`). */
export interface ProfileRow {
  id: string;
  display_name: string | null;
  created_at: string;
}

export interface NewCharacter {
  user_id: string;
  name: string;
  appearance: Record<string, unknown>;
  world_seed: number;
  worldgen_version: number;
  world_settings: Record<string, unknown>;
}

export interface CommitSave {
  userId: string;
  characterId: string;
  /** 0 = no save yet. */
  expectedVersion: number;
  storagePath: string;
  sizeBytes: number;
  checksum: string;
  gameDay: number;
  /** Minute of the game day of the validated state (0..1439). */
  minuteOfDay: number | null;
  /** Server-derived summary of the validated save; null keeps the stored location. */
  location: LastLocation | null;
}

/** Rule violations the database reports (trigger / function exceptions). */
export type DataRuleCode =
  | 'alive_character_limit'
  | 'save_quota_exceeded'
  | 'save_version_conflict'
  | 'character_dead'
  | 'character_not_found'
  /** The token's user has no account rows any more (deleted). */
  | 'account_not_found'
  /** `put_player_settings`: stale `If-Match`. */
  | 'settings_version_conflict';

export class DataRuleError extends Error {
  constructor(readonly code: DataRuleCode) {
    super(code);
    this.name = 'DataRuleError';
  }
}

/** Database operations of the server (service role). Implementations must be atomic per call. */
export interface GameStore {
  /** The account's profile row exists (created at signup, removed by account deletion). */
  accountExists(userId: string): Promise<boolean>;
  listCharacters(userId: string): Promise<CharacterRow[]>;
  getCharacter(userId: string, characterId: string): Promise<CharacterRow | undefined>;
  countAliveCharacters(userId: string): Promise<number>;
  countCharactersCreatedSince(userId: string, sinceIso: string): Promise<number>;
  /** Throws `DataRuleError('alive_character_limit')` when the account is full. */
  insertCharacter(c: NewCharacter): Promise<CharacterRow>;
  listSaves(userId: string): Promise<SaveRow[]>;
  getSave(characterId: string): Promise<SaveRow | undefined>;
  accountSaveBytes(userId: string): Promise<number>;
  /**
   * Compare-and-swap of the current save; returns the new version and the previous blob path.
   * Throws `DataRuleError` (`save_version_conflict`, `character_dead`, `save_quota_exceeded`).
   */
  commitSave(c: CommitSave): Promise<{ version: number; previousPath: string | null }>;
  /** Permadeath: tombstone + delete the save row in one transaction. */
  markDead(
    userId: string,
    characterId: string,
    daysSurvived: number,
  ): Promise<{ storagePath: string | null; diedAt: string }>;
  /**
   * Deletes the character row (alive or tombstone) and its save row in one transaction.
   * Returns the save path still referenced at delete time (a save may have committed meanwhile).
   * Throws `DataRuleError('character_not_found')`.
   */
  deleteCharacter(userId: string, characterId: string): Promise<{ storagePath: string | null }>;
  /** The profile row; `undefined` without one (deleted account). */
  getProfile(userId: string): Promise<ProfileRow | undefined>;
  /** Player settings of the profile; `undefined` without a profile row (deleted account). */
  getSettings(userId: string): Promise<SettingsRow | undefined>;
  /**
   * Compare-and-swap of the settings; returns the new row. Throws `DataRuleError`
   * (`settings_version_conflict`, `account_not_found`).
   */
  putSettings(
    userId: string,
    expectedVersion: number,
    settings: Record<string, unknown>,
  ): Promise<SettingsRow>;
  /** RODO: deletes all characters, saves and the profile of an account; returns remaining paths. */
  deleteAccountData(userId: string): Promise<{ storagePaths: string[] }>;
}

/** Private Storage bucket for DZSV blobs. */
export interface BlobStore {
  put(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  /**
   * Removes every object under `{prefix}/` (recursively); returns how many were removed.
   * `prefix` is `{user_id}` or `{user_id}/{character_id}`, never empty.
   */
  removePrefix(prefix: string): Promise<number>;
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
}

/** Supabase Auth admin API (service role). */
export interface AccountAdmin {
  /** Deletes the auth user; an already deleted user counts as success (retries). */
  deleteUser(userId: string): Promise<void>;
  /** The auth user still exists. */
  userExists(userId: string): Promise<boolean>;
}
