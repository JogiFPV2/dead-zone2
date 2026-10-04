-- Deadzone: last location of a character for the character card (docs/backend.md §3.2, §5.1).
--
-- File only. Applying it to any hosted project needs Paweł's explicit approval
-- (docs/backend.md §10, step 8 [ZGODA]).
--
-- The location never comes from the client: apps/server derives it from the validated save state
-- (`saveSummary` of packages/sim, in the validation worker) and passes it to commit_save, which
-- stores it in the same transaction as the save. Owner access stays read-only (RLS unchanged).

alter table public.characters
  add column last_place text check (last_place is null or char_length(last_place) between 1 and 64),
  add column last_x real check (last_x is null or (last_x >= 0 and last_x <= 1048576)),
  add column last_y real check (last_y is null or (last_y >= 0 and last_y <= 1048576)),
  add column last_z smallint check (last_z is null or last_z between -128 and 127),
  add column last_day integer check (last_day is null or last_day >= 0),
  -- Coordinates and day come as one summary; a place name needs a position.
  add constraint characters_last_location_complete check (
    (last_x is null and last_y is null and last_z is null and last_day is null and last_place is null)
    or (last_x is not null and last_y is not null and last_z is not null and last_day is not null)
  );

comment on column public.characters.last_place is
  'Nearest settlement at the last save (sim saveSummary), set by commit_save only.';

-- commit_save gains an optional location summary. The new parameters default to null, so the
-- seven-argument call keeps working; without a summary the previous location is kept.
drop function public.commit_save(uuid, uuid, integer, text, integer, text, integer);

create function public.commit_save(
  p_user uuid,
  p_character uuid,
  p_expected_version integer,
  p_storage_path text,
  p_size_bytes integer,
  p_checksum text,
  p_game_day integer,
  p_last_place text default null,
  p_last_x real default null,
  p_last_y real default null,
  p_last_z smallint default null,
  p_last_day integer default null
)
returns table (version integer, previous_path text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_old public.saves%rowtype;
  v_has_location boolean :=
    p_last_x is not null and p_last_y is not null and p_last_z is not null and p_last_day is not null;
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
    set last_played_at = now(),
        days_survived = greatest(c.days_survived, p_game_day),
        last_place = case when v_has_location then nullif(p_last_place, '') else c.last_place end,
        last_x = case when v_has_location then p_last_x else c.last_x end,
        last_y = case when v_has_location then p_last_y else c.last_y end,
        last_z = case when v_has_location then p_last_z else c.last_z end,
        last_day = case when v_has_location then p_last_day else c.last_day end
    where c.id = p_character;
  return next;
end;
$$;

revoke execute on function
  public.commit_save(uuid, uuid, integer, text, integer, text, integer, text, real, real, smallint, integer)
from public, anon, authenticated;

grant execute on function
  public.commit_save(uuid, uuid, integer, text, integer, text, integer, text, real, real, smallint, integer)
to service_role;
