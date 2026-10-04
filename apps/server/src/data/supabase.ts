import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ServerConfig } from '../config.js';
import type { Database } from './database.js';
import {
  DataRuleError,
  type AccountAdmin,
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
  'account_not_found',
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
  // 23503 = foreign key to auth.users: the account was deleted while the token is still valid.
  if (error.code === '23503') throw new DataRuleError('account_not_found');
  throw new Error(`database error ${error.code ?? ''}`.trim());
}

const CHARACTER_COLUMNS =
  'id,user_id,name,appearance,world_seed,worldgen_version,world_settings,status,days_survived,created_at,last_played_at,died_at,last_place,last_x,last_y,last_z,last_day';
const SAVE_COLUMNS = 'character_id,storage_path,version,size_bytes,checksum,game_day,updated_at';

type Db = SupabaseClient<Database>;

export function createServiceClient(config: ServerConfig): Db {
  return createClient<Database>(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createSupabaseStore(db: Db): GameStore {
  return {
    async accountExists(userId) {
      const { data, error } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (error) fail(error);
      return data !== null;
    },
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
          p_last_place: c.location?.place ?? null,
          p_last_x: c.location?.x ?? null,
          p_last_y: c.location?.y ?? null,
          p_last_z: c.location?.z ?? null,
          p_last_day: c.location?.day ?? null,
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
    async deleteCharacter(userId, characterId) {
      const { data, error } = await db
        .rpc('delete_character', { p_user: userId, p_character: characterId })
        .single();
      if (error) fail(error);
      return { storagePath: data.storage_path };
    },
    async deleteAccountData(userId) {
      const { data, error } = await db.rpc('delete_account_data', { p_user: userId });
      if (error) fail(error);
      return { storagePaths: data.map((r) => r.storage_path) };
    },
  };
}

/** `{user_id}` or `{user_id}/{character_id}`: guards against wiping the whole bucket. */
const BLOB_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;
const LIST_PAGE = 1000;
const LIST_MAX_DEPTH = 3;

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
    async removePrefix(prefix) {
      if (!BLOB_PREFIX.test(prefix)) throw new Error('invalid storage prefix');
      const files: string[] = [];
      const walk = async (dir: string, depth: number): Promise<void> => {
        for (let offset = 0; ; offset += LIST_PAGE) {
          const { data, error } = await b().list(dir, { limit: LIST_PAGE, offset });
          if (error) throw new Error('storage list failed');
          for (const e of data) {
            const path = `${dir}/${e.name}`;
            // Folders are listed without an id.
            if (e.id === null) {
              if (depth < LIST_MAX_DEPTH) await walk(path, depth + 1);
            } else {
              files.push(path);
            }
          }
          if (data.length < LIST_PAGE) break;
        }
      };
      await walk(prefix, 1);
      for (let i = 0; i < files.length; i += LIST_PAGE) {
        const { error } = await b().remove(files.slice(i, i + LIST_PAGE));
        if (error) throw new Error('storage remove failed');
      }
      return files.length;
    },
    async signedUrl(path, ttlSeconds) {
      const { data, error } = await b().createSignedUrl(path, ttlSeconds);
      if (error) throw new Error('storage signed url failed');
      return data.signedUrl;
    },
  };
}

export function createSupabaseAccountAdmin(db: Db): AccountAdmin {
  return {
    async deleteUser(userId) {
      const { error } = await db.auth.admin.deleteUser(userId);
      // 404 = already deleted by an earlier attempt.
      if (error && error.status !== 404) throw new Error('auth user delete failed');
    },
    async userExists(userId) {
      const { data, error } = await db.auth.admin.getUserById(userId);
      if (error) {
        if (error.status === 404) return false;
        throw new Error('auth user lookup failed');
      }
      return data.user !== null;
    },
  };
}
