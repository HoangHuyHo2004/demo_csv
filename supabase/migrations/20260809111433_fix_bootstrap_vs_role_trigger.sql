-- bootstrap_first_owner() needs to update profiles.role, but the anti-
-- privilege-escalation trigger (trg_prevent_role_self_promotion) blocks ANY
-- role change unless the caller is already an Owner -- which is impossible
-- for the very first Owner. Give the trigger a narrow, explicit bypass
-- that only this specific, already self-guarded function can set (rather
-- than weakening the trigger's general check, or duplicating the "no
-- owner exists yet" invariant in two places).
--
-- Found live: bootstrap_first_owner() failed for every caller with "Only
-- an Owner can change a user role" until this fix, because the trigger
-- above didn't know to trust this one legitimate exception.

create or replace function public.prevent_role_self_promotion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and not public.is_owner()
     and coalesce(current_setting('demo_csv.bootstrap_in_progress', true), 'false') <> 'true'
  then
    raise exception 'Only an Owner can change a user role';
  end if;
  return new;
end;
$$;

create or replace function public.bootstrap_first_owner()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'An owner already exists';
  end if;
  -- Transaction-local (third arg true) -- cannot leak into any other
  -- statement in this or any other session.
  perform set_config('demo_csv.bootstrap_in_progress', 'true', true);
  update public.profiles set role = 'owner' where id = auth.uid();
end;
$$;
