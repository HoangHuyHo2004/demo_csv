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

// One query for an entire dashboard page -- every widget derives from
// this same in-memory dataset, which is what guarantees every tile agrees
// with every other. Station filtering only happens when a specific
// station is selected; for the "all stations" scope, RLS alone decides
// what comes back (an Owner sees everything, an Accountant only their
// assigned stations) rather than the client narrowing it further.
export async function loadMetricDaily({ stationIds, from, to } = {}) {
  let q = supabase
    .from('metric_daily')
    .select('station_id, metric_name, value_date, value')
    .order('value_date')
    .limit(20000);
  if (from) q = q.gte('value_date', from);
  if (to) q = q.lte('value_date', to);
  if (stationIds && stationIds.length) q = q.in('station_id', stationIds);
  const { data, error } = await q;
  if (error) {
    console.error('loadMetricDaily failed:', error);
    return [];
  }
  return data;
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
