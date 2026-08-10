// Controller for statistics.html. Same one-query-per-page pattern as
// dashboard.js: a single 60-day metric_daily load (current 30d + prior
// 30d for deltas), then every widget below derives from that one dataset.
// The range/chart-type/category-chip controls remain decorative for now
// (see Phase 5 scope) -- only the widgets get wired to real data.
import { requireSession } from './auth.js';
import * as scope from './scope.js';
import { loadMetricDaily, listStations, listUploads, getMetricsRegistry } from './data.js';
import { polylinePoints, areaPath, sparkline, heatCells, pearsonR } from './charts.js';
import {
  formatNumber, formatCompact, formatCurrencyCompact, percentDelta, formatDelta,
  displayMetricName, metricColor, isoDateNDaysAgo, dateRangeDays,
} from './fmt.js';
import { emptyTableRow, emptyCardHtml } from './empty.js';

let stations = [];

init();

async function init() {
  const result = await requireSession();
  if (!result) return;
  const isOwner = result.profile?.role === 'owner';

  await scope.init(result.session.user.id, { isOwner });
  stations = scope.stations();

  await render();
  scope.onChange(() => render());
}

async function render() {
  const today = isoDateNDaysAgo(0);
  const windowStart = isoDateNDaysAgo(59);
  const currentStart = isoDateNDaysAgo(29);
  const previousEnd = isoDateNDaysAgo(30);
  const days = dateRangeDays(currentStart, today);

  const cur = scope.current();
  const stationIds = cur.mode === 'station' && cur.stationId ? [cur.stationId] : undefined;

  const rows = await loadMetricDaily({ stationIds, from: windowStart, to: today });
  const currentRows = rows.filter((r) => r.value_date >= currentStart);
  const previousRows = rows.filter((r) => r.value_date < currentStart && r.value_date <= previousEnd);

  const metricNames = [...new Set(rows.map((r) => r.metric_name))];
  const registry = await getMetricsRegistry(metricNames);
  const uploads = await listUploads({ stationIds, limit: 500 });

  renderKpis(currentRows, previousRows, registry, days);
  renderLeaderboard(currentRows, previousRows, registry, uploads, days);
  renderTrendChart(currentRows, registry, days);
  renderStacked(currentRows, registry, days);
  renderHeatmap(currentRows, days);
  renderCorrelation(currentRows, days);
  renderDeltaTable(currentRows, previousRows, registry, days);
  renderTopBottomDays(currentRows, days);
  renderRawTable(currentRows, days);
}

// ---------------------------------------------------------------------
// Shared aggregation helpers
// ---------------------------------------------------------------------

function seriesByDay(rows, metricName, days) {
  const byDate = {};
  for (const r of rows) {
    if (r.metric_name !== metricName) continue;
    byDate[r.value_date] = (byDate[r.value_date] || 0) + Number(r.value);
  }
  return days.map((d) => byDate[d] ?? null);
}

function repValue(rows, metricName, registry) {
  const matching = rows.filter((r) => r.metric_name === metricName);
  if (matching.length === 0) return null;
  const agg = registry[metricName]?.aggregation || 'sum';
  if (agg === 'last' || agg === 'max') {
    return [...matching].sort((a, b) => a.value_date.localeCompare(b.value_date)).pop().value;
  }
  return matching.reduce((a, r) => a + Number(r.value), 0);
}

function rankedMetrics(rows, registry, n) {
  const names = [...new Set(rows.map((r) => r.metric_name))];
  return names
    .map((name) => ({ name, value: repValue(rows, name, registry) || 0 }))
    .filter((m) => m.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n)
    .map((m) => m.name);
}

// ---------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------

function renderKpis(currentRows, previousRows, registry, days) {
  const specs = [
    { key: 'total-sales', metric: 'sales_volume', currency: false, label: 'Total sales' },
    { key: 'avg-day', metric: 'sales_volume', currency: false, isAvg: true, label: 'Avg / day' },
    { key: 'total-purchases', metric: 'purchases', currency: false, label: 'Total purchases' },
    { key: 'losses', metric: 'losses', currency: true, label: 'Losses' },
    { key: 'inventory-avg', metric: 'inventory_on_hand', currency: false, isAvg: true, label: 'Inventory (avg)' },
  ];
  for (const spec of specs) {
    const el = document.getElementById(`kpi-${spec.key}`);
    if (!el) continue;
    let value = repValue(currentRows, spec.metric, registry);
    let prevValue = repValue(previousRows, spec.metric, registry);
    if (spec.isAvg && value !== null) {
      const present = currentRows.filter((r) => r.metric_name === spec.metric).length;
      value = present > 0 ? value / present : null;
      const prevPresent = previousRows.filter((r) => r.metric_name === spec.metric).length;
      prevValue = prevPresent > 0 && prevValue !== null ? prevValue / prevPresent : null;
    }
    const valEl = el.querySelector('[data-f="val"]');
    const deltaEl = el.querySelector('[data-f="delta"]');
    const sparkEl = el.querySelector('[data-f="spark"]');
    if (valEl) valEl.textContent = value === null ? '—' : (spec.currency ? formatCurrencyCompact(value) : formatCompact(value));
    const pct = percentDelta(value, prevValue);
    if (deltaEl) {
      deltaEl.textContent = pct === null ? '—' : formatDelta(pct);
      deltaEl.className = 'delta ' + (pct === null ? '' : pct >= 0 ? 'up' : 'down');
    }
    if (sparkEl) {
      const series = seriesByDay(currentRows, spec.metric, days);
      sparkEl.setAttribute('points', sparkline(series, 60, 26));
    }
  }
}

// ---------------------------------------------------------------------
// Station leaderboard
// ---------------------------------------------------------------------

function renderLeaderboard(currentRows, previousRows, registry, uploads, days) {
  const tbody = document.getElementById('leaderboard-tbody');
  if (!tbody) return;

  const visibleStations = stations.length ? stations : [];
  if (visibleStations.length === 0) {
    tbody.innerHTML = emptyTableRow(8, 'No stations accessible yet.');
    return;
  }

  const rowsHtml = [];
  const totals = { revenue: 0, sales: 0, losses: 0, purchases: 0 };
  let idx = 0;
  const ranked = visibleStations
    .map((s) => {
      const stRows = currentRows.filter((r) => r.station_id === s.id);
      const revenue = repValue(stRows, 'revenue', registry) || 0;
      const prevRevenue = repValue(previousRows.filter((r) => r.station_id === s.id), 'revenue', registry);
      const salesVol = repValue(stRows, 'sales_volume', registry) || 0;
      const losses = repValue(stRows, 'losses', registry) || 0;
      const purchases = repValue(stRows, 'purchases', registry) || 0;
      const margin = revenue > 0 ? ((revenue - purchases - losses) / revenue) * 100 : null;
      const uploadDates = new Set(uploads.filter((u) => u.station_id === s.id && u.status !== 'overwritten').map((u) => u.upload_date));
      const coverage = (days.filter((d) => uploadDates.has(d)).length / days.length) * 100;
      const trend = seriesByDay(stRows, 'revenue', days);
      return { station: s, revenue, prevRevenue, salesVol, losses, margin, coverage, trend };
    })
    .sort((a, b) => b.revenue - a.revenue);

  ranked.forEach((r) => {
    idx++;
    totals.revenue += r.revenue;
    totals.sales += r.salesVol;
    totals.losses += r.losses;
    const pct = percentDelta(r.revenue, r.prevRevenue);
    const rankClass = idx === 1 ? 'top' : '';
    rowsHtml.push(`
      <tr style="cursor:pointer">
        <td style="padding:10px;border-bottom:1px solid var(--line)"><span class="rank ${rankClass}" style="display:inline-block;width:22px;height:22px;background:${idx === 1 ? 'var(--accent)' : '#f2f4f0'};color:${idx === 1 ? '#0f2a1f' : 'var(--ink-2)'};border-radius:50%;text-align:center;font-weight:800;font-size:11px;line-height:22px">${idx}</span></td>
        <td style="padding:10px;border-bottom:1px solid var(--line)"><span style="display:inline-flex;align-items:center;gap:6px;font-weight:700"><span style="width:8px;height:8px;border-radius:50%;background:${r.station.color}"></span>${escapeHtml(r.station.name)}</span></td>
        <td style="padding:10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${formatCurrencyCompact(r.revenue)} ${pct === null ? '' : `<span style="color:${pct >= 0 ? '#1f8f4a' : 'var(--red)'};font-weight:700">${formatDelta(pct)}</span>`}</td>
        <td style="padding:10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${formatNumber(r.salesVol)}</td>
        <td style="padding:10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${formatCurrencyCompact(r.losses)}</td>
        <td style="padding:10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums">${r.margin === null ? '—' : r.margin.toFixed(1) + '%'}</td>
        <td style="padding:10px;border-bottom:1px solid var(--line);text-align:right">${r.coverage.toFixed(0)}%</td>
        <td style="padding:10px;border-bottom:1px solid var(--line)"><svg width="70" height="20"><polyline fill="none" stroke="${r.station.color}" stroke-width="1.5" points="${polylinePoints(r.trend, { w: 70, h: 20, pad: 2 })}"/></svg></td>
      </tr>`);
  });

  const combinedMargin = totals.revenue > 0 ? ((totals.revenue - currentRows.filter((r) => r.metric_name === 'purchases').reduce((a, r) => a + Number(r.value), 0) - totals.losses) / totals.revenue) * 100 : null;

  rowsHtml.push(`
    <tr style="background:#fafbf8;font-weight:700">
      <td style="padding:10px"></td>
      <td style="padding:10px">Combined</td>
      <td style="padding:10px;text-align:right;font-variant-numeric:tabular-nums">${formatCurrencyCompact(totals.revenue)}</td>
      <td style="padding:10px;text-align:right;font-variant-numeric:tabular-nums">${formatNumber(totals.sales)}</td>
      <td style="padding:10px;text-align:right;font-variant-numeric:tabular-nums">${formatCurrencyCompact(totals.losses)}</td>
      <td style="padding:10px;text-align:right;font-variant-numeric:tabular-nums">${combinedMargin === null ? '—' : combinedMargin.toFixed(1) + '%'}</td>
      <td style="padding:10px;text-align:right">—</td>
      <td style="padding:10px">—</td>
    </tr>`);

  tbody.innerHTML = rowsHtml.join('');

  const scopeLabelEl = document.getElementById('leaderboard-scope-label');
  if (scopeLabelEl) {
    const cur = scope.current();
    scopeLabelEl.textContent = `Scope: ${cur.mode === 'all' ? 'All stations' : cur.station?.name || '—'} · last 30 days`;
  }
}

// ---------------------------------------------------------------------
// Trend chart (top metric filled + up to 2 more as lines)
// ---------------------------------------------------------------------

function renderTrendChart(currentRows, registry, days) {
  const svg = document.getElementById('trend-svg');
  const legendEl = document.getElementById('trend-legend');
  if (!svg) return;

  const top = rankedMetrics(currentRows, registry, 3);
  const w = 700, h = 260, pad = { l: 40, r: 10, t: 20, b: 40 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  if (top.length === 0) {
    svg.parentElement.querySelector('.sub').textContent = 'No metrics tracked in this period yet.';
    svg.innerHTML = '';
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const seriesList = top.map((name) => ({ name, color: metricColor(name), values: seriesByDay(currentRows, name, days) }));
  const allValues = seriesList.flatMap((s) => s.values).filter((v) => v !== null);
  const maxVal = Math.max(...allValues, 1);

  let svgContent = `
    <g stroke="#eef0ec" stroke-width="1">
      <line x1="${pad.l}" y1="${pad.t}" x2="${w - pad.r}" y2="${pad.t}"/>
      <line x1="${pad.l}" y1="${pad.t + plotH * 0.33}" x2="${w - pad.r}" y2="${pad.t + plotH * 0.33}"/>
      <line x1="${pad.l}" y1="${pad.t + plotH * 0.66}" x2="${w - pad.r}" y2="${pad.t + plotH * 0.66}"/>
      <line x1="${pad.l}" y1="${pad.t + plotH}" x2="${w - pad.r}" y2="${pad.t + plotH}"/>
    </g>
    <g fill="#8a978f" font-size="10" font-family="Inter">
      <text x="8" y="${pad.t + 4}">${formatCompact(maxVal)}</text>
      <text x="8" y="${pad.t + plotH + 4}">0</text>
    </g>`;

  seriesList.forEach((s, i) => {
    const pts = plotPoints(s.values, days.length, plotW, plotH, pad, maxVal);
    if (i === 0) {
      const base = pad.t + plotH;
      const line = pts.split(' ').map((p, j) => (j === 0 ? 'M' : 'L') + p).join(' ');
      const firstX = pts.split(' ')[0].split(',')[0];
      const lastX = pts.split(' ').slice(-1)[0].split(',')[0];
      svgContent += `<path d="${line} L${lastX},${base} L${firstX},${base} Z" fill="${s.color}" fill-opacity=".12"/>`;
      svgContent += `<polyline fill="none" stroke="${s.color}" stroke-width="2.2" points="${pts}"/>`;
    } else {
      svgContent += `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>`;
    }
  });

  // Annotate the highest day of the primary metric.
  const primary = seriesList[0];
  let peakIdx = -1, peakVal = -Infinity;
  primary.values.forEach((v, i) => { if (v !== null && v > peakVal) { peakVal = v; peakIdx = i; } });
  if (peakIdx >= 0) {
    const x = pad.l + (days.length > 1 ? (plotW / (days.length - 1)) * peakIdx : plotW / 2);
    const y = pad.t + plotH - (peakVal / maxVal) * plotH;
    const label = `${new Date(days[peakIdx] + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${formatCompact(peakVal)}`;
    svgContent += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${primary.color}"/>`;
    svgContent += `<rect x="${Math.max(pad.l, x - 55).toFixed(1)}" y="${Math.max(0, y - 32).toFixed(1)}" width="110" height="24" rx="6" fill="#0f2a1f"/>`;
    svgContent += `<text x="${Math.max(pad.l, x - 55).toFixed(1) - -55}" y="${Math.max(0, y - 32).toFixed(1) - -16}" text-anchor="middle" fill="#b7f04a" font-size="10" font-family="Inter" font-weight="700">${escapeHtml(label)}</text>`;
  }

  svg.innerHTML = svgContent;
  svg.parentElement.querySelector('.sub').textContent = 'Daily values for the last 30 days.';

  if (legendEl) {
    legendEl.innerHTML = seriesList.map((s) => `<span><span class="sw" style="background:${s.color}"></span>${escapeHtml(displayMetricName(s.name))}</span>`).join('');
  }
}

function plotPoints(values, n, plotW, plotH, pad, maxVal) {
  const stepX = n > 1 ? plotW / (n - 1) : 0;
  return values.map((v, i) => {
    const x = pad.l + stepX * i;
    const y = v === null ? pad.t + plotH : pad.t + plotH - (v / maxVal) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

// ---------------------------------------------------------------------
// Stacked weekly composition
// ---------------------------------------------------------------------

function renderStacked(currentRows, registry, days) {
  const svg = document.getElementById('stacked-svg');
  const legendEl = document.getElementById('stacked-legend');
  if (!svg) return;

  const top = rankedMetrics(currentRows, registry, 3);
  if (top.length === 0) {
    svg.innerHTML = '';
    if (legendEl) legendEl.innerHTML = '';
    return;
  }

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const weekTotals = weeks.map((wdays) => {
    const byMetric = {};
    for (const name of top) {
      byMetric[name] = wdays.reduce((sum, d) => sum + (seriesByDayValue(currentRows, name, d) || 0), 0);
    }
    return byMetric;
  });

  const maxStack = Math.max(...weekTotals.map((wt) => top.reduce((a, name) => a + wt[name], 0)), 1);
  const chartH = 190, baseY = 210, colW = 40, gap = 10, startX = 20;

  let svgContent = `<g fill="#8a978f" font-size="10" font-family="Inter" text-anchor="middle">`;
  weeks.forEach((_, i) => {
    svgContent += `<text x="${startX + i * (colW + gap) + colW / 2}" y="230">W${i + 1}</text>`;
  });
  svgContent += `</g>`;

  weekTotals.forEach((wt, i) => {
    let yCursor = baseY;
    const x = startX + i * (colW + gap);
    top.forEach((name) => {
      const val = wt[name];
      const segH = (val / maxStack) * chartH;
      yCursor -= segH;
      svgContent += `<rect x="${x}" y="${yCursor.toFixed(1)}" width="${colW}" height="${segH.toFixed(1)}" fill="${metricColor(name)}" rx="3"/>`;
    });
  });

  svg.innerHTML = svgContent;
  svg.setAttribute('viewBox', `0 0 ${startX * 2 + weeks.length * (colW + gap)} 240`);
  if (legendEl) {
    legendEl.innerHTML = top.map((name) => `<span><span class="sw" style="background:${metricColor(name)}"></span>${escapeHtml(displayMetricName(name))}</span>`).join('');
  }
}

function seriesByDayValue(rows, metricName, date) {
  return rows
    .filter((r) => r.metric_name === metricName && r.value_date === date)
    .reduce((a, r) => a + Number(r.value), 0) || null;
}

// ---------------------------------------------------------------------
// Calendar heatmap (primary metric, weeks x weekdays)
// ---------------------------------------------------------------------

function renderHeatmap(currentRows, days) {
  const heatEl = document.getElementById('heat');
  const titleEl = document.getElementById('heat-title');
  if (!heatEl) return;

  const top = rankedMetrics(currentRows, {}, 1);
  const metricName = top[0];
  if (!metricName) {
    heatEl.innerHTML = '';
    heatEl.parentElement.querySelector('.sub').textContent = 'No data yet.';
    return;
  }
  if (titleEl) titleEl.textContent = displayMetricName(metricName);

  const byDate = {};
  for (const r of currentRows) {
    if (r.metric_name !== metricName) continue;
    byDate[r.value_date] = (byDate[r.value_date] || 0) + Number(r.value);
  }
  const cells = heatCells(byDate, days);

  // Group into weeks starting on the first day of the range.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const weekCount = weeks.length;

  const shades = ['#eef1ec', '#d0e6b8', '#a9d76d', '#7fbf3e', '#4e8f1f', '#1f6f4a'];
  const rowLabels = ['', '', '', '', '', '', ''];

  heatEl.style.gridTemplateColumns = `28px repeat(${weekCount}, 1fr)`;
  heatEl.style.gridTemplateRows = `repeat(7, 1fr)`;
  heatEl.innerHTML = '';

  const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let wd = 0; wd < 7; wd++) {
    const lbl = document.createElement('div');
    lbl.className = 'rowlbl';
    lbl.textContent = weekdayNames[wd];
    heatEl.appendChild(lbl);
    for (let w = 0; w < weekCount; w++) {
      const cell = weeks[w][wd];
      const div = document.createElement('div');
      div.className = 'cell';
      div.title = cell ? `${cell.date}: ${formatNumber(cell.value)}` : '';
      div.style.background = cell ? shades[cell.level] : 'transparent';
      heatEl.appendChild(div);
    }
  }
}

// ---------------------------------------------------------------------
// Correlation scatter
// ---------------------------------------------------------------------

function renderCorrelation(currentRows, days) {
  const svg = document.getElementById('correlation-svg');
  const titleEl = document.getElementById('correlation-title');
  const rEl = document.getElementById('correlation-r');
  if (!svg) return;

  const present = [...new Set(currentRows.map((r) => r.metric_name))];
  // yName is chosen first, then xName is picked from what's left so the
  // two can never collide on the same metric (present[1] could otherwise
  // coincidentally equal whatever yName preferred).
  const yName = present.includes('sales_volume') ? 'sales_volume' : present[0];
  const xCandidates = present.filter((m) => m !== yName);
  const xName = xCandidates.includes('purchases') ? 'purchases' : xCandidates[0];

  if (!xName || !yName || xName === yName) {
    svg.innerHTML = '';
    if (titleEl) titleEl.textContent = 'Not enough distinct metrics yet';
    return;
  }
  if (titleEl) titleEl.textContent = `${displayMetricName(xName)} vs ${displayMetricName(yName)}`;

  const xs = seriesByDay(currentRows, xName, days);
  const ys = seriesByDay(currentRows, yName, days);
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x !== null && y !== null);

  if (pairs.length < 2) {
    svg.innerHTML = '';
    if (rEl) rEl.textContent = '';
    return;
  }

  const w = 400, h = 240, pad = { l: 40, r: 10, t: 20, b: 40 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;
  const maxX = Math.max(...pairs.map((p) => p[0]), 1);
  const maxY = Math.max(...pairs.map((p) => p[1]), 1);

  const toXY = ([x, y]) => [pad.l + (x / maxX) * plotW, pad.t + plotH - (y / maxY) * plotH];

  const r = pearsonR(pairs.map((p) => p[0]), pairs.map((p) => p[1]));

  // Least-squares trendline.
  const n = pairs.length;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  pairs.forEach(([x, y]) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;
  const [x1, y1] = toXY([0, Math.max(0, intercept)]);
  const [x2, y2] = toXY([maxX, intercept + slope * maxX]);

  let svgContent = `
    <g stroke="#eef0ec"><line x1="${pad.l}" y1="${pad.t}" x2="${w - pad.r}" y2="${pad.t}"/><line x1="${pad.l}" y1="${pad.t + plotH}" x2="${w - pad.r}" y2="${pad.t + plotH}"/></g>
    <g fill="#8a978f" font-size="10" font-family="Inter">
      <text x="6" y="${pad.t + 4}">${formatCompact(maxY)}</text>
      <text x="10" y="${pad.t + plotH + 4}">0</text>
      <text x="${w / 2}" y="${h - 8}" text-anchor="middle">${escapeHtml(displayMetricName(xName))} →</text>
    </g>
    <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#0f2a1f" stroke-dasharray="4 4" stroke-width="1.5"/>
    <g fill="#1f6f4a">${pairs.map((p) => { const [x, y] = toXY(p); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"/>`; }).join('')}</g>`;

  svg.innerHTML = svgContent;
  if (rEl) rEl.textContent = r === null ? '' : `r = ${r.toFixed(2)}`;
}

// ---------------------------------------------------------------------
// Period-over-period delta table
// ---------------------------------------------------------------------

function renderDeltaTable(currentRows, previousRows, registry, days) {
  const tbody = document.getElementById('delta-tbody');
  if (!tbody) return;
  const names = [...new Set(currentRows.map((r) => r.metric_name))].slice(0, 6);
  if (names.length === 0) {
    tbody.innerHTML = emptyTableRow(7, 'No metrics tracked yet.');
    return;
  }
  tbody.innerHTML = names.map((name) => {
    const cur = repValue(currentRows, name, registry);
    const prev = repValue(previousRows, name, registry);
    const pct = percentDelta(cur, prev);
    const diff = cur !== null && prev !== null ? cur - prev : null;
    const series = seriesByDay(currentRows, name, days);
    const color = metricColor(name);
    return `
      <tr>
        <td>${escapeHtml(name)}</td>
        <td><span class="pill" style="background:${color}22;color:${color}">${escapeHtml(displayMetricName(name))}</span></td>
        <td class="num">${formatNumber(cur)}</td>
        <td class="num">${formatNumber(prev)}</td>
        <td class="num">${diff === null ? '—' : (diff >= 0 ? '+' : '') + formatNumber(diff)}</td>
        <td class="num">${pct === null ? '—' : `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${formatDelta(pct)}</span>`}</td>
        <td><svg width="70" height="20"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${sparkline(series, 70, 20)}"/></svg></td>
      </tr>`;
  }).join('');
}

// ---------------------------------------------------------------------
// Top / bottom days
// ---------------------------------------------------------------------

function renderTopBottomDays(currentRows, days) {
  const topEl = document.getElementById('top-days-list');
  const botEl = document.getElementById('bottom-days-list');
  if (!topEl || !botEl) return;

  const primary = rankedMetrics(currentRows, {}, 1)[0];
  if (primary) {
    const series = days.map((d) => ({ date: d, value: seriesByDayValue(currentRows, primary, d) })).filter((x) => x.value !== null);
    const top5 = [...series].sort((a, b) => b.value - a.value).slice(0, 5);
    topEl.innerHTML = top5.length
      ? top5.map((x, i) => rankItemHtml(i + 1, x.date, x.value, true)).join('')
      : emptyCardHtml('No data yet.');
    document.getElementById('top-days-heading').textContent = `Top 5 ${displayMetricName(primary)} days`;
  } else {
    topEl.innerHTML = emptyCardHtml('No data yet.');
  }

  const lossSeries = days.map((d) => ({ date: d, value: seriesByDayValue(currentRows, 'losses', d) })).filter((x) => x.value !== null);
  const bottom5 = [...lossSeries].sort((a, b) => a.value - b.value).slice(0, 5);
  botEl.innerHTML = bottom5.length
    ? bottom5.map((x, i) => rankItemHtml(i + 1, x.date, x.value, false)).join('')
    : emptyCardHtml('No losses tracked yet.');
}

function rankItemHtml(rank, date, value, isTop) {
  const label = new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
  return `<div class="item ${isTop ? 'top' : 'bot'}"><div class="rk">${rank}</div><div class="who">${escapeHtml(label)}</div><div class="val">${formatCurrencyCompact(value)}</div></div>`;
}

// ---------------------------------------------------------------------
// Raw daily data table
// ---------------------------------------------------------------------

function renderRawTable(currentRows, days) {
  const tbody = document.getElementById('raw-tbody');
  if (!tbody) return;
  const cols = ['sales_volume', 'revenue', 'purchases', 'losses', 'inventory_on_hand'];
  const reversedDays = [...days].reverse();
  const hasAny = currentRows.length > 0;
  if (!hasAny) {
    tbody.innerHTML = emptyTableRow(7, 'No data yet.');
    return;
  }
  tbody.innerHTML = reversedDays.map((d) => {
    const weekday = new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const cells = cols.map((c) => {
      const v = seriesByDayValue(currentRows, c, d);
      return `<td class="num">${v === null ? '—' : (c === 'revenue' ? formatCurrencyCompact(v) : formatNumber(v))}</td>`;
    }).join('');
    return `<tr><td>${d}</td><td>${weekday}</td>${cells}</tr>`;
  }).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
