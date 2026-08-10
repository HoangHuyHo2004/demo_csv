-- =========================================================
-- Demo_CSV initial schema
-- Users, Stations, Uploads, Metric values + RLS
-- =========================================================

create type public.app_role as enum ('owner', 'accountant');

-- ---------- profiles ----------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone        text,
  role         app_role not null default 'accountant',
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- helper: is the current user an Owner?
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'owner' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- profiles policies
create policy "profiles: read own"     on public.profiles for select using (id = auth.uid());
create policy "profiles: owner reads"  on public.profiles for select using (public.is_owner());
create policy "profiles: update own"   on public.profiles for update using (id = auth.uid());
create policy "profiles: owner writes" on public.profiles for all    using (public.is_owner()) with check (public.is_owner());

-- auto-create a profile row on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- stations ----------
create table public.stations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text unique,
  address     text,
  color       text default '#3455b3',
  timezone    text default 'Asia/Ho_Chi_Minh',
  currency    text default 'VND',
  archived_at timestamptz,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.stations enable row level security;

-- ---------- station_members: which accountant is scoped to which station ----------
create table public.station_members (
  station_id uuid references public.stations(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  added_by   uuid references public.profiles(id),
  added_at   timestamptz not null default now(),
  primary key (station_id, user_id)
);

alter table public.station_members enable row level security;

-- helper: does the current user have access to a given station?
create or replace function public.has_station_access(p_station_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_owner()
      or exists (
        select 1 from public.station_members
        where station_id = p_station_id and user_id = auth.uid()
      );
$$;

-- stations policies
create policy "stations: owner all"       on public.stations for all
  using (public.is_owner()) with check (public.is_owner());
create policy "stations: member read"     on public.stations for select
  using (public.has_station_access(id));

-- station_members policies
create policy "station_members: owner all" on public.station_members for all
  using (public.is_owner()) with check (public.is_owner());
create policy "station_members: read own"  on public.station_members for select
  using (user_id = auth.uid());

-- ---------- uploads (one row per CSV upload) ----------
create type public.upload_status as enum ('pending', 'processed', 'overwritten', 'error');

create table public.uploads (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid not null references public.stations(id) on delete cascade,
  filename    text not null,
  upload_date date not null,
  category    text,
  row_count   int,
  status      upload_status not null default 'pending',
  uploaded_by uuid references public.profiles(id),
  created_at  timestamptz not null default now(),
  unique (station_id, upload_date, category)  -- one file per station+date+category (overwrite flow updates)
);

alter table public.uploads enable row level security;

create index uploads_station_date_idx on public.uploads (station_id, upload_date desc);

create policy "uploads: owner all"     on public.uploads for all
  using (public.is_owner()) with check (public.is_owner());
create policy "uploads: member read"   on public.uploads for select
  using (public.has_station_access(station_id));
create policy "uploads: member insert" on public.uploads for insert
  with check (public.has_station_access(station_id) and uploaded_by = auth.uid());
create policy "uploads: member update" on public.uploads for update
  using (public.has_station_access(station_id) and uploaded_by = auth.uid());

-- ---------- metric_values (long/tidy) ----------
create table public.metric_values (
  id           bigserial primary key,
  station_id   uuid not null references public.stations(id) on delete cascade,
  upload_id    uuid references public.uploads(id) on delete cascade,
  metric_name  text not null,
  value_date   date not null,
  value        numeric not null,
  unit         text,
  created_at   timestamptz not null default now()
);

alter table public.metric_values enable row level security;

create index metric_values_lookup_idx
  on public.metric_values (station_id, metric_name, value_date desc);

create policy "metric_values: owner all"     on public.metric_values for all
  using (public.is_owner()) with check (public.is_owner());
create policy "metric_values: member read"   on public.metric_values for select
  using (public.has_station_access(station_id));
create policy "metric_values: member insert" on public.metric_values for insert
  with check (public.has_station_access(station_id));

-- ---------- convenience view for the dashboard ----------
create or replace view public.metric_daily as
  select station_id, metric_name, value_date, sum(value) as value
  from public.metric_values
  group by station_id, metric_name, value_date;
