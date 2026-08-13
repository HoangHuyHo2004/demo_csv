// Controller for stations.html: real station list + create, backed by
// public.stations. Previously this page was a static mockup (3 hardcoded
// cards with invented revenue/alert numbers, a "Create station" button that
// only closed its own modal) -- everything here is now real data, and the
// KPIs/per-card stats are limited to what's actually derivable (station
// identity + a real upload count), matching how Uploads' category picker
// was rebuilt earlier.
import { requireSession } from './auth.js';
import * as scope from './scope.js';
import { mountScopeSwitcher } from './scope-ui.js';
import { listStationsFull, createStation, stationUploadCounts } from './data.js';
import { formatDateDMY } from './fmt.js';
import { t, applyTranslations, onChange as onLanguageChange } from './i18n.js';

let stations = [];
let uploadCounts = {};

const listEl = document.getElementById('station-list');
const cardTpl = document.getElementById('tpl-station-card');
const modal = document.getElementById('new-stn');
const nameInput = document.getElementById('stn-name');
const codeInput = document.getElementById('stn-code');
const addressInput = document.getElementById('stn-address');
const colorPicker = document.getElementById('stn-colors');

// Currency and timezone aren't per-station choices -- Settings already
// states these are fixed for the whole workspace (₫ VND, Asia/Ho_Chi_Minh),
// so a picker here would offer a choice that doesn't actually do anything.
const WORKSPACE_TIMEZONE = 'Asia/Ho_Chi_Minh';
const WORKSPACE_CURRENCY = 'VND';
const errorEl = document.getElementById('stn-error');

init();

async function init() {
  const result = await requireSession();
  if (!result) return;

  await scope.init(result.session.user.id, { isOwner: result.profile?.role === 'owner' });
  mountScopeSwitcher(result.session.user.id, result.profile?.role === 'owner');

  await refresh();
  wireModal();

  onLanguageChange(() => { applyTranslations(document); render(); });
}

async function refresh() {
  [stations, uploadCounts] = await Promise.all([
    listStationsFull(),
    stationUploadCounts(),
  ]);
  render();
}

function render() {
  renderKpis();
  renderList();
}

function renderKpis() {
  const active = stations.filter((s) => !s.archived_at);
  const archived = stations.length - active.length;
  const totalUploads = stations.reduce((sum, s) => sum + (uploadCounts[s.id] || 0), 0);

  document.querySelector('[data-f="kpi-active"]').textContent = active.length;
  document.querySelector('[data-f="kpi-archived-foot"]').textContent =
    archived > 0 ? t('stations.kpi.archivedFoot', { n: archived }) : '';
  document.querySelector('[data-f="kpi-uploads"]').textContent = totalUploads;
}

function renderList() {
  listEl.innerHTML = '';
  if (stations.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cat-loading';
    empty.textContent = t('stations.empty');
    listEl.appendChild(empty);
    return;
  }
  for (const s of stations) {
    listEl.appendChild(renderCard(s));
  }
}

function renderCard(s) {
  const node = cardTpl.content.firstElementChild.cloneNode(true);
  const color = s.color || '#3455b3';

  node.querySelector('[data-f="stripe"]').style.background = color;
  const ic = node.querySelector('[data-f="ic"]');
  ic.style.background = s.archived_at ? '#8a978f' : color;
  ic.textContent = '⛽';

  node.querySelector('[data-f="name"]').textContent = s.name + (s.code ? ` · ${s.code}` : '');

  const badge = node.querySelector('[data-f="status-badge"]');
  badge.textContent = s.archived_at ? t('stations.status.archived') : t('stations.status.active');
  if (s.archived_at) badge.style.cssText = 'background:var(--chip);color:var(--muted)';

  const subdParts = [s.address, s.timezone, s.currency].filter(Boolean);
  node.querySelector('[data-f="subd"]').textContent = subdParts.join(' · ');

  node.querySelector('[data-f="uploads"]').textContent = uploadCounts[s.id] || 0;
  node.querySelector('[data-f="created"]').textContent = s.created_at ? formatDateDMY(s.created_at.slice(0, 10)) : '—';

  return node;
}

function wireModal() {
  const open = () => {
    nameInput.value = '';
    codeInput.value = '';
    addressInput.value = '';
    errorEl.style.display = 'none';
    modal.style.display = 'flex';
    nameInput.focus();
  };
  const close = () => { modal.style.display = 'none'; };

  document.getElementById('new-stn-btn').addEventListener('click', open);
  document.getElementById('add-station-card').addEventListener('click', open);
  document.getElementById('stn-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  colorPicker.querySelectorAll('.sw').forEach((sw) => {
    sw.addEventListener('click', () => {
      colorPicker.querySelectorAll('.sw').forEach((x) => x.classList.remove('active'));
      sw.classList.add('active');
    });
  });

  document.getElementById('stn-submit').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = t('stations.modalError.empty');
      errorEl.style.display = 'block';
      return;
    }
    const selectedColor = colorPicker.querySelector('.sw.active')?.dataset.color || '#3455b3';
    const { station, code } = await createStation({
      name,
      code: codeInput.value.trim() || null,
      address: addressInput.value.trim() || null,
      timezone: WORKSPACE_TIMEZONE,
      currency: WORKSPACE_CURRENCY,
      color: selectedColor,
    });
    if (!station) {
      errorEl.textContent = code === 'duplicate_code'
        ? t('stations.modalError.duplicateCode')
        : t('stations.modalError.failed');
      errorEl.style.display = 'block';
      return;
    }
    close();
    await refresh();
    await scope.refresh();
  });
}
