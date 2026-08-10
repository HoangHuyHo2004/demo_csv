alter table public.uploads add column storage_path text;

-- B4: the plain unique constraint makes status='overwritten' unreachable
-- (keeping the old row and inserting a new one is a unique violation), and
-- nullable category means NULL rows never dedupe against each other at all.
alter table public.uploads drop constraint uploads_station_id_upload_date_category_key;
update public.uploads set category = 'uncategorized' where category is null;
alter table public.uploads alter column category set not null,
                           alter column category set default 'uncategorized';
create unique index uploads_active_key on public.uploads (station_id, upload_date, category)
  where status <> 'overwritten';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('csv-uploads', 'csv-uploads', false, 10485760,
        array['text/csv', 'application/vnd.ms-excel', 'text/plain']);

-- Station id must be the first path segment: {station_id}/{date}/{upload_id}.csv
create policy "csv: read by station access" on storage.objects for select
  using (bucket_id = 'csv-uploads'
     and public.has_station_access(((storage.foldername(name))[1])::uuid));

create policy "csv: insert by station access" on storage.objects for insert
  with check (bucket_id = 'csv-uploads'
     and public.has_station_access(((storage.foldername(name))[1])::uuid)
     and owner = auth.uid());

create policy "csv: owner manage" on storage.objects for all
  using (bucket_id = 'csv-uploads' and public.is_owner())
  with check (bucket_id = 'csv-uploads' and public.is_owner());
