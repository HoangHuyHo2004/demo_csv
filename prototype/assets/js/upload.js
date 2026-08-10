// Controller for uploads.html: dropzone, per-file parsing/mapping,
// duplicate-date detection, the save/overwrite transaction, and the
// upload-history table.
import { requireSession } from './auth.js';
import * as scope from './scope.js';
import {
  listStations, findExistingUpload, getMetricValuesForUpload,
  getMetricsRegistry, upsertMetrics, listUploads, getSignedDownloadUrl,
  uploadFileToStorage, removeStorageObject, insertUploadRow,
  setUploadStatus, insertMetricValues, deleteMetricValuesForUpload,
} from './data.js';
import {
  parseFile, inferTypes, normalizeNumber, toISODate,
  detectDateFromFilename, detectDateColumnName, looksLikeSnapshot,
} from './csv.js';

let currentUserId = null;
let stations = [];
const fileStates = [];

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const browseBtn = document.getElementById('browse-btn');
const fileList = document.getElementById('file-list');
const rowTpl = document.getElementById('tpl-file-row');
const saveAllBtn = document.getElementById('save-all-btn');
const cancelAllBtn = document.getElementById('cancel-all-btn');

init();

async function init() {
  const result = await requireSession();
  if (!result) return;
  currentUserId = result.session.user.id;
  stations = await listStations();
  populateHistoryStationFilter();

  // guard.js also initializes scope.js (for the header switcher), but its
  // completion isn't guaranteed by the time this module's top-level code
  // runs -- module scripts don't block each other. scope.init() is safe
  // to call again: it re-derives the same result from localStorage + the
  // accessible station list, so this just guarantees readiness here
  // rather than racing guard.js for it.
  await scope.init(currentUserId, { isOwner: result.profile?.role === 'owner' });

  wireDropzone();
  wireSaveActions();
  await refreshHistory();
  wireHistoryFilters();
}

function populateHistoryStationFilter() {
  const sel = document.getElementById('hist-station');
  if (!sel) return;
  sel.innerHTML = '<option value="">All stations</option>' +
    stations.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

// ---------------------------------------------------------------------
// Dropzone / file intake
// ---------------------------------------------------------------------

function wireDropzone() {
  ['dragover', 'dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => e.preventDefault());
  });
  dropzone.addEventListener('dragover', () => dropzone.classList.add('drop--active'));
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drop--active'));
  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('drop--active');
    handleFiles(e.dataTransfer.files);
  });
  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });
  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });
}

async function handleFiles(fileListArg) {
  for (const file of Array.from(fileListArg)) {
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') continue;
    const state = await buildFileState(file);
    fileStates.push(state);
  }
  renderFiles();
}

async function buildFileState(file) {
  const parsed = await parseFile(file);
  const state = {
    id: crypto.randomUUID(),
    file,
    headers: parsed.headers,
    rows: parsed.rows,
    parseErrors: parsed.errors,
    columns: [],
    stationId: scope.current().mode === 'station' ? scope.current().stationId : '',
    category: '',
    resolvedDate: null,
    dateSource: null,
    duplicate: null,
    overwriteConfirmed: false,
    status: 'draft',
    errorMessage: '',
  };

  if (parsed.headers.length === 0 || parsed.rowCount === 0) {
    state.status = 'error';
    state.errorMessage = 'Empty file or no columns detected.';
    return state;
  }

  const types = inferTypes(parsed.headers, parsed.rows);
  const dateColName = detectDateColumnName(types);

  state.columns = types.map((t) => {
    const snapshot = t.type === 'number' && looksLikeSnapshot(t.name);
    return {
      sourceName: t.name,
      mappedName: t.name,
      type: t.type,
      isDateCol: t.name === dateColName,
      include: t.type === 'number' && !snapshot,
      isSnapshot: snapshot,
    };
  });

  resolveDate(state);
  await checkDuplicate(state);
  computeStatus(state);
  return state;
}

function resolveDate(state) {
  const dateCol = state.columns.find((c) => c.isDateCol);
  if (dateCol) {
    const values = state.rows
      .map((r) => toISODate(r[dateCol.sourceName]))
      .filter((v) => v !== null);
    if (values.length > 0) {
      state.resolvedDate = mode(values);
      state.dateSource = 'column';
      return;
    }
  }
  const fromName = detectDateFromFilename(state.file.name);
  if (fromName) {
    state.resolvedDate = fromName;
    state.dateSource = 'filename';
    return;
  }
  state.resolvedDate = null;
  state.dateSource = null;
}

function mode(arr) {
  const counts = {};
  let best = arr[0];
  let bestCount = 0;
  for (const v of arr) {
    counts[v] = (counts[v] || 0) + 1;
    if (counts[v] > bestCount) {
      best = v;
      bestCount = counts[v];
    }
  }
  return best;
}

async function checkDuplicate(state) {
  state.duplicate = null;
  state.overwriteConfirmed = false;
  if (!state.stationId || !state.resolvedDate || !state.category) return;
  const existing = await findExistingUpload(state.stationId, state.resolvedDate, state.category);
  if (!existing) return;
  const oldValues = await getMetricValuesForUpload(existing.id);
  state.duplicate = { existingUploadId: existing.id, filename: existing.filename, oldValues };
}

function computeStatus(state) {
  if (state.status === 'error' || state.status === 'saving' || state.status === 'saved') return;
  if (!state.stationId) { state.status = 'needs-station'; return; }
  if (!state.category) { state.status = 'needs-category'; return; }
  if (!state.resolvedDate) { state.status = 'needs-date'; return; }
  if (state.duplicate && !state.overwriteConfirmed) { state.status = 'duplicate'; return; }
  state.status = 'ready';
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function renderFiles() {
  fileList.innerHTML = '';
  for (const state of fileStates) {
    fileList.appendChild(renderFileRow(state));
  }
  updateSaveButton();
}

const STATUS_LABEL = {
  draft: 'Parsing…',
  'needs-station': 'Select a station',
  'needs-category': 'Enter a category',
  'needs-date': 'Set the date',
  duplicate: 'Date exists',
  ready: 'Ready',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Error',
};
const STATUS_CLASS = {
  draft: 'new', 'needs-station': 'warn', 'needs-category': 'warn', 'needs-date': 'warn',
  duplicate: 'warn', ready: 'ok', saving: 'ok', saved: 'ok', error: 'err',
};

function renderFileRow(state) {
  const node = rowTpl.content.firstElementChild.cloneNode(true);
  const sizeKb = (state.file.size / 1024).toFixed(1);

  node.querySelector('[data-f="name"]').textContent = state.file.name;
  node.querySelector('[data-f="sub"]').textContent = state.status === 'error'
    ? state.errorMessage
    : `${sizeKb} KB · ${state.rows.length} rows · date ${state.resolvedDate ? state.resolvedDate + ' (' + state.dateSource + ')' : 'unresolved'}`;

  const statusEl = node.querySelector('[data-f="status"]');
  statusEl.textContent = STATUS_LABEL[state.status] || state.status;
  statusEl.className = 'status ' + (STATUS_CLASS[state.status] || '');

  const stationSel = node.querySelector('[data-f="station"]');
  stationSel.innerHTML = '<option value="">— Select station —</option>' +
    stations.map((s) => `<option value="${s.id}"${s.id === state.stationId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  stationSel.addEventListener('change', async () => {
    state.stationId = stationSel.value;
    await checkDuplicate(state);
    computeStatus(state);
    renderFiles();
  });

  const catInput = node.querySelector('[data-f="category"]');
  catInput.value = state.category;
  catInput.addEventListener('change', async () => {
    state.category = catInput.value.trim().toLowerCase();
    await checkDuplicate(state);
    computeStatus(state);
    renderFiles();
  });

  const dateInput = node.querySelector('[data-f="date-override"]');
  dateInput.value = state.resolvedDate || '';
  dateInput.addEventListener('change', async () => {
    state.resolvedDate = dateInput.value || null;
    state.dateSource = 'manual';
    await checkDuplicate(state);
    computeStatus(state);
    renderFiles();
  });

  node.querySelector('[data-f="remove"]').addEventListener('click', () => {
    const idx = fileStates.findIndex((s) => s.id === state.id);
    if (idx >= 0) fileStates.splice(idx, 1);
    renderFiles();
  });

  const warnBanner = node.querySelector('[data-f="warnbanner"]');
  if (state.duplicate) {
    warnBanner.hidden = false;
    warnBanner.innerHTML = renderDuplicateBanner(state);
    const confirmBtn = warnBanner.querySelector('[data-f="confirm-overwrite"]');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        state.overwriteConfirmed = true;
        computeStatus(state);
        renderFiles();
      });
    }
  } else {
    warnBanner.hidden = true;
  }

  const mapBody = node.querySelector('[data-f="maprows"]');
  if (state.status !== 'error') {
    mapBody.innerHTML = state.columns.map((c) => renderMapRow(c, state.id)).join('');
    wireMapRow(mapBody, state);
  } else {
    node.querySelector('[data-f="mapping"]').hidden = true;
  }

  return node;
}

function renderDuplicateBanner(state) {
  const diffs = state.columns
    .filter((c) => c.include)
    .map((c) => {
      const old = state.duplicate.oldValues.find((v) => v.metric_name === c.mappedName);
      const newVal = aggregateColumn(state.rows, c.sourceName, 'sum');
      return old
        ? `${escapeHtml(c.mappedName)}: <span class="old">${old.value}</span> → <span class="new">${newVal ?? '—'}</span>`
        : `${escapeHtml(c.mappedName)}: <span class="new">${newVal ?? '—'}</span> (new)`;
    })
    .join(' &nbsp;·&nbsp; ');
  const confirmed = state.overwriteConfirmed;
  return `
    <div class="icon">!</div>
    <div>
      <b>${escapeHtml(state.duplicate.filename)}</b> — a record for <b>${escapeHtml(state.category)}</b> on <b>${state.resolvedDate}</b> already exists.
      ${confirmed ? 'Overwrite confirmed — the old values will be replaced when you save.' : 'Uploading will overwrite. Preview of change:'}
      <div class="diff">${diffs || 'No overlapping tracked metrics.'}</div>
      ${confirmed ? '' : '<button type="button" class="btn ghost" data-f="confirm-overwrite" style="margin-top:8px">Confirm overwrite</button>'}
    </div>`;
}

function renderMapRow(c, fileId) {
  const typeClass = c.type === 'date' ? 'date' : c.type === 'number' ? 'num' : 'txt';
  const dateDisabled = c.type !== 'date' && c.type !== 'text' ? '' : (c.type === 'text' ? 'disabled' : '');
  return `
    <tr data-col="${escapeAttr(c.sourceName)}">
      <td><code>${escapeHtml(c.sourceName)}</code></td>
      <td><input type="text" value="${escapeAttr(c.mappedName)}" data-map="name"></td>
      <td><span class="pill ${typeClass}">${c.type}</span></td>
      <td style="text-align:center"><input type="radio" name="datecol-${fileId}" data-map="datecol" ${c.isDateCol ? 'checked' : ''} ${c.type === 'date' ? '' : 'disabled'}></td>
      <td style="text-align:center">
        <label class="toggle"><input type="checkbox" data-map="include" ${c.include ? 'checked' : ''} ${c.type !== 'number' ? 'disabled' : ''}><span></span></label>
        ${c.isSnapshot ? '<div class="map-warning">snapshot metric — summing would be wrong</div>' : ''}
      </td>
    </tr>`;
}

function wireMapRow(mapBody, state) {
  mapBody.querySelectorAll('tr').forEach((tr) => {
    const sourceName = tr.dataset.col;
    const col = state.columns.find((c) => c.sourceName === sourceName);

    tr.querySelector('[data-map="name"]').addEventListener('change', (e) => {
      col.mappedName = e.target.value.trim() || col.sourceName;
    });

    const dateRadio = tr.querySelector('[data-map="datecol"]');
    if (dateRadio) {
      dateRadio.addEventListener('change', async () => {
        state.columns.forEach((c) => { c.isDateCol = false; });
        col.isDateCol = true;
        resolveDate(state);
        await checkDuplicate(state);
        computeStatus(state);
        renderFiles();
      });
    }

    const includeBox = tr.querySelector('[data-map="include"]');
    if (includeBox) {
      includeBox.addEventListener('change', (e) => {
        col.include = e.target.checked;
      });
    }
  });
}

function updateSaveButton() {
  const readyCount = fileStates.filter((s) => s.status === 'ready').length;
  saveAllBtn.textContent = `Confirm & save ${readyCount || ''} file${readyCount === 1 ? '' : 's'}`.replace('  ', ' ');
  saveAllBtn.disabled = readyCount === 0;
}

// ---------------------------------------------------------------------
// Save / overwrite transaction
// ---------------------------------------------------------------------

function wireSaveActions() {
  saveAllBtn.addEventListener('click', async () => {
    const toSave = fileStates.filter((s) => s.status === 'ready');
    for (const state of toSave) {
      await saveOne(state); // sequential -- see plan: parallel writes make
                             // partial-failure reporting incomprehensible
                             // and can trip the unique index against
                             // each other.
    }
    renderFiles();
    await refreshHistory();
  });

  cancelAllBtn.addEventListener('click', () => {
    fileStates.length = 0;
    renderFiles();
  });
}

async function saveOne(state) {
  const uploadId = crypto.randomUUID();
  const storagePath = `${state.stationId}/${state.resolvedDate}/${uploadId}.csv`;
  const isOverwrite = !!state.duplicate;

  state.status = 'saving';
  renderFiles();

  // Step 1: storage upload. Fails -> abort, nothing persisted.
  const { error: storageErr } = await uploadFileToStorage(storagePath, state.file);
  if (storageErr) return fail(state, 'Could not upload file: ' + storageErr.message);

  // Step 1b (overwrite only): mark the old row overwritten first, freeing
  // the partial unique index for the new row.
  if (isOverwrite) {
    const { error: markErr } = await setUploadStatus(state.duplicate.existingUploadId, 'overwritten');
    if (markErr) {
      await removeStorageObject(storagePath);
      return fail(state, 'Could not prepare overwrite: ' + markErr.message);
    }
  }

  // Step 2: insert the uploads row.
  const { error: insErr } = await insertUploadRow({
    id: uploadId,
    station_id: state.stationId,
    filename: state.file.name,
    upload_date: state.resolvedDate,
    category: state.category || 'uncategorized',
    row_count: state.rows.length,
    status: 'pending',
    storage_path: storagePath,
    uploaded_by: currentUserId,
  });
  if (insErr) {
    await removeStorageObject(storagePath);
    if (isOverwrite) await setUploadStatus(state.duplicate.existingUploadId, 'processed');
    return fail(state, insErr.code === '23505'
      ? 'Another upload for this station/date/category was just created — reload and try again.'
      : insErr.message);
  }

  // Step 3: aggregate + insert metric_values, chunked at 500 rows.
  const included = state.columns.filter((c) => c.include && c.type === 'number');
  const registry = await getMetricsRegistry(included.map((c) => c.mappedName));
  const newMetricDefs = [];
  const metricRows = [];
  for (const c of included) {
    const existing = registry[c.mappedName];
    const aggregation = existing?.aggregation || 'sum';
    const value = aggregateColumn(state.rows, c.sourceName, aggregation);
    if (value === null) continue;
    if (!existing) {
      newMetricDefs.push({
        metric_name: c.mappedName,
        display_name: c.mappedName,
        unit: null,
        aggregation,
        is_snapshot: looksLikeSnapshot(c.mappedName),
        confirmed_at: new Date().toISOString(),
      });
    }
    metricRows.push({
      station_id: state.stationId,
      upload_id: uploadId,
      metric_name: c.mappedName,
      value_date: state.resolvedDate,
      value,
    });
  }

  await upsertMetrics(newMetricDefs);

  let chunkErr = null;
  for (let i = 0; i < metricRows.length && !chunkErr; i += 500) {
    const { error } = await insertMetricValues(metricRows.slice(i, i + 500));
    if (error) chunkErr = error;
  }
  if (chunkErr) {
    await deleteMetricValuesForUpload(uploadId);
    await setUploadStatus(uploadId, 'error');
    if (isOverwrite) await setUploadStatus(state.duplicate.existingUploadId, 'processed');
    return fail(state, 'Could not save values: ' + chunkErr.message);
  }

  // Step 4 (overwrite only): only now that the new values are safely in,
  // remove the old ones. A failure here double-counts (visible, fixable)
  // rather than losing data.
  if (isOverwrite) await deleteMetricValuesForUpload(state.duplicate.existingUploadId);

  // Step 5: mark processed.
  await setUploadStatus(uploadId, 'processed');

  state.status = 'saved';
  return true;
}

function fail(state, message) {
  state.status = 'error';
  state.errorMessage = message;
  return false;
}

function aggregateColumn(rows, sourceName, aggregation) {
  const values = rows.map((r) => normalizeNumber(r[sourceName])).filter((v) => v !== null);
  if (values.length === 0) return null;
  switch (aggregation) {
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length;
    case 'last': return values[values.length - 1];
    case 'max': return Math.max(...values);
    case 'sum':
    default: return values.reduce((a, b) => a + b, 0);
  }
}

// ---------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------

let historyRows = [];

async function refreshHistory() {
  historyRows = await listUploads({ limit: 100 });
  renderHistory();
}

function wireHistoryFilters() {
  ['hist-search', 'hist-station', 'hist-category', 'hist-status'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', renderHistory);
  });
}

function renderHistory() {
  const tbody = document.getElementById('hist-tbody');
  if (!tbody) return;

  const search = (document.getElementById('hist-search')?.value || '').toLowerCase();
  const stationFilter = document.getElementById('hist-station')?.value || '';
  const categoryFilter = (document.getElementById('hist-category')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('hist-status')?.value || '';

  const filtered = historyRows.filter((r) => {
    if (search && !r.filename.toLowerCase().includes(search)) return false;
    if (stationFilter && r.station_id !== stationFilter) return false;
    if (categoryFilter && r.category.toLowerCase() !== categoryFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">No uploads yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r) => {
    const stationName = r.stations?.name || '—';
    const stationColor = r.stations?.color || '#8a978f';
    const uploaderName = r.profiles?.display_name || '—';
    const statusClass = r.status === 'processed' ? 'ok' : r.status === 'overwritten' ? 'warn' : r.status === 'error' ? 'err' : 'new';
    return `
      <tr data-upload-id="${r.id}" data-storage-path="${escapeAttr(r.storage_path || '')}" data-filename="${escapeAttr(r.filename)}">
        <td>${r.upload_date}</td>
        <td><span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;color:${stationColor}"><span style="width:8px;height:8px;border-radius:50%;background:${stationColor}"></span>${escapeHtml(stationName)}</span></td>
        <td><span class="pill" style="background:#f2f4f0;color:var(--ink-2)">${escapeHtml(r.category)}</span></td>
        <td>${escapeHtml(r.filename)}</td>
        <td>${r.row_count ?? '—'}</td>
        <td>${r.metric_values?.[0]?.count ?? 0}</td>
        <td><span class="status ${statusClass}">${r.status}</span></td>
        <td>${escapeHtml(uploaderName)}</td>
        <td><div class="row-actions"><button type="button" data-action="download">⬇</button></div></td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      const path = tr.dataset.storagePath;
      const filename = tr.dataset.filename;
      if (!path) return;
      const url = await getSignedDownloadUrl(path, filename);
      if (url) window.open(url, '_blank');
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}
