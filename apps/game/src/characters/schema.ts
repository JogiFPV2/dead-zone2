/**
 * The „one character = one slot” save model (permadeath). Records mirror the planned cloud
 * schema one to one, so a future sync is a thin adapter over {@link CharacterBackend}:
 *
 *   characters(id uuid pk, name, appearance jsonb, world_seed int, world_settings jsonb,
 *              generator_version int, status 'alive'|'dead', days_survived int,
 *              death_cause text null, created_at, last_played_at, died_at null)
 *   saves(character_id uuid pk → characters.id on delete cascade, version int, saved_at,
 *         tick int, day int, minute_of_day int null, reason text, data bytea)
 *
 * Columns are the camelCase fields below in snake_case; timestamps are epoch ms locally.
 * `saves` has at most one row per character (its primary key is the character id); every write
 * bumps `version` and only lands when the writer saw the current version (optimistic lock).
 */
import type { CharacterSpec } from '@deadzone/protocol';
import type { RenderLook } from '../creator/appearance-map.js';

/**
 * Most LIVING characters a player may have (approved cloud plan). Tombstones (dead characters)
 * do not count and stay until deleted.
 */
export const MAX_LIVING_CHARACTERS = 20;
/** Bump when the world generator / map content changes what a seed produces. */
export const WORLD_GENERATOR_VERSION = 1;

export type CharacterStatus = 'alive' | 'dead';

/** Colours of the card portrait (mockup characters.png). */
export interface Portrait {
  readonly skin: string;
  readonly hair: string;
  readonly shirt: string;
}

export interface CharacterAppearance {
  readonly portrait: Portrait;
  /** The creator's choice (absent for a character migrated from the old single save). */
  readonly spec?: CharacterSpec | undefined;
  readonly look?: RenderLook | undefined;
}

export interface WorldSettings {
  /** Map preset (`test-town`, …). */
  readonly map: string;
  readonly mode: 'survive' | 'rescue';
}

export interface CharacterRecord {
  readonly id: string;
  readonly name: string;
  readonly appearance: CharacterAppearance;
  readonly worldSeed: number;
  readonly worldSettings: WorldSettings;
  readonly generatorVersion: number;
  readonly status: CharacterStatus;
  readonly daysSurvived: number;
  /** Death cause (sim `DeathCause`), tombstones only. */
  readonly deathCause: string | null;
  readonly createdAt: number;
  readonly lastPlayedAt: number;
  readonly diedAt: number | null;
}

export interface SaveRecord {
  readonly characterId: string;
  /** 1 for the first save, +1 per write. */
  readonly version: number;
  readonly savedAt: number;
  readonly tick: number;
  readonly day: number;
  readonly minuteOfDay: number | null;
  /** `exit` | `autosave` | `sleep` | `migrated` | … */
  readonly reason: string;
  /** The sim's save blob. */
  readonly data: ArrayBuffer;
}

/** Character fields a save write refreshes. */
export type CharacterPatch = Partial<Pick<CharacterRecord, 'lastPlayedAt' | 'daysSurvived'>>;

/** Outcome of a conditional save write. */
export type PutSaveResult = { ok: true; version: number } | { ok: false; currentVersion: number };

/**
 * Storage boundary (IndexedDB now, the cloud tables later). `putSaveIfVersion` must be atomic:
 * it writes only when the stored version equals `expectedVersion` (0 = no save yet).
 */
export interface CharacterBackend {
  listCharacters(): Promise<CharacterRecord[]>;
  getCharacter(id: string): Promise<CharacterRecord | undefined>;
  putCharacter(c: CharacterRecord): Promise<void>;
  /** Deletes the character and its save. */
  deleteCharacter(id: string): Promise<void>;
  getSave(characterId: string): Promise<SaveRecord | undefined>;
  /** Current save version (0 = none) without reading the blob. */
  getSaveVersion(characterId: string): Promise<number>;
  /**
   * Writes the save when the character is alive and its save is at `expectedVersion`, applying
   * `patch` to the character in the same step (cloud: one RPC / transaction).
   */
  putSaveIfVersion(
    save: SaveRecord,
    expectedVersion: number,
    patch?: CharacterPatch,
  ): Promise<PutSaveResult>;
  /**
   * Death: marks the character dead and deletes its save in one step, but only when the save is
   * still at `expectedVersion` (a stale tab must not kill newer progress).
   */
  buryIfVersion(dead: CharacterRecord, expectedVersion: number): Promise<PutSaveResult>;
}
