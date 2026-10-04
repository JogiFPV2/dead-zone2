-- Deadzone: time of day of the current save (docs/backend.md §3.3, 409 `server` of §5.1).
--
-- File only. Applying it to any hosted project needs Paweł's explicit approval
-- (docs/backend.md §10, step 8 [ZGODA]).
--
-- apps/server derives the minute of the game day (0..1439) from the validated save state (the
-- sim clock over `tick`) and passes it to commit_save. Rows written before this migration keep
-- null. RLS is unchanged (owner read-only, server writes).

alter table public.saves
  add column minute_of_day smallint check (minute_of_day is null or minute_of_day between 0 and 1439);

comment on column public.saves.minute_of_day is
  'Minute of the game day at the save (sim clock), null for rows from before the column.';

-- commit_save gains `p_minute_of_day` (default null): it describes this save, so a commit without
-- it stores null. The other parameters are those of 20261004200000_character_last_location.sql.
drop function public.commit_save(
  uuid, uuid, integer, text, integer, text, integer, text, real, real, smallint, integer
);

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
  p_last_day integer default null,
  p_minute_of_day smallint default null
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
    insert into public.saves
      (character_id, storage_path, version, size_bytes, checksum, game_day, minute_of_day)
      values (p_character, p_storage_path, 1, p_size_bytes, p_checksum, p_game_day, p_minute_of_day)
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
          game_day = p_game_day,
          minute_of_day = p_minute_of_day
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

revoke execute on function public.commit_save(
  uuid, uuid, integer, text, integer, text, integer, text, real, real, smallint, integer, smallint
) from public, anon, authenticated;

grant execute on function public.commit_save(
  uuid, uuid, integer, text, integer, text, integer, text, real, real, smallint, integer, smallint
) to service_role;
