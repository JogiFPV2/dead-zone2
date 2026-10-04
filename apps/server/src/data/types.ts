import type { CharacterStatus } from '@deadzone/protocol';

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
}

/** `public.saves` row: exactly one current save per character. */
export interface SaveRow {
  character_id: string;
  storage_path: string;
  version: number;
  size_bytes: number;
  checksum: string;
  game_day: number;
  updated_at: string;
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
}

/** Rule violations the database reports (trigger / function exceptions). */
export type DataRuleCode =
  | 'alive_character_limit'
  | 'save_quota_exceeded'
  | 'save_version_conflict'
  | 'character_dead'
  | 'character_not_found';

export class DataRuleError extends Error {
  constructor(readonly code: DataRuleCode) {
    super(code);
    this.name = 'DataRuleError';
  }
}

/** Database operations of the server (service role). Implementations must be atomic per call. */
export interface GameStore {
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
}
