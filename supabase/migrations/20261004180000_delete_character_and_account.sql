-- Deadzone: permanent deletion of a character and RODO account deletion (docs/backend.md §5.1).
--
-- File only. Applying it to any hosted project needs Paweł's explicit approval
-- (docs/backend.md §10, step 8 [ZGODA]).
--
-- apps/server removes the Storage blobs first, then calls these functions (service_role only),
-- and for an account finally deletes the auth user through the Auth admin API.

-- Deletes one character (alive or tombstone) and, by cascade, its save row.
-- Returns the save path still referenced at delete time (null without a save) so the server can
-- remove a blob that a concurrent save committed after the server's blob sweep.
create function public.delete_character(p_user uuid, p_character uuid)
returns table (storage_path text)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_path text;
begin
  -- Row lock: a concurrent commit_save waits and then fails with character_dead.
  perform 1 from public.characters c
    where c.id = p_character and c.user_id = p_user
    for update;
  if not found then
    raise exception 'character_not_found';
  end if;
  select s.storage_path into v_path from public.saves s where s.character_id = p_character;
  delete from public.characters c where c.id = p_character;
  storage_path := v_path;
  return next;
end;
$$;

-- Deletes all characters, saves and the profile of an account; returns the save paths that were
-- still referenced. The auth.users row is removed afterwards by the server (Auth admin API).
create function public.delete_account_data(p_user uuid)
returns table (storage_path text)
language plpgsql
set search_path = ''
as $$
begin
  perform public.lock_account(p_user);
  return query
    select s.storage_path
      from public.saves s join public.characters c on c.id = s.character_id
      where c.user_id = p_user;
  delete from public.characters c where c.user_id = p_user;
  delete from public.profiles p where p.id = p_user;
end;
$$;

revoke execute on function
  public.delete_character(uuid, uuid),
  public.delete_account_data(uuid)
from public, anon, authenticated;

grant execute on function
  public.delete_character(uuid, uuid),
  public.delete_account_data(uuid)
to service_role;
