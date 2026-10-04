-- Deadzone: player settings in the cloud (docs/backend.md §3.1, §5.1 `GET`/`PUT /v1/me/settings`).
--
-- File only. Applying it to any hosted project needs Paweł's explicit approval
-- (docs/backend.md §10, step 8 [ZGODA]).
--
-- apps/server validates the body with `validatePlayerSettings` (@deadzone/ui/settings, 16 KB) and
-- stores only its output. The owner keeps read-only access to their profile row (RLS unchanged);
-- writes go through put_player_settings (service_role only) with optimistic concurrency.

alter table public.profiles
  add column settings jsonb check (
    settings is null or (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 32768)
  ),
  -- ETag of the settings: 0 = never stored, +1 per write.
  add column settings_version integer not null default 0 check (settings_version >= 0),
  add column settings_updated_at timestamptz;

comment on column public.profiles.settings is
  'Player settings (validated by apps/server, max 16 KB as JSON); written by put_player_settings only.';

-- Compare-and-swap of the settings: `p_expected_version` must equal the stored version.
-- Returns the new version and its time. Raises account_not_found (no profile) or settings_version_conflict.
create function public.put_player_settings(
  p_user uuid,
  p_expected_version integer,
  p_settings jsonb
)
returns table (version integer, updated_at timestamptz)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_version integer;
begin
  select p.settings_version into v_version
    from public.profiles p where p.id = p_user for update;
  if not found then
    raise exception 'account_not_found';
  end if;
  if v_version <> p_expected_version then
    raise exception 'settings_version_conflict';
  end if;
  update public.profiles p
    set settings = p_settings,
        settings_version = v_version + 1,
        settings_updated_at = now()
    where p.id = p_user
    returning p.settings_updated_at into updated_at;
  version := v_version + 1;
  return next;
end;
$$;

revoke execute on function public.put_player_settings(uuid, integer, jsonb)
from public, anon, authenticated;

grant execute on function public.put_player_settings(uuid, integer, jsonb) to service_role;
