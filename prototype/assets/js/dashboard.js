// Controller for index.html (Overview). Loads one 60-day window of
// metric_daily, splits it client-side into "current 30 days" vs "previous
// 30 days" for deltas, and derives every widget from that single dataset.
import { requireSession } from './auth.js';
import * as scope from './scope.js';
import { loadMetricDaily, listStations, listUploads, getMetricsRegistry } from './data.js';
import { barPercents, donutSegments } from './charts.js';
import { formatNumber, formatCompact, formatCurrencyCompact, percentDelta, formatDelta, displayMetricName, metricColor, isoDateNDaysAgo, formatDateDMY, weekdayLabel } from './fmt.js';
import { emptyTableRow, emptyCardHtml } from './empty.js';
import { t, onChange as onLanguageChange } from './i18n.js';

let stations = [];
let currentUserId = null;
let isOwner = false;

init();

async function init() {
  const result = await requireSession();
  if (!result) return;
  currentUserId = result.session.user.id;
  isOwner = result.profile?.role === 'owner';

  await scope.init(currentUserId, { isOwner });
  stations = scope.stations();

  await render();
  scope.onChange(() => render());
  onLanguageChange(() => render());
}

async function render() {
  const today = isoDateNDaysAgo(0);
  const windowStart = isoDateNDaysAgo(59);
  const currentStart = isoDateNDaysAgo(29);
  const previousEnd = isoDateNDaysAgo(30);

  const cur = scope.current();
  const stationIds = cur.mode === 'station' && cur.stationId ? [cur.stationId] : undefined;

  const rows = await loadMetricDaily({ stationIds, from: windowStart, to: today });
  const currentRows = rows.filter((r) => r.value_date >= currentStart);
  const previousRows = rows.filter((r) => r.value_date < currentStart && r.value_date <= previousEnd);

  const metricNames = [...new Set(rows.map((r) => r.metric_name))];
  const registry = await getMetricsRegistry(metricNames);

  renderKpis(currentRows, previousRows, registry);
  renderRevenueCard(currentRows, previousRows, registry);
  renderMetricBreakdown(currentRows, registry);
  renderDonut(currentRows, registry);
  await renderRecentUploads(stationIds);
}

// ---------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------

function repValue(rows, metricName, registry) {
  const matching = rows.filter((r) => r.metric_name === metricName);
  if (matching.length === 0) return null;
  const agg = registry[metricName]?.aggregation || 'sum';
  if (agg === 'last' || agg === 'max') {
    return [...matching].sort((a, b) => a.value_date.localeCompare(b.value_date)).pop().value;
  }
  return matching.reduce((a, r) => a + Number(r.value), 0);
}

function byStationTotal(rows, metricName) {
  const totals = {};
  for (const r of rows) {
    if (r.metric_name !== metricName) continue;
    totals[r.station_id] = (totals[r.station_id] || 0) + Number(r.value);
  }
  return totals;
}

function topMetrics(rows, registry, n) {
  const names = [...new Set(rows.map((r) => r.metric_name))];
  return names
    .map((name) => ({ name, value: repValue(rows, name, registry) || 0 }))
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ---------------------------------------------------------------------
// KPI cards
// ---------------------------------------------------------------------

function renderKpis(currentRows, previousRows, registry) {
  setKpi('net-income', repValue(currentRows, 'revenue', registry), repValue(previousRows, 'revenue', registry), true);
  setKpi('losses', repValue(currentRows, 'losses', registry), repValue(previousRows, 'losses', registry), true);
}

function setKpi(key, current, previous, isCurrency) {
  const valueEl = document.getElementById(`kpi-${key}-value`);
  const deltaEl = document.getElementById(`kpi-${key}-delta`);
  if (valueEl) valueEl.textContent = current === null ? '—' : formatNumber(current);
  if (deltaEl) {
    const pct = percentDelta(current, previous);
    deltaEl.textContent = pct === null ? '—' : formatDelta(pct);
    deltaEl.className = 'delta ' + (pct === null ? '' : pct >= 0 ? 'up' : 'down');
  }
}

// ---------------------------------------------------------------------
// Revenue card: big number, station chips, 7-day bars
// ---------------------------------------------------------------------

function renderRevenueCard(currentRows, previousRows, registry) {
  const total = repValue(currentRows, 'revenue', registry);
  const prevTotal = repValue(previousRows, 'revenue', registry);
  const pct = percentDelta(total, prevTotal);

  const bigEl = document.getElementById('revenue-big');
  if (bigEl) {
    bigEl.innerHTML = `${total === null ? '—' : formatCurrencyCompact(total)} <small>${pct === null ? '' : formatDelta(pct) + ' ' + t('index.revenue.vsPriorPeriod')}</small>`;
  }

  const chipsEl = document.getElementById('revenue-station-chips');
  if (chipsEl) {
    const byStation = byStationTotal(currentRows, 'revenue');
    const chips = stations
      .filter((s) => byStation[s.id])
      .map((s) => `<div style="background:#f6f8f4;border-radius:10px;padding:6px 10px;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--ink-2)"><span style="width:8px;height:8px;border-radius:50%;background:${s.color}"></span>${escapeHtml(s.name)} · <b style="color:var(--ink)">${formatCurrencyCompact(byStation[s.id])}</b></div>`);
    chipsEl.innerHTML = chips.join('') || `<span style="font-size:11px;color:var(--muted)">${t('index.revenue.noStationBreakdown')}</span>`;
  }

  renderRevenueBars(currentRows, registry);
}

function renderRevenueBars(currentRows, registry) {
  const barsEl = document.getElementById('revenue-bars');
  const xaxEl = document.getElementById('revenue-xax');
  if (!barsEl) return;

  const days = [];
  for (let i = 6; i >= 0; i--) days.push(isoDateNDaysAgo(i));

  const seriesA = days.map((d) => sumOnDay(currentRows, 'revenue', d));
  const seriesB = days.map((d) => sumOnDay(currentRows, 'purchases', d));
  const pctA = barPercents(seriesA.map((v) => v || 0));
  const pctB = barPercents(seriesB.map((v) => v || 0));

  barsEl.innerHTML = days.map((d, i) => `
    <div class="bar-group">
      <div class="bar" style="height:${pctA[i]}%"></div>
      <div class="bar b" style="height:${pctB[i]}%"></div>
    </div>`).join('');

  if (xaxEl) {
    xaxEl.innerHTML = days.map((d) => `<span>${weekdayLabel(d)}</span>`).join('');
  }
}

function sumOnDay(rows, metricName, date) {
  return rows
    .filter((r) => r.metric_name === metricName && r.value_date === date)
    .reduce((a, r) => a + Number(r.value), 0);
}

// ---------------------------------------------------------------------
// Metric breakdown (top 4 by representative value)
// ---------------------------------------------------------------------

function renderMetricBreakdown(currentRows, registry) {
  const container = document.getElementById('metric-breakdown');
  if (!container) return;
  const top = topMetrics(currentRows, registry, 4);
  if (top.length === 0) {
    container.innerHTML = emptyCardHtml(t('empty.noMetricsTrackedPeriod'));
    return;
  }
  const max = top[0].value || 1;
  container.innerHTML = top.map((m, i) => {
    const pct = Math.max(4, (m.value / max) * 100);
    const fillClass = i % 2 === 0 ? '' : i % 3 === 0 ? 'md' : 'dk';
    return `
      <div class="hbar"><div class="label">${escapeHtml(displayMetricName(m.name))}</div>
        <div class="track"><div class="fill ${fillClass}" style="width:${pct}%">${formatNumber(m.value)}</div></div>
      </div>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Donut (top 3 by representative value)
// ---------------------------------------------------------------------

function renderDonut(currentRows, registry) {
  const svg = document.getElementById('donut-svg');
  const centerEl = document.getElementById('donut-center-value');
  const legendEl = document.getElementById('donut-legend');
  if (!svg) return;

  // Sized by RECORD COUNT per metric, not summed value -- a value-weighted
  // pie would be meaningless here, since e.g. revenue (millions of dong)
  // and sales_volume (a few hundred units) are entirely different units.
  // Counting rows keeps every metric on the same, comparable scale and
  // matches the "Records" figure already shown in the center.
  const counts = {};
  for (const r of currentRows) counts[r.metric_name] = (counts[r.metric_name] || 0) + 1;
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3);
  const circles = svg.querySelectorAll('[data-donut-seg]');
  const texts = svg.querySelectorAll('[data-donut-text]');

  if (top.length === 0) {
    circles.forEach((c) => c.setAttribute('stroke-dasharray', '0 100'));
    texts.forEach((el) => { el.textContent = ''; });
    if (centerEl) centerEl.textContent = '—';
    if (legendEl) legendEl.innerHTML = `<span style="color:var(--muted)">${t('empty.noDataYet')}</span>`;
    return;
  }

  const parts = top.map((name, i) => ({ value: counts[name], color: metricColor(name, i), name }));
  const segs = donutSegments(parts);

  segs.forEach((seg, i) => {
    const c = circles[i];
    if (!c) return;
    c.setAttribute('stroke', seg.color);
    c.setAttribute('stroke-dasharray', seg.dasharray);
    c.setAttribute('stroke-dashoffset', String(seg.dashoffset));
    const textEl = texts[i];
    if (textEl) textEl.textContent = seg.pct >= 1 ? `${Math.round(seg.pct)}%` : '';
  });
  // Zero-out any leftover segment slots when fewer than 3 metrics exist.
  for (let i = segs.length; i < circles.length; i++) {
    circles[i]?.setAttribute('stroke-dasharray', '0 100');
    if (texts[i]) texts[i].textContent = '';
  }

  if (centerEl) centerEl.textContent = formatCompact(currentRows.length);
  if (legendEl) {
    legendEl.innerHTML = parts.map((p) => `<span><span class="sw" style="background:${p.color}"></span>${escapeHtml(displayMetricName(p.name))}</span>`).join('');
  }
}

// ---------------------------------------------------------------------
// Recent uploads
// ---------------------------------------------------------------------

async function renderRecentUploads(stationIds) {
  const listEl = document.getElementById('recent-uploads-list');
  if (!listEl) return;
  const uploads = await listUploads({ stationIds, limit: 6 });
  if (uploads.length === 0) {
    listEl.innerHTML = emptyCardHtml(t('empty.noUploadsYet'));
    return;
  }
  listEl.innerHTML = uploads.map((u) => {
    const statusClass = u.status === 'processed' ? 'completed' : u.status === 'error' ? 'pending' : 'pending';
    const dateLabel = formatDateDMY(u.upload_date);
    return `
      <div class="tx"><div class="thumb">📄</div>
        <div class="meta"><div class="name">${escapeHtml(u.category)} — ${escapeHtml(u.filename)}</div><div class="date">${dateLabel}</div></div>
        <div class="right"><span class="status ${statusClass}">${escapeHtml(statusLabel(u.status))}</span><div class="code">${escapeHtml(u.station_id ? u.station_id.slice(0, 8).toUpperCase() : '')}</div></div>
      </div>`;
  }).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Upload status codes are a fixed, known set -- translate via the shared
// common.* keys rather than leaving raw DB values ("processed", "error")
// on screen. Unrecognized values (shouldn't happen) fall back to the raw
// string so nothing silently disappears.
function statusLabel(status) {
  const key = { processed: 'common.processed', overwritten: 'common.overwritten', pending: 'common.pending', error: 'common.error' }[status];
  return key ? t(key) : status;
}
