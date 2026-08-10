-- Global metric registry (not per-station) so two stations reporting the
-- same column name combine correctly on shared dashboards.
create table public.metrics (
  metric_name  text primary key,
  display_name text not null,
  unit         text,
  category     text,
  aggregation  text not null default 'sum' check (aggregation in ('sum','avg','last','max')),
  is_snapshot  boolean not null default false,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);

alter table public.metrics enable row level security;

create policy "metrics: read all authenticated" on public.metrics
  for select using (auth.role() = 'authenticated');
create policy "metrics: insert authenticated" on public.metrics
  for insert with check (auth.role() = 'authenticated');
create policy "metrics: owner update" on public.metrics
  for update using (public.is_owner()) with check (public.is_owner());
create policy "metrics: owner delete" on public.metrics
  for delete using (public.is_owner());

insert into public.metrics (metric_name, display_name, unit, category, aggregation, is_snapshot, confirmed_at)
values
  ('revenue', 'Revenue', '$', 'sales', 'sum', false, now()),
  ('sales_volume', 'Sales volume', 'count', 'sales', 'sum', false, now()),
  ('purchases', 'Purchases', 'count', 'purchases', 'sum', false, now()),
  ('losses', 'Losses', '$', 'losses', 'sum', false, now()),
  ('inventory_on_hand', 'Inventory on hand', 'count', 'inventory', 'last', true, now());
