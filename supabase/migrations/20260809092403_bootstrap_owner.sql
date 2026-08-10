-- Self-service bootstrap for the very first Owner. Safe to leave callable
-- by any authenticated user: it is a one-shot (refuses once any Owner
-- exists) and only ever touches the caller's own row.
--
-- NOTE: superseded by 20260809111433_fix_bootstrap_vs_role_trigger.sql,
-- which adds a transaction-local bypass flag so this function's own
-- UPDATE isn't blocked by the trg_prevent_role_self_promotion trigger
-- added in 20260809092236_security_fixes.sql. Kept here for history.
create or replace function public.bootstrap_first_owner()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where role = 'owner') then
    raise exception 'An owner already exists';
  end if;
  update public.profiles set role = 'owner' where id = auth.uid();
end;
$$;

revoke execute on function public.bootstrap_first_owner() from public, anon;
grant execute on function public.bootstrap_first_owner() to authenticated;
