// Every Supabase query for Demo_CSV lives here. Queries never filter by
// station client-side when a broader scope is wanted -- Row Level Security
// on the `stations` table already returns only what the caller can see
// (every active station for an Owner, only assigned ones for an
// Accountant), so the result of listStations() IS the correct option set.
import { supabase } from './supabase-client.js';

export async function listStations() {
  const { data, error } = await supabase
    .from('stations')
    .select('id, name, code, color, archived_at')
    .is('archived_at', null)
    .order('name');
  if (error) {
    console.error('listStations failed:', error);
    return [];
  }
  return data;
}

// Fuller column set for the Stations page itself (identity fields + archived
// state) -- kept separate from listStations() rather than widening it, since
// that one's narrower shape is already relied on by scope.js/scope-ui.js for
// the header switcher and there's no reason to risk that.
export async function listStationsFull({ includeArchived = true } = {}) {
  let q = supabase
    .from('stations')
    .select('id, name, code, address, color, timezone, currency, archived_at, created_at')
    .order('name');
  if (!includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) {
    console.error('listStationsFull failed:', error);
    return [];
  }
  return data;
}

// Creates a station. RLS ("stations: owner all") restricts this to the
// Owner -- an Accountant's insert attempt comes back as a normal RLS-denial
// error here, not a thrown exception. `code` is unique, so a duplicate
// surfaces as a distinct error the caller can show inline rather than a
// generic failure message.
export async function createStation({ name, code, address, timezone, currency, color }) {
  const { data, error } = await supabase
    .from('stations')
    .insert({ name, code: code || null, address: address || null, timezone, currency, color })
    .select('id, name, code, address, color, timezone, currency, archived_at, created_at')
    .single();
  if (error) {
    console.error('createStation failed:', error);
    return { station: null, code: error.code === '23505' ? 'duplicate_code' : 'failed' };
  }
  return { station: data, code: null };
}

// One upload count per station, same reduce-client-side pattern as
// categoryUploadCounts() below -- the only real, derivable per-station stat
// available anywhere in this app today.
export async function stationUploadCounts() {
  const { data, error } = await supabase.from('uploads').select('station_id');
  if (error) {
    console.error('stationUploadCounts failed:', error);
    return {};
  }
  const counts = {};
  for (const row of data) counts[row.station_id] = (counts[row.station_id] || 0) + 1;
  return counts;
}

// Global category registry, same shape as the metrics registry below: any
// signed-in user can read and create one, so an accountant can name a new
// category on the spot without waiting on the Owner.
export async function listCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('slug, name, icon, description')
    .order('name');
  if (error) {
    console.error('listCategories failed:', error);
    return [];
  }
  return data;
}

// Creates a category if its slug doesn't exist yet; ignoreDuplicates so two
// people typing the same new category name at the same moment don't race
// each other into a conflict, same pattern as upsertMetrics.
export async function createCategory({ slug, name }) {
  const { error } = await supabase
    .from('categories')
    .upsert({ slug, name }, { onConflict: 'slug', ignoreDuplicates: true });
  if (error) {
    console.error('createCategory failed:', error);
    return null;
  }
  return { slug, name };
}

// One upload count per category, scoped by the same RLS that already limits
// listUploads() to accessible stations. Reduced client-side rather than N
// separate count queries -- upload volume here is hundreds of rows, not
// millions, so one query either way, but this is one round trip instead of
// one per category.
export async function categoryUploadCounts() {
  const { data, error } = await supabase.from('uploads').select('category');
  if (error) {
    console.error('categoryUploadCounts failed:', error);
    return {};
  }
  const counts = {};
  for (const row of data) counts[row.category] = (counts[row.category] || 0) + 1;
  return counts;
}

// One query for an entire dashboard page -- every widget derives from
// this same in-memory dataset, which is what guarantees every tile agrees
// with every other. Station filtering only happens when a specific
// station is selected; for the "all stations" scope, RLS alone decides
// what comes back (an Owner sees everything, an Accountant only their
// assigned stations) rather than the client narrowing it further.
// PostgREST caps every response at its `db-max-rows` setting (1000 on Supabase)
// and does so SILENTLY -- a `.limit(20000)` is only ever a ceiling, never a
// floor, so a large month came back truncated with no error and simply lost its
// last few days. That is the worst possible failure for this app: plausible
// numbers that are quietly too small. So page through explicitly and stop only
// when a short page proves the end was reached.
//
// The sort must be a total order or paging can repeat or skip rows between
// pages; value_date alone is not unique, hence station_id + metric_name too.
const PAGE_SIZE = 1000;

export async function loadMetricDaily({ stationIds, from, to } = {}) {
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = supabase
      .from('metric_daily')
      .select('station_id, metric_name, value_date, value')
      .order('value_date')
      .order('station_id')
      .order('metric_name')
      .range(offset, offset + PAGE_SIZE - 1);
    if (from) q = q.gte('value_date', from);
    if (to) q = q.lte('value_date', to);
    if (stationIds && stationIds.length) q = q.in('station_id', stationIds);
    const { data, error } = await q;
    if (error) {
      console.error('loadMetricDaily failed:', error);
      return out;   // partial beats nothing, and the caller sees fewer days
    }
    out.push(...data);
    if (data.length < PAGE_SIZE) return out;
  }
}

// The most recent date holding any data, so Statistics can open on a month
// that actually has something in it rather than on today's empty month.
// Station filtering is left to RLS when no ids are given, same as
// loadMetricDaily.
export async function latestMetricDate({ stationIds } = {}) {
  let q = supabase
    .from('metric_daily')
    .select('value_date')
    .order('value_date', { ascending: false })
    .limit(1);
  if (stationIds && stationIds.length) q = q.in('station_id', stationIds);
  const { data, error } = await q;
  if (error) {
    console.error('latestMetricDate failed:', error);
    return null;
  }
  return data?.[0]?.value_date ?? null;
}

// The active (non-overwritten) upload for a given station+date+category,
// if one exists. Drives the duplicate-date warning in the upload flow.
export async function findExistingUpload(stationId, uploadDate, category) {
  const { data, error } = await supabase
    .from('uploads')
    .select('id, filename, status')
    .eq('station_id', stationId)
    .eq('upload_date', uploadDate)
    .eq('category', category)
    .neq('status', 'overwritten')
    .maybeSingle();
  if (error) {
    console.error('findExistingUpload failed:', error);
    return null;
  }
  return data;
}

export async function getMetricValuesForUpload(uploadId) {
  const { data, error } = await supabase
    .from('metric_values')
    .select('metric_name, value, unit')
    .eq('upload_id', uploadId);
  if (error) {
    console.error('getMetricValuesForUpload failed:', error);
    return [];
  }
  return data;
}

// Looks up existing definitions for a set of metric names so the save
// pipeline can reuse each metric's stored aggregation (e.g. inventory_on_hand
// is 'last', not 'sum') instead of guessing per upload.
export async function getMetricsRegistry(names) {
  if (!names.length) return {};
  const { data, error } = await supabase
    .from('metrics')
    .select('metric_name, aggregation, is_snapshot, unit')
    .in('metric_name', names);
  if (error) {
    console.error('getMetricsRegistry failed:', error);
    return {};
  }
  const map = {};
  for (const m of data) map[m.metric_name] = m;
  return map;
}

// Auto-registers metric names not yet in the registry. ignoreDuplicates so
// two files uploaded back-to-back with the same new column name don't race
// each other into a conflict.
export async function upsertMetrics(newMetrics) {
  if (!newMetrics.length) return;
  const { error } = await supabase
    .from('metrics')
    .upsert(newMetrics, { onConflict: 'metric_name', ignoreDuplicates: true });
  if (error) console.error('upsertMetrics failed:', error);
}

export async function listUploads({ stationIds, limit = 50 } = {}) {
  let q = supabase
    .from('uploads')
    .select('id, station_id, filename, upload_date, category, row_count, status, uploaded_by, storage_path, created_at, stations(name,color), profiles(display_name), metric_values(count)')
    .order('upload_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (stationIds && stationIds.length) q = q.in('station_id', stationIds);
  const { data, error } = await q;
  if (error) {
    console.error('listUploads failed:', error);
    return [];
  }
  return data;
}

const EXT_CONTENT_TYPE = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

export async function uploadFileToStorage(path, file) {
  const ext = path.split('.').pop().toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext] || 'application/octet-stream';
  const { error } = await supabase.storage
    .from('csv-uploads')
    .upload(path, file, { contentType, upsert: false });
  return { error };
}

export async function removeStorageObject(path) {
  await supabase.storage.from('csv-uploads').remove([path]);
}

export async function insertUploadRow(row) {
  const { error } = await supabase.from('uploads').insert(row);
  return { error };
}

export async function setUploadStatus(uploadId, status) {
  const { error } = await supabase.from('uploads').update({ status }).eq('id', uploadId);
  return { error };
}

export async function insertMetricValues(rows) {
  const { error } = await supabase.from('metric_values').insert(rows);
  return { error };
}

export async function deleteMetricValuesForUpload(uploadId) {
  const { error } = await supabase.from('metric_values').delete().eq('upload_id', uploadId);
  return { error };
}

export async function getSignedDownloadUrl(storagePath, filename) {
  const { data, error } = await supabase.storage
    .from('csv-uploads')
    .createSignedUrl(storagePath, 60, { download: filename });
  if (error) {
    console.error('getSignedDownloadUrl failed:', error);
    return null;
  }
  return data.signedUrl;
}
