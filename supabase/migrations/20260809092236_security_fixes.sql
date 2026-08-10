-- Advisor ERROR (B2): metric_daily bypasses RLS entirely.
alter view public.metric_daily set (security_invoker = true);

-- Advisor WARN: handle_new_user is callable via /rest/v1/rpc/
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- is_owner / has_station_access.
-- Judgement: KEEP these grants. Both are STABLE, take no privileged input,
-- and leak only facts about the caller's own access, which the caller can
-- already determine by querying stations. Revoking EXECUTE from
-- `authenticated` would break every RLS policy that calls them, because
-- policies execute as the invoking role. Revoke from `anon` only.
revoke execute on function public.is_owner() from anon;
revoke execute on function public.has_station_access(uuid) from anon;

-- B1: PRIVILEGE ESCALATION. `profiles: update own` has no WITH CHECK, so
-- WITH CHECK defaults to USING and any accountant can PATCH their own row
-- to role='owner'. Fixed with an explicit BEFORE UPDATE trigger rather
-- than a policy WITH CHECK clause -- a trigger is unambiguous about what
-- it blocks and doesn't depend on subtleties of how Postgres evaluates
-- WITH CHECK against the row being updated mid-UPDATE.
create or replace function public.prevent_role_self_promotion()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_owner() then
    raise exception 'Only an Owner can change a user role';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_self_promotion
  before update on public.profiles
  for each row execute function public.prevent_role_self_promotion();

-- B3: accountants cannot delete metric_values, so overwrite and rollback
-- silently affect zero rows.
create policy "metric_values: member delete own upload" on public.metric_values
  for delete using (
    exists (select 1 from public.uploads u
             where u.id = metric_values.upload_id
               and u.uploaded_by = auth.uid()
               and public.has_station_access(u.station_id)));

-- Secondary: let members see who uploaded what.
create policy "profiles: read co-members" on public.profiles
  for select using (
    exists (select 1 from public.station_members a
            join public.station_members b on a.station_id = b.station_id
            where a.user_id = auth.uid() and b.user_id = profiles.id));
