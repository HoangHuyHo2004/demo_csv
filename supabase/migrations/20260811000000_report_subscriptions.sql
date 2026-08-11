-- ⚠ NOT YET APPLIED. Every other file in this directory is a record of a
-- migration that HAS run against the project (see README); this one is pending.
-- It needs a Telegram bot token set as an Edge Function secret first, and the
-- cron block at the bottom filled in, before it should be applied.
--
-- Scheduled report delivery.
--
-- This is the first thing in Demo_CSV that runs when nobody's browser is open,
-- so it is also the first thing that cannot rely on Row Level Security to keep
-- one station's data away from another. The Edge Function that reads this table
-- runs as service_role and BYPASSES RLS -- it must re-derive each subscriber's
-- station access itself. See supabase/functions/send-daily-report/index.ts.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.report_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- null = every station the subscriber can see, resolved at send time so that
  -- revoking station access also silently narrows the report.
  station_id   uuid references public.stations(id) on delete cascade,
  channel      text not null default 'telegram' check (channel in ('telegram')),
  destination  text not null,                       -- Telegram chat_id
  frequency    text not null default 'daily' check (frequency in ('daily','weekdays','weekly')),
  -- Local hour in the workspace timezone (Asia/Ho_Chi_Minh, fixed in Settings).
  -- The dispatcher converts; storing UTC here would make the UI lie during any
  -- future DST-observing timezone.
  send_hour    smallint not null default 7 check (send_hour between 0 and 23),
  enabled      boolean not null default true,
  -- Double opt-in: a chat is only written to once it has confirmed. Until then
  -- a typo'd or hostile chat_id receives nothing.
  verified_at  timestamptz,
  last_sent_at timestamptz,
  last_status  text,
  created_at   timestamptz not null default now(),
  unique (user_id, channel, destination)
);

alter table public.report_subscriptions enable row level security;

-- Self-serve: a subscriber sees and edits only their own rows. Deliberately no
-- owner-wide read policy -- a delivery address is personal contact data, and
-- nothing in the product needs an Owner to enumerate them.
create policy "subs: read own"   on public.report_subscriptions for select
  using (user_id = auth.uid());
create policy "subs: insert own" on public.report_subscriptions for insert
  with check (user_id = auth.uid());
create policy "subs: update own" on public.report_subscriptions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "subs: delete own" on public.report_subscriptions for delete
  using (user_id = auth.uid());

-- A subscription must not outlive the access it was created under: if the row
-- names a station, the subscriber must currently be able to see that station.
-- (A null station_id is resolved per-send instead, so it needs no check here.)
create or replace function public.check_subscription_station()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.station_id is not null and not public.has_station_access(new.station_id) then
    raise exception 'no access to station %', new.station_id;
  end if;
  return new;
end $$;

create trigger report_subscriptions_station_guard
  before insert or update on public.report_subscriptions
  for each row execute function public.check_subscription_station();

create index report_subscriptions_due_idx
  on public.report_subscriptions (send_hour, enabled) where enabled;

-- Hourly dispatcher. One job for every subscriber rather than one job each:
-- pg_cron rows are global state with no RLS, so per-user jobs would be a
-- second, unprotected copy of the subscription list.
--
-- Runs at :05 past every hour; the function itself decides who is due, so a
-- missed tick costs one hour rather than a whole day.
--
-- NOTE: <PROJECT_REF> and the service-role key are filled in at deploy time.
-- Do NOT commit a real service-role key here -- it bypasses RLS entirely.
-- Store it in Vault and read it back, as below.
--
-- select vault.create_secret('<service-role-key>', 'service_role_key');
--
-- select cron.schedule(
--   'send-daily-report',
--   '5 * * * *',
--   $cron$
--     select net.http_post(
--       url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-daily-report',
--       headers := jsonb_build_object(
--         'Content-Type',  'application/json',
--         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
--                                        where name = 'service_role_key')
--       ),
--       body    := '{}'::jsonb
--     );
--   $cron$
-- );
