/**
 * Runs supabase/migrations on PGlite (Postgres in WASM) with minimal stubs of the Supabase
 * schemas (auth, storage, roles), then checks the rules the server relies on. No hosted project.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const DIR = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SUM = 'a'.repeat(64);

const STUB = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
grant execute on function auth.uid() to authenticated, service_role;
`;

let db: PGlite;

async function q(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await db.query<Record<string, unknown>>(sql, params)).rows;
}
async function as<T>(role: 'service_role' | 'authenticated', sub: string, fn: () => Promise<T>) {
  await db.exec(`set role ${role}`);
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [sub]);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const newCharacter = (user: string, name: string) =>
  q(
    `insert into public.characters (user_id, name, world_seed, worldgen_version)
     values ($1, $2, 5, 1) returning id`,
    [user, name],
  ).then((r) => r[0]!.id as string);
const commit = (user: string, id: string, expected: number, path: string, size = 100, day = 1) =>
  q(`select * from public.commit_save($1, $2, $3, $4, $5, $6, $7)`, [
    user,
    id,
    expected,
    path,
    size,
    SUM,
    day,
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  for (const f of readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(DIR + f, 'utf8'));
  }
  await q(`insert into auth.users (id) values ($1), ($2)`, [A, B]);
}, 60_000);

describe('migrations', () => {
  it('creates a profile on signup and the private saves bucket', async () => {
    expect(await q('select count(*)::int n from public.profiles')).toEqual([{ n: 2 }]);
    expect(await q(`select public from storage.buckets where id = 'saves'`)).toEqual([
      { public: false },
    ]);
  });

  it('enforces 20 alive characters, versioned saves, quota and permadeath', async () => {
    await as('service_role', '', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) ids.push(await newCharacter(A, `P${i}`));
      await expect(newCharacter(A, 'X')).rejects.toThrow('alive_character_limit');
      const [first, second] = ids as [string, string];

      expect(await commit(A, first, 0, 'p1')).toEqual([{ version: 1, previous_path: null }]);
      await expect(commit(A, first, 0, 'p2')).rejects.toThrow('save_version_conflict');
      expect(await commit(A, first, 1, 'p2', 100, 4)).toEqual([
        { version: 2, previous_path: 'p1' },
      ]);
      await expect(commit(B, first, 2, 'p3')).rejects.toThrow('character_not_found');
      await expect(commit(A, second, 0, 'q1', 52428790)).rejects.toThrow('save_quota_exceeded');

      const dead = await q(`select * from public.mark_character_dead($1, $2, 7)`, [A, first]);
      expect(dead[0]).toMatchObject({ storage_path: 'p2' });
      await expect(
        q(`select * from public.mark_character_dead($1, $2, 7)`, [A, first]),
      ).rejects.toThrow('character_dead');
      expect(
        await q(`select status, days_survived from public.characters where id = $1`, [first]),
      ).toEqual([{ status: 'dead', days_survived: 7 }]);
      expect(
        await q(`select count(*)::int n from public.saves where character_id = $1`, [first]),
      ).toEqual([{ n: 0 }]);
      await expect(commit(A, first, 0, 'p9')).rejects.toThrow('character_dead');
      await expect(
        q(`update public.characters set status = 'alive', died_at = null where id = $1`, [first]),
      ).rejects.toThrow('character_dead');
      await expect(
        q(`update public.characters set world_seed = 6 where id = $1`, [second]),
      ).rejects.toThrow('immutable');
      // A tombstone frees a slot.
      await newCharacter(A, 'Y');
    });
  });

  it('owners can only read their own rows; no client writes or RPC', async () => {
    await as('authenticated', B, async () => {
      expect(await q('select count(*)::int n from public.characters')).toEqual([{ n: 0 }]);
    });
    await as('authenticated', A, async () => {
      expect(await q('select count(*)::int n from public.characters')).toEqual([{ n: 21 }]);
      await expect(q(`update public.characters set name = 'z'`)).rejects.toThrow(
        'permission denied',
      );
      await expect(
        q(
          `insert into public.characters (user_id, name, world_seed, worldgen_version) values ($1, 'h', 1, 1)`,
          [A],
        ),
      ).rejects.toThrow('permission denied');
      await expect(q('delete from public.saves')).rejects.toThrow('permission denied');
      await expect(q(`select public.account_save_bytes($1)`, [A])).rejects.toThrow(
        'permission denied',
      );
      await expect(
        q(`insert into storage.objects (bucket_id, name) values ('saves', 'x')`),
      ).rejects.toThrow('row-level security');
    });
  });

  it('delete_character removes a character or tombstone with its save, owner only', async () => {
    await as('service_role', '', async () => {
      const c = await newCharacter(B, 'Del');
      await commit(B, c, 0, 'b1');
      await expect(q(`select * from public.delete_character($1, $2)`, [A, c])).rejects.toThrow(
        'character_not_found',
      );
      expect(await q(`select * from public.delete_character($1, $2)`, [B, c])).toEqual([
        { storage_path: 'b1' },
      ]);
      expect(await q(`select count(*)::int n from public.characters where id = $1`, [c])).toEqual([
        { n: 0 },
      ]);
      expect(
        await q(`select count(*)::int n from public.saves where character_id = $1`, [c]),
      ).toEqual([{ n: 0 }]);
      await expect(q(`select * from public.delete_character($1, $2)`, [B, c])).rejects.toThrow(
        'character_not_found',
      );

      const t = await newCharacter(B, 'Grave');
      await q(`select * from public.mark_character_dead($1, $2, 3)`, [B, t]);
      expect(await q(`select * from public.delete_character($1, $2)`, [B, t])).toEqual([
        { storage_path: null },
      ]);
    });
  });

  it('delete_account_data removes all rows of one account and returns its save paths', async () => {
    await as('service_role', '', async () => {
      const c1 = await newCharacter(B, 'B1');
      const c2 = await newCharacter(B, 'B2');
      await commit(B, c1, 0, 'bb1');
      await commit(B, c2, 0, 'bb2');
      await newCharacter(B, 'B3');
      const paths = await q(`select * from public.delete_account_data($1)`, [B]);
      expect(paths.map((r) => r.storage_path).sort()).toEqual(['bb1', 'bb2']);
      expect(
        await q(`select count(*)::int n from public.characters where user_id = $1`, [B]),
      ).toEqual([{ n: 0 }]);
      expect(await q(`select count(*)::int n from public.profiles where id = $1`, [B])).toEqual([
        { n: 0 },
      ]);
      // Account A is untouched.
      expect(
        await q(`select count(*)::int n from public.characters where user_id = $1`, [A]),
      ).toEqual([{ n: 21 }]);
    });
    await as('authenticated', B, async () => {
      await expect(q(`select * from public.delete_account_data($1)`, [B])).rejects.toThrow(
        'permission denied',
      );
      await expect(q(`select * from public.delete_character($1, $2)`, [B, A])).rejects.toThrow(
        'permission denied',
      );
    });
  });

  it('a character for a missing auth user fails with 23503 (server maps it to 401)', async () => {
    await as('service_role', '', async () => {
      const err = await newCharacter('44444444-4444-4444-8444-444444444444', 'Ghost').catch(
        (e: unknown) => e,
      );
      expect(err).toMatchObject({ code: '23503' });
    });
  });

  it('deleting the auth user removes everything', async () => {
    await q(`delete from auth.users where id = $1`, [A]);
    expect(await q('select count(*)::int n from public.characters')).toEqual([{ n: 0 }]);
  });
});
