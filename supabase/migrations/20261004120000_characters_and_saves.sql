-- Deadzone: profiles, characters ("1 character = 1 game") and current saves (docs/backend.md §3).
--
-- File only. Applying it to any hosted project needs Paweł's explicit approval
-- (docs/backend.md §10, step 8 [ZGODA]). Local dev: `supabase db reset`.
--
-- Access model: the owner may only SELECT their own rows (RLS). There are no client grants for
-- insert/update/delete and no Storage policies for clients: every write goes through apps/server
-- with the service role, which calls the functions below. Triggers repeat the product rules
-- (20 alive characters, 50 MiB of saves, permadeath) as a backstop for server bugs and races.

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user, created by the on_auth_user_created trigger.';

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  appearance jsonb not null default '{}'::jsonb check (jsonb_typeof(appearance) = 'object'),
  world_seed bigint not null check (world_seed between 0 and 4294967295),
  worldgen_version integer not null check (worldgen_version >= 1),
  world_settings jsonb not null default '{}'::jsonb check (jsonb_typeof(world_settings) = 'object'),
  status text not null default 'alive' check (status in ('alive', 'dead')),
  days_survived integer not null default 0 check (days_survived >= 0),
  created_at timestamptz not null default now(),
  last_played_at timestamptz,
  died_at timestamptz,
  constraint characters_died_at_matches_status check (
    (status = 'alive' and died_at is null) or (status = 'dead' and died_at is not null)
  )
);

comment on table public.characters is
  'A character is one game with its own world (seed, generator, settings). Dead rows are tombstones.';

-- Covers the user_id FK, the owner list and the alive-limit count.
create index characters_user_id_status_idx on public.characters (user_id, status);
-- New characters per day (rate limit).
create index characters_user_id_created_at_idx on public.characters (user_id, created_at);

create table public.saves (
  character_id uuid primary key references public.characters (id) on delete cascade,
  storage_path text not null unique,
  version integer not null check (version >= 1),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 52428800),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  game_day integer not null check (game_day >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.saves is
  'Exactly one current DZSV save per character; overwritten with optimistic concurrency, no history.';

-- ---------------------------------------------------------------------------------------------
-- Row level security: owner read-only
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.characters enable row level security;
alter table public.saves enable row level security;

revoke all on public.profiles, public.characters, public.saves from anon, authenticated;
grant select on public.profiles, public.characters, public.saves to authenticated;
grant all on public.profiles, public.characters, public.saves to service_role;

create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "characters: owner can read"
  on public.characters for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "saves: owner can read"
  on public.saves for select to authenticated
  using (
    exists (
      select 1 from public.characters c
      where c.id = saves.character_id and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Profile on signup
-- ---------------------------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Guards (backstop for the rules apps/server already checks)
-- ---------------------------------------------------------------------------------------------

-- Serializes writes of one account (alive-limit and quota checks are then race free).
create function public.lock_account(p_user uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('deadzone:account:' || p_user::text, 0));
$$;

create function public.characters_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'alive' then
    raise exception 'invalid_state: a character is created alive';
  end if;
  perform public.lock_account(new.user_id);
  if (select count(*) from public.characters c where c.user_id = new.user_id and c.status = 'alive') >= 20 then
    raise exception 'alive_character_limit';
  end if;
  return new;
end;
$$;

create trigger characters_before_insert
  before insert on public.characters
  for each row execute function public.characters_before_insert();

create function public.characters_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.world_seed <> old.world_seed
     or new.worldgen_version <> old.worldgen_version or new.created_at <> old.created_at then
    raise exception 'invalid_state: id, user_id, world_seed, worldgen_version and created_at are immutable';
  end if;
  if old.status = 'dead' then
    -- Permadeath: a tombstone never changes again (no resurrection, no further play).
    raise exception 'character_dead';
  end if;
  return new;
end;
$$;

create trigger characters_before_update
  before update on public.characters
  for each row execute function public.characters_before_update();

create function public.saves_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_status text;
  v_used bigint;
begin
  -- Row lock on the character: a concurrent death waits for this save (and vice versa).
  select c.user_id, c.status into v_user, v_status
    from public.characters c where c.id = new.character_id for update;
  if v_status is distinct from 'alive' then
    raise exception 'character_dead';
  end if;
  if tg_op = 'UPDATE' and new.version <> old.version + 1 then
    raise exception 'save_version_conflict';
  end if;
  perform public.lock_account(v_user);
  select coalesce(sum(s.size_bytes), 0) into v_used
    from public.saves s join public.characters c on c.id = s.character_id
    where c.user_id = v_user and s.character_id <> new.character_id;
  if v_used + new.size_bytes > 52428800 then
    raise exception 'save_quota_exceeded';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger saves_before_write
  before insert or update on public.saves
  for each row execute function public.saves_before_write();

-- ---------------------------------------------------------------------------------------------
-- Server operations (service_role only)
-- ---------------------------------------------------------------------------------------------

-- Bytes of all current saves of an account (quota, 50 MiB).
create function public.account_save_bytes(p_user uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(s.size_bytes), 0)::bigint
    from public.saves s join public.characters c on c.id = s.character_id
    where c.user_id = p_user;
$$;

-- Overwrites the single current save if `p_expected_version` matches (0 = no save yet).
-- Returns the new version and the previous blob path (to delete after commit).
create function public.commit_save(
  p_user uuid,
  p_character uuid,
  p_expected_version integer,
  p_storage_path text,
  p_size_bytes integer,
  p_checksum text,
  p_game_day integer
)
returns table (version integer, previous_path text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old public.saves%rowtype;
begin
  if not exists (
    select 1 from public.characters c where c.id = p_character and c.user_id = p_user
  ) then
    raise exception 'character_not_found';
  end if;

  select * into v_old from public.saves s where s.character_id = p_character for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'save_version_conflict';
    end if;
    insert into public.saves (character_id, storage_path, version, size_bytes, checksum, game_day)
      values (p_character, p_storage_path, 1, p_size_bytes, p_checksum, p_game_day)
      on conflict (character_id) do nothing;
    if not found then
      raise exception 'save_version_conflict';
    end if;
    version := 1;
    previous_path := null;
  else
    if v_old.version <> p_expected_version then
      raise exception 'save_version_conflict';
    end if;
    update public.saves s
      set storage_path = p_storage_path,
          version = v_old.version + 1,
          size_bytes = p_size_bytes,
          checksum = p_checksum,
          game_day = p_game_day
      where s.character_id = p_character;
    version := v_old.version + 1;
    previous_path := v_old.storage_path;
  end if;

  update public.characters c
    set last_played_at = now(), days_survived = greatest(c.days_survived, p_game_day)
    where c.id = p_character;
  return next;
end;
$$;

-- Permadeath in one transaction: tombstone + removal of the save row. Returns the blob path to
-- delete (null if there was no cloud save). Raises character_dead if already dead.
create function public.mark_character_dead(p_user uuid, p_character uuid, p_days_survived integer)
returns table (storage_path text, died_at timestamptz)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_status text;
begin
  select c.status into v_status
    from public.characters c where c.id = p_character and c.user_id = p_user for update;
  if not found then
    raise exception 'character_not_found';
  end if;
  if v_status = 'dead' then
    raise exception 'character_dead';
  end if;

  update public.characters c
    set status = 'dead',
        died_at = now(),
        days_survived = greatest(c.days_survived, p_days_survived),
        last_played_at = now()
    where c.id = p_character
    returning c.died_at into died_at;
  delete from public.saves s where s.character_id = p_character returning s.storage_path into storage_path;
  return next;
end;
$$;

revoke execute on function
  public.handle_new_user(),
  public.lock_account(uuid),
  public.characters_before_insert(),
  public.characters_before_update(),
  public.saves_before_write(),
  public.account_save_bytes(uuid),
  public.commit_save(uuid, uuid, integer, text, integer, text, integer),
  public.mark_character_dead(uuid, uuid, integer)
from public, anon, authenticated;

grant execute on function
  public.lock_account(uuid),
  public.account_save_bytes(uuid),
  public.commit_save(uuid, uuid, integer, text, integer, text, integer),
  public.mark_character_dead(uuid, uuid, integer)
to service_role;

-- ---------------------------------------------------------------------------------------------
-- Storage: private bucket for DZSV blobs
-- ---------------------------------------------------------------------------------------------

-- Path: {user_id}/{character_id}/v{version}.dzsv, written by the server only. Clients download
-- through short-lived signed URLs created by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saves', 'saves', false, 52428800, array['application/octet-stream'])
on conflict (id) do nothing;

-- No permissive policies for clients on this bucket. The restrictive policy keeps it closed
-- even if a broader storage policy is added later; the service role bypasses RLS.
create policy "saves bucket: no direct client access"
  on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'saves')
  with check (bucket_id <> 'saves');
