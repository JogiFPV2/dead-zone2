import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from '../config.js';
import type { Database } from './database.js';
import {
  DataRuleError,
  type BlobStore,
  type DataRuleCode,
  type GameStore,
  type SaveRow,
} from './types.js';

const RULES: readonly DataRuleCode[] = [
  'alive_character_limit',
  'save_quota_exceeded',
  'save_version_conflict',
  'character_dead',
  'character_not_found',
];

interface PgError {
  message: string;
  code?: string;
}

/** Maps a PostgREST error to a rule violation raised by the migration, or a plain error. */
function fail(error: PgError): never {
  const rule = RULES.find((r) => error.message.startsWith(r));
  if (rule) throw new DataRuleError(rule);
  // 23505 on the saves primary key = concurrent first save.
  if (error.code === '23505') throw new DataRuleError('save_version_conflict');
  throw new Error(`database error ${error.code ?? ''}`.trim());
}

const CHARACTER_COLUMNS =
  'id,user_id,name,appearance,world_seed,worldgen_version,world_settings,status,days_survived,created_at,last_played_at,died_at';
const SAVE_COLUMNS = 'character_id,storage_path,version,size_bytes,checksum,game_day,updated_at';

type Db = SupabaseClient<Database>;

export function createServiceClient(config: ServerConfig): Db {
  return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createSupabaseStore(db: Db): GameStore {
  return {
    async listCharacters(userId) {
      const { data, error } = await db
        .from('characters')
        .select(CHARACTER_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) fail(error);
      return data;
    },
    async getCharacter(userId, characterId) {
      const { data, error } = await db
        .from('characters')
        .select(CHARACTER_COLUMNS)
        .eq('user_id', userId)
        .eq('id', characterId)
        .maybeSingle();
      if (error) fail(error);
      return data ?? undefined;
    },
    async countAliveCharacters(userId) {
      const { count, error } = await db
        .from('characters')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'alive');
      if (error) fail(error);
      return count ?? 0;
    },
    async countCharactersCreatedSince(userId, sinceIso) {
      const { count, error } = await db
        .from('characters')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', sinceIso);
      if (error) fail(error);
      return count ?? 0;
    },
    async insertCharacter(c) {
      const { data, error } = await db
        .from('characters')
        .insert(c)
        .select(CHARACTER_COLUMNS)
        .single();
      if (error) fail(error);
      return data;
    },
    async listSaves(userId) {
      const { data, error } = await db
        .from('saves')
        .select(`${SAVE_COLUMNS},characters!inner(user_id)`)
        .eq('characters.user_id', userId);
      if (error) fail(error);
      return (data as (SaveRow & { characters: unknown })[]).map(({ characters: _c, ...s }) => s);
    },
    async getSave(characterId) {
      const { data, error } = await db
        .from('saves')
        .select(SAVE_COLUMNS)
        .eq('character_id', characterId)
        .maybeSingle();
      if (error) fail(error);
      return data ?? undefined;
    },
    async accountSaveBytes(userId) {
      const { data, error } = await db.rpc('account_save_bytes', { p_user: userId });
      if (error) fail(error);
      return Number(data ?? 0);
    },
    async commitSave(c) {
      const { data, error } = await db
        .rpc('commit_save', {
          p_user: c.userId,
          p_character: c.characterId,
          p_expected_version: c.expectedVersion,
          p_storage_path: c.storagePath,
          p_size_bytes: c.sizeBytes,
          p_checksum: c.checksum,
          p_game_day: c.gameDay,
        })
        .single();
      if (error) fail(error);
      const row = data;
      return { version: row.version, previousPath: row.previous_path };
    },
    async markDead(userId, characterId, daysSurvived) {
      const { data, error } = await db
        .rpc('mark_character_dead', {
          p_user: userId,
          p_character: characterId,
          p_days_survived: daysSurvived,
        })
        .single();
      if (error) fail(error);
      const row = data;
      return { storagePath: row.storage_path, diedAt: row.died_at };
    },
  };
}

export function createSupabaseBlobStore(db: Db, bucket: string): BlobStore {
  const b = () => db.storage.from(bucket);
  return {
    async put(path, bytes) {
      const { error } = await b().upload(path, bytes, {
        contentType: 'application/octet-stream',
        upsert: false,
      });
      if (error) throw new Error('storage upload failed');
    },
    async remove(path) {
      const { error } = await b().remove([path]);
      if (error) throw new Error('storage remove failed');
    },
    async signedUrl(path, ttlSeconds) {
      const { data, error } = await b().createSignedUrl(path, ttlSeconds);
      if (error) throw new Error('storage signed url failed');
      return data.signedUrl;
    },
  };
}
