// Controller for uploads.html: dropzone, per-file parsing, duplicate-date
// detection, the save/overwrite transaction, and the upload-history table.
//
// Column-to-metric mapping is fully automatic and NOT user-reviewable: every
// column csv.js's inferTypes() calls "number" is tracked as a metric under
// its own source name, except columns that look like a snapshot value
// (looksLikeSnapshot() -- names like inventory/stock/balance), which are
// excluded because summing a snapshot across days is meaningless. There used
// to be a review table here (rename, include/exclude, pick the date column);
// it was removed deliberately -- this app's real files always come from the
// same converter with the same columns, so a per-upload review step was
// friction with no payoff. The trade-off: if a file ever has a column that
// really shouldn't be tracked, or the wrong date column gets auto-detected,
// there is no UI to fix it before saving.
import { requireSession } from './auth.js';
import * as scope from './scope.js';
import {
  listStations, findExistingUpload, getMetricValuesForUpload,
  getMetricsRegistry, upsertMetrics, listUploads, getSignedDownloadUrl,
  uploadFileToStorage, removeStorageObject, insertUploadRow,
  setUploadStatus, insertMetricValues, deleteMetricValuesForUpload,
  listCategories, createCategory, categoryUploadCounts,
} from './data.js';
import {
  parseFile, inferTypes, normalizeNumber, toISODate,
  detectDateFromFilename, detectDateColumnName, looksLikeSnapshot,
} from './csv.js';
import { formatDateDMY } from './fmt.js';
import { t, applyTranslations, onChange as onLanguageChange } from './i18n.js';

let currentUserId = null;
let stations = [];
let categories = [];   // [{ slug, name, icon, description }], global registry
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
  categories = await listCategories();
  populateHistoryStationFilter();
  populateHistoryCategoryFilter();

  // guard.js also initializes scope.js (for the header switcher), but its
  // completion isn't guaranteed by the time this module's top-level code
  // runs -- module scripts don't block each other. scope.init() is safe
  // to call again: it re-derives the same result from localStorage + the
  // accessible station list, so this just guarantees readiness here
  // rather than racing guard.js for it.
  await scope.init(currentUserId, { isOwner: result.profile?.role === 'owner' });

  wireDropzone();
  wireSaveActions();
  wireCategoryPanel();
  await refreshCategoryPanel();
  await refreshHistory();
  wireHistoryFilters();
  document.addEventListener('click', () => { closeAllCalendarPopups(); closeAllCategoryMenus(); });

  // Re-render everything rendered from JS (not caught by applyTranslations'
  // querySelector sweep) whenever the language changes.
  onLanguageChange(() => {
    populateHistoryStationFilter();
    populateHistoryCategoryFilter();
    renderFiles();
    renderHistory();
  });
}

function populateHistoryStationFilter() {
  const sel = document.getElementById('hist-station');
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = `<option value="">${t('common.allStations')}</option>` +
    stations.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  sel.value = prevValue;
}

function populateHistoryCategoryFilter() {
  const sel = document.getElementById('hist-category');
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = `<option value="">${t('uploads.history.allCategories')}</option>` +
    categories.map((c) => `<option value="${c.slug}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = prevValue;
}

// ---------------------------------------------------------------------
// Category panel (right column) -- backed by the real categories table,
// not the static mockup cards this used to be.
// ---------------------------------------------------------------------

function categorySlug(name) {
  return name.trim().toLowerCase();
}

// Resolves whatever a user typed to a canonical {slug, name}, creating the
// category if it doesn't exist yet. Shared by the inline per-file category
// field and the "Add category" modal so both go through one path.
async function resolveOrCreateCategory(rawName) {
  const name = rawName.trim();
  if (!name) return null;
  const slug = categorySlug(name);
  const existing = categories.find((c) => c.slug === slug);
  if (existing) return existing;

  const created = await createCategory({ slug, name });
  if (!created) return null;
  categories = [...categories, created].sort((a, b) => a.name.localeCompare(b.name));
  populateHistoryCategoryFilter();
  await refreshCategoryPanel();
  return created;
}

async function refreshCategoryPanel() {
  const list = document.getElementById('category-panel-list');
  if (!list) return;
  const counts = await categoryUploadCounts();
  if (categories.length === 0) {
    list.innerHTML = `<div class="cat-loading">${t('uploads.categories.empty')}</div>`;
    return;
  }
  list.innerHTML = categories.map((c) => `
    <div class="cat">
      <div class="icon${c.icon ? '' : ' default'}">${c.icon ? escapeHtml(c.icon) : '🏷️'}</div>
      <div><div class="n">${escapeHtml(c.name)}</div><div class="d">${escapeHtml(c.description || '')}</div></div>
      <div class="count">${t('uploads.categories.uploadCount', { n: counts[c.slug] || 0 })}</div>
    </div>`).join('');
}

// Shared by two entry points: the right-hand panel's "+ Add new category"
// button (no callback -- it only needs the panel/menus to refresh, which
// resolveOrCreateCategory already does) and a per-file category dropdown's
// own "+ Add new category" row (needs the callback, so the newly created
// category is selected on that specific row rather than left unset).
let addCategoryCallback = null;

function openAddCategoryModal(onCreated) {
  addCategoryCallback = onCreated || null;
  const modal = document.getElementById('add-cat-modal');
  const nameInput = document.getElementById('add-cat-name');
  const errorEl = document.getElementById('add-cat-error');
  if (!modal) return;
  nameInput.value = '';
  errorEl.style.display = 'none';
  modal.style.display = 'flex';
  nameInput.focus();
}

function wireCategoryPanel() {
  const modal = document.getElementById('add-cat-modal');
  const nameInput = document.getElementById('add-cat-name');
  const errorEl = document.getElementById('add-cat-error');
  const openBtn = document.getElementById('add-cat-btn');
  if (!modal || !openBtn) return;

  const close = () => { modal.style.display = 'none'; addCategoryCallback = null; };

  openBtn.addEventListener('click', () => openAddCategoryModal(null));
  document.getElementById('add-cat-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  document.getElementById('add-cat-submit').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = t('uploads.categoryModal.errorEmpty');
      errorEl.style.display = 'block';
      return;
    }
    if (categories.some((c) => c.slug === categorySlug(name))) {
      errorEl.textContent = t('uploads.categoryModal.errorExists');
      errorEl.style.display = 'block';
      return;
    }
    const created = await resolveOrCreateCategory(name);
    if (!created) {
      errorEl.textContent = t('uploads.categoryModal.errorFailed');
      errorEl.style.display = 'block';
      return;
    }
    const cb = addCategoryCallback;
    modal.style.display = 'none';
    addCategoryCallback = null;
    if (cb) cb(created);
  });
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
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) continue;
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
    categoryName: '',
    resolvedDate: null,
    dateSource: null,
    duplicate: null,
    overwriteConfirmed: false,
    status: 'draft',
    errorMessage: '',
  };

  if (parsed.headers.length === 0 || parsed.rowCount === 0) {
    state.status = 'error';
    state.errorMessage = t('uploads.error.emptyFile');
    return state;
  }

  const types = inferTypes(parsed.headers, parsed.rows);
  const dateColName = detectDateColumnName(types);

  state.columns = types.map((col) => {
    const snapshot = col.type === 'number' && looksLikeSnapshot(col.name);
    return {
      sourceName: col.name,
      mappedName: col.name,
      type: col.type,
      isDateCol: col.name === dateColName,
      include: col.type === 'number' && !snapshot,
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

const STATUS_LABEL_KEY = {
  draft: 'uploads.status.parsing',
  'needs-station': 'uploads.status.needsStation',
  'needs-category': 'uploads.status.needsCategory',
  'needs-date': 'uploads.status.needsDate',
  duplicate: 'uploads.status.duplicate',
  ready: 'uploads.status.ready',
  saving: 'uploads.status.saving',
  saved: 'uploads.status.saved',
  error: 'common.error',
};
const STATUS_CLASS = {
  draft: 'new', 'needs-station': 'warn', 'needs-category': 'warn', 'needs-date': 'warn',
  duplicate: 'warn', ready: 'ok', saving: 'ok', saved: 'ok', error: 'err',
};
function statusLabel(status) {
  const key = STATUS_LABEL_KEY[status];
  return key ? t(key) : status;
}
const DATE_SOURCE_LABEL_KEY = {
  column: 'uploads.dateSource.column',
  filename: 'uploads.dateSource.filename',
  manual: 'uploads.dateSource.manual',
};
function dateSourceLabel(source) {
  const key = DATE_SOURCE_LABEL_KEY[source];
  return key ? t(key) : source;
}

function renderFileRow(state) {
  const node = rowTpl.content.firstElementChild.cloneNode(true);
  const sizeKb = (state.file.size / 1024).toFixed(1);

  // Column mapping's review table is gone (auto-mapped, no manual step), so
  // this is the only remaining signal of what's actually being tracked --
  // worth surfacing the metric count here rather than making it invisible.
  const metricCount = state.columns.filter((c) => c.include && c.type === 'number').length;

  node.querySelector('[data-f="name"]').textContent = state.file.name;
  node.querySelector('[data-f="sub"]').textContent = state.status === 'error'
    ? state.errorMessage
    : (state.resolvedDate
        ? t('uploads.fileRow.subResolved', { size: sizeKb, rows: state.rows.length, metrics: metricCount, date: state.resolvedDate, source: dateSourceLabel(state.dateSource) })
        : t('uploads.fileRow.subUnresolved', { size: sizeKb, rows: state.rows.length, metrics: metricCount }));

  const statusEl = node.querySelector('[data-f="status"]');
  statusEl.textContent = statusLabel(state.status);
  statusEl.className = 'status ' + (STATUS_CLASS[state.status] || '');

  const stationSel = node.querySelector('[data-f="station"]');
  stationSel.innerHTML = `<option value="">${t('uploads.selectStationOption')}</option>` +
    stations.map((s) => `<option value="${s.id}"${s.id === state.stationId ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  stationSel.addEventListener('change', async () => {
    state.stationId = stationSel.value;
    await checkDuplicate(state);
    computeStatus(state);
    renderFiles();
  });

  wireCategoryPicker(node, state);
  wireDateField(node, state);

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

  // The row is cloned from <template>, so it was never covered by the
  // document-wide applyTranslations() sweep -- apply it now to pick up the
  // date-override title / remove button title. NOT the category label: that
  // element's text is entirely owned by wireCategoryPicker()'s syncLabel(),
  // which already calls t() itself for both the placeholder and the
  // selected-category cases -- leaving a static data-i18n on it here would
  // make applyTranslations() stomp the selected category name back to the
  // placeholder on every re-render (this happened once already).
  applyTranslations(node);

  return node;
}

// ---------------------------------------------------------------------
// Date field: a text input the app masks and parses itself, plus a small
// hand-built calendar popup -- not a native <input type="date">, whose
// segment-typing behaviour (which digit group gets focus, how many digits
// before auto-advancing) is entirely browser/OS-controlled and was the
// actual cause of "typing 2024 only shows 24 or 2". Parsing goes through
// toISODate() from csv.js, the same day-first parser the CSV pipeline
// already uses -- one date-parsing rule for the whole app, never
// `new Date(string)`.
// ---------------------------------------------------------------------

function maskDateInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

function closeAllCalendarPopups() {
  document.querySelectorAll('.cal-popup:not([hidden])').forEach((p) => { p.hidden = true; });
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function buildCalendarHtml(viewMonth, selectedISO) {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday = 0, matching dd/mm/yyyy's own convention
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayISO = new Date().toISOString().slice(0, 10);

  let cells = WEEKDAY_KEYS.map((k) => `<div class="cal-cell wd">${t('statistics.weekday.' + k)}</div>`).join('');
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = ['cal-cell', 'day', iso === selectedISO ? 'sel' : '', iso === todayISO ? 'today' : '']
      .filter(Boolean).join(' ');
    cells += `<div class="${cls}" data-iso="${iso}">${d}</div>`;
  }

  return `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1">‹</button>
      <span class="cal-label">${String(m + 1).padStart(2, '0')}/${y}</span>
      <button type="button" class="cal-nav" data-nav="1">›</button>
    </div>
    <div class="cal-grid">${cells}</div>`;
}

function wireDateField(node, state) {
  const input = node.querySelector('[data-f="date-override"]');
  const btn = node.querySelector('[data-f="cal-btn"]');
  const popup = node.querySelector('[data-f="cal-popup"]');
  let viewMonth = state.resolvedDate ? new Date(state.resolvedDate + 'T00:00:00') : new Date();

  input.value = state.resolvedDate ? formatDateDMY(state.resolvedDate) : '';

  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    const before = input.value;
    input.value = maskDateInput(input.value);
    // Slashes get inserted as the user types past a segment boundary; keep
    // the cursor roughly where it was rather than always snapping to the end.
    input.setSelectionRange(pos + (input.value.length - before.length), pos + (input.value.length - before.length));
  });

  async function applyDate(iso) {
    state.resolvedDate = iso;
    state.dateSource = 'manual';
    input.classList.remove('invalid');
    await checkDuplicate(state);
    computeStatus(state);
    renderFiles();
  }

  input.addEventListener('change', async () => {
    const raw = input.value.trim();
    if (!raw) { await applyDate(null); return; }
    const iso = toISODate(raw);
    if (!iso) { input.classList.add('invalid'); return; }   // leave resolvedDate as-is; let them fix it
    await applyDate(iso);
  });

  function renderPopup() {
    popup.innerHTML = buildCalendarHtml(viewMonth, state.resolvedDate);
    popup.querySelectorAll('.cal-nav').forEach((navBtn) => {
      navBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + Number(navBtn.dataset.nav), 1);
        renderPopup();
      });
    });
    popup.querySelectorAll('.cal-cell.day').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        popup.hidden = true;
        applyDate(cell.dataset.iso);
      });
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = popup.hidden;
    closeAllCalendarPopups();
    closeAllCategoryMenus();
    if (willOpen) {
      viewMonth = state.resolvedDate ? new Date(state.resolvedDate + 'T00:00:00') : new Date();
      renderPopup();
      popup.hidden = false;
    }
  });
  popup.addEventListener('click', (e) => e.stopPropagation());
}

// ---------------------------------------------------------------------
// Category picker: click-open list (same interaction as the header's
// station scope switcher), not a text field -- selecting an existing
// category is a single click, and "+ Add new category" opens the same
// modal the right-hand panel uses, auto-selecting the result on this row.
// ---------------------------------------------------------------------

function closeAllCategoryMenus() {
  document.querySelectorAll('.cat-picker__menu:not([hidden])').forEach((m) => { m.hidden = true; });
}

function wireCategoryPicker(node, state) {
  const btn = node.querySelector('[data-f="cat-picker-btn"]');
  const label = node.querySelector('[data-f="cat-picker-label"]');
  const menu = node.querySelector('[data-f="cat-picker-menu"]');

  function syncLabel() {
    if (state.category) {
      label.textContent = state.categoryName || state.category;
      btn.classList.remove('placeholder');
    } else {
      label.textContent = t('uploads.fileRow.categoryPlaceholder');
      btn.classList.add('placeholder');
    }
  }
  syncLabel();

  async function selectCategory(cat) {
    state.category = cat.slug;
    state.categoryName = cat.name;
    syncLabel();
    menu.hidden = true;
    await checkDuplicate(state);
    computeStatus(state);
    renderFiles();
  }

  function renderMenu() {
    const items = categories.map((c) => `
      <li class="cat-picker__item${c.slug === state.category ? ' active' : ''}" data-slug="${escapeAttr(c.slug)}">
        <span class="ic">${c.icon ? escapeHtml(c.icon) : '🏷️'}</span>${escapeHtml(c.name)}
      </li>`).join('');
    menu.innerHTML =
      (items || `<li class="cat-picker__empty">${t('uploads.categories.empty')}</li>`) +
      `<li class="cat-picker__item add-new" data-action="add-new"><span class="ic">＋</span>${t('uploads.categories.addNew')}</li>`;

    menu.querySelectorAll('[data-slug]').forEach((li) => {
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const cat = categories.find((c) => c.slug === li.dataset.slug);
        if (cat) selectCategory(cat);
      });
    });
    menu.querySelector('[data-action="add-new"]').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = true;
      openAddCategoryModal((created) => selectCategory(created));
    });
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = menu.hidden;
    closeAllCategoryMenus();
    closeAllCalendarPopups();
    if (willOpen) {
      renderMenu();
      menu.hidden = false;
    }
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
}

function renderDuplicateBanner(state) {
  const diffs = state.columns
    .filter((c) => c.include)
    .map((c) => {
      const old = state.duplicate.oldValues.find((v) => v.metric_name === c.mappedName);
      const newVal = aggregateColumn(state.rows, c.sourceName, 'sum');
      return old
        ? `${escapeHtml(c.mappedName)}: <span class="old">${old.value}</span> → <span class="new">${newVal ?? '—'}</span>`
        : `${escapeHtml(c.mappedName)}: <span class="new">${newVal ?? '—'}</span> ${t('uploads.duplicate.newSuffix')}`;
    })
    .join(' &nbsp;·&nbsp; ');
  const confirmed = state.overwriteConfirmed;
  return `
    <div class="icon">!</div>
    <div>
      <b>${escapeHtml(state.duplicate.filename)}</b> — ${t('uploads.duplicate.exists', { category: escapeHtml(state.category), date: state.resolvedDate })}
      ${confirmed ? t('uploads.duplicate.confirmedNote') : t('uploads.duplicate.previewNote')}
      <div class="diff">${diffs || t('uploads.duplicate.noOverlap')}</div>
      ${confirmed ? '' : `<button type="button" class="btn ghost" data-f="confirm-overwrite" style="margin-top:8px">${t('uploads.duplicate.confirmButton')}</button>`}
    </div>`;
}


function updateSaveButton() {
  const readyCount = fileStates.filter((s) => s.status === 'ready').length;
  saveAllBtn.textContent = t('uploads.actions.confirmSaveCount', {
    n: readyCount || '',
    s: readyCount === 1 ? '' : 's',
  }).replace('  ', ' ');
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
  const ext = (state.file.name.match(/\.(csv|xlsx|xls)$/i) || ['', 'csv'])[1].toLowerCase();
  const storagePath = `${state.stationId}/${state.resolvedDate}/${uploadId}.${ext}`;
  const isOverwrite = !!state.duplicate;

  state.status = 'saving';
  renderFiles();

  // Step 1: storage upload. Fails -> abort, nothing persisted.
  const { error: storageErr } = await uploadFileToStorage(storagePath, state.file);
  if (storageErr) return fail(state, t('uploads.error.uploadFailed', { message: storageErr.message }));

  // Step 1b (overwrite only): mark the old row overwritten first, freeing
  // the partial unique index for the new row.
  if (isOverwrite) {
    const { error: markErr } = await setUploadStatus(state.duplicate.existingUploadId, 'overwritten');
    if (markErr) {
      await removeStorageObject(storagePath);
      return fail(state, t('uploads.error.overwritePrep', { message: markErr.message }));
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
      ? t('uploads.error.duplicateRace')
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
    return fail(state, t('uploads.error.saveValuesFailed', { message: chunkErr.message }));
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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:24px">${t('uploads.history.empty')}</td></tr>`;
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
        <td><span class="pill" style="background:var(--chip);color:var(--ink-2)">${escapeHtml(r.category)}</span></td>
        <td>${escapeHtml(r.filename)}</td>
        <td>${r.row_count ?? '—'}</td>
        <td>${r.metric_values?.[0]?.count ?? 0}</td>
        <td><span class="status ${statusClass}">${historyStatusLabel(r.status)}</span></td>
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

const HISTORY_STATUS_LABEL_KEY = {
  processed: 'common.processed',
  overwritten: 'common.overwritten',
  pending: 'common.pending',
  error: 'common.error',
};
function historyStatusLabel(status) {
  const key = HISTORY_STATUS_LABEL_KEY[status];
  return key ? t(key) : status;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}
