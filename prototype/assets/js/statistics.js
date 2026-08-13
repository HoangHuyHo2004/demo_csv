// Controller for statistics.html.
//
// One query per page: a single metric_daily load covering the selected month
// plus the day before it (needed for the day-mode comparison at a month
// boundary). Every widget derives from that one dataset, which is what
// guarantees the KPIs, charts and table can never disagree with each other.
//
// The metric-name contract this page reads (produced by
// tools/convert_journal.py -- see docs/statistics-dashboard-spec.md):
//
//   sl_<fuel>_tru<n>   volume sold on pump n of <fuel>
//   tt_<fuel>_tru<n>   amount for the same pump
//   sl_<item>          quantity of a non-pump item (lubricants)
//   tt_<item>          amount for the same item
//   ca_<shift>         1 on days that shift worked, else 0
//   gia_<fuel>         unit price -- RECORDED BUT NOT READ HERE, see below
//
// Nothing is hardcoded: pumps, fuels, items and shifts are all discovered
// from the metric names present, so a station with different pumps still
// renders, and unrecognised metric names (older test data, junk columns from a
// bad upload) are ignored rather than breaking the page.
//
// WHY gia_* IS IGNORED: metric_daily returns one row per station, so summing
// across stations would add two stations' prices together and double them. The
// price shown is always derived as amount / volume, which is correct for one
// station, correct across many, and additionally gives the volume-weighted
// blended price on days when the pump price changed mid-day.
import { requireSession } from './auth.js';
import * as scope from './scope.js';
import { loadMetricDaily, latestMetricDate } from './data.js';
import { formatNumber, formatMoneyCompact, weekdayLabel, formatDateDMY } from './fmt.js';
import { t, onChange as onLanguageChange } from './i18n.js';

const RE_PUMP  = /^(sl|tt)_([a-z0-9]+)_tru(\d+)$/;
const RE_PRICE = /^gia_([a-z0-9]+)$/;
const RE_SHIFT = /^ca_([a-z0-9_]+)$/;
const RE_ITEM  = /^(sl|tt)_([a-z0-9_]+)$/;

// Fixed hue per fuel, so a filter that changes the series count never repaints
// the survivors. Unknown fuels take the remaining validated slots in name
// order -- by entity, never by rank.
const KNOWN_HUE = { a95: '--s1', e5: '--s3', do: '--s2' };
const SLOTS = ['--s1', '--s2', '--s3', '--s4'];

// The validated hues (see .viz block in statistics.html) were picked for
// distinguishability against each other and against white/dark chrome, not
// for a fixed white label sitting inside the mark -- s2 (orange) and s3
// (aqua) are both too light for that, e.g. white-on-s3 is ~2.9:1, well
// under the 4.5:1 text minimum. Pick per-swatch instead of hardcoding.
const SLOT_HEX = { '--s1': '#2a78d6', '--s2': '#eb6834', '--s3': '#1baf7a', '--s4': '#eda100' };
function inMarkTextColor(cssVarColor) {
  const hex = SLOT_HEX[cssVarColor.replace(/^var\(|\)$/g, '')];
  if (!hex) return '#fff';
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  const luminance = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  return contrastWithWhite >= 4.5 ? '#fff' : '#12160f';
}

let MODE = 'month';
let MONTH = null;          // 'YYYY-MM'
let SEL = null;            // 'YYYY-MM-DD' (day mode)
let M = null;              // current model
let isOwner = false;

const el = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
const nf = (n, d = 0) => formatNumber(n, { decimals: d });
const iso = (d) => d.toISOString().slice(0, 10);
const prevISO = (s) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return iso(d); };
const dowOf = (s) => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;   // 0 = Monday

init();

async function init() {
  const result = await requireSession();
  if (!result) return;
  isOwner = result.profile?.role === 'owner';
  await scope.init(result.session.user.id, { isOwner });

  const latest = await latestMetricDate({ stationIds: scopeIds() });
  MONTH = (latest || iso(new Date())).slice(0, 7);
  el('mpick').value = MONTH;

  wire();
  await reload();

  // A scope change alters which stations the query may return, so it reloads
  // rather than just re-rendering.
  scope.onChange(() => reload());
  onLanguageChange(() => render());
}

function scopeIds() {
  const c = scope.current();
  return c.mode === 'station' && c.stationId ? [c.stationId] : undefined;
}
function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const before = new Date(start); before.setUTCDate(0);
  return { before: iso(before), start: iso(start), end: iso(end) };
}

async function reload() {
  const { before, start, end } = monthRange(MONTH);
  const rows = await loadMetricDaily({ stationIds: scopeIds(), from: before, to: end });
  M = buildModel(rows, start, end);
  if (!SEL || !M.byDate[SEL]) SEL = M.days.length ? M.days[M.days.length - 1].date : end;
  render();
}

// ---------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------
function buildModel(rows, start, end) {
  const pumps = new Map(), items = new Map(), fuelSet = new Set(), shiftSet = new Set();
  const byDate = {};

  const dayOf = (date) => (byDate[date] ||= {
    date, dow: dowOf(date), stations: new Set(), shifts: new Set(),
    pumps: {}, items: {},
  });

  for (const r of rows) {
    const name = r.metric_name;
    const v = Number(r.value) || 0;
    let m;

    if ((m = RE_PUMP.exec(name))) {
      const key = `${m[2]}_${m[3]}`;
      pumps.set(key, { key, fuel: m[2], pump: Number(m[3]) });
      fuelSet.add(m[2]);
      const d = dayOf(r.value_date); d.stations.add(r.station_id);
      const slot = (d.pumps[key] ||= { vol: 0, amt: 0 });
      slot[m[1] === 'sl' ? 'vol' : 'amt'] += v;
      continue;
    }
    if ((m = RE_PRICE.exec(name))) { fuelSet.add(m[1]); continue; }   // see header note
    if ((m = RE_SHIFT.exec(name))) {
      shiftSet.add(m[1]);
      if (v >= 1) { const d = dayOf(r.value_date); d.stations.add(r.station_id); d.shifts.add(m[1]); }
      continue;
    }
    if ((m = RE_ITEM.exec(name))) {
      items.set(m[2], { key: m[2], name: m[2].replace(/_/g, ' ').toUpperCase() });
      const d = dayOf(r.value_date); d.stations.add(r.station_id);
      const slot = (d.items[m[2]] ||= { qty: 0, amt: 0 });
      slot[m[1] === 'sl' ? 'qty' : 'amt'] += v;
      continue;
    }
    // Anything else is not part of this contract and is deliberately ignored.
  }

  const fuels = [...fuelSet].sort().sort((a, b) => (KNOWN_HUE[b] ? 1 : 0) - (KNOWN_HUE[a] ? 1 : 0));
  const fuelMeta = fuels.map((f, i) => ({
    key: f, name: f.toUpperCase(),
    color: `var(${KNOWN_HUE[f] || SLOTS[i % SLOTS.length]})`,
  }));
  const pumpList = [...pumps.values()].sort((a, b) => a.fuel < b.fuel ? -1 : a.fuel > b.fuel ? 1 : a.pump - b.pump);
  const itemList = [...items.values()].sort((a, b) => a.name < b.name ? -1 : 1);

  // Derive per-day aggregates once, so no widget recomputes them differently.
  for (const d of Object.values(byDate)) {
    d.fuel = {};
    for (const f of fuels) {
      const ps = pumpList.filter((p) => p.fuel === f);
      d.fuel[f] = {
        vol: ps.reduce((s, p) => s + (d.pumps[p.key]?.vol || 0), 0),
        amt: ps.reduce((s, p) => s + (d.pumps[p.key]?.amt || 0), 0),
      };
    }
    d.volume = fuels.reduce((s, f) => s + d.fuel[f].vol, 0);
    d.itemsAmt = itemList.reduce((s, it) => s + (d.items[it.key]?.amt || 0), 0);
    d.amount = fuels.reduce((s, f) => s + d.fuel[f].amt, 0) + d.itemsAmt;
    d.price = Object.fromEntries(fuels.map((f) => [f, d.fuel[f].vol ? d.fuel[f].amt / d.fuel[f].vol : null]));
    d.stationCount = d.stations.size;
  }

  const days = Object.values(byDate)
    .filter((d) => d.date >= start && d.date <= end)
    .sort((a, b) => a.date < b.date ? -1 : 1);

  return { byDate, days, fuels, fuelMeta, pumpList, itemList, shifts: [...shiftSet].sort(), start, end };
}

function totalsOf(days) {
  const fuel = Object.fromEntries(M.fuels.map((f) => [f, {
    vol: days.reduce((s, d) => s + d.fuel[f].vol, 0),
    amt: days.reduce((s, d) => s + d.fuel[f].amt, 0),
  }]));
  const amount = days.reduce((s, d) => s + d.amount, 0);
  const volume = days.reduce((s, d) => s + d.volume, 0);
  return {
    amount, volume, days: days.length, fuel,
    itemsAmt: days.reduce((s, d) => s + d.itemsAmt, 0),
    avgPrice: volume ? M.fuels.reduce((s, f) => s + fuel[f].amt, 0) / volume : null,
    avgPerDay: days.length ? amount / days.length : 0,
    pumps: M.pumpList.map((p) => ({ ...p,
      vol: days.reduce((s, d) => s + (d.pumps[p.key]?.vol || 0), 0),
      amt: days.reduce((s, d) => s + (d.pumps[p.key]?.amt || 0), 0) })),
    items: M.itemList.map((it) => ({ ...it,
      qty: days.reduce((s, d) => s + (d.items[it.key]?.qty || 0), 0),
      amt: days.reduce((s, d) => s + (d.items[it.key]?.amt || 0), 0) })),
  };
}

// ---------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------
function mk(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }
function barPath(x, y, w, h, r = 4, dir = 'up') {   // 4px rounded data-end, square baseline
  r = Math.min(r, w / 2, h);
  if (h <= 0 || w <= 0) return '';
  if (dir === 'up') return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}
function hover(node, html) {
  const tip = el('tip');
  node.addEventListener('mousemove', (e) => {
    tip.innerHTML = html; tip.style.opacity = 1;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX + 14, innerWidth - r.width - 10) + 'px';
    tip.style.top = Math.max(e.clientY - r.height - 12, 8) + 'px';
  });
  node.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
}
function niceMax(v, steps = 4) {
  if (!(v > 0)) return steps;
  const raw = v / steps, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return Math.ceil(raw / mag) * mag * steps;
}
function yAxis(svg, x0, x1, yTop, yBot, max, fmt, steps = 4) {
  for (let i = 0; i <= steps; i++) {
    const v = (max / steps) * i, y = yBot - (yBot - yTop) * (i / steps);
    mk('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    mk('text', { x: x0 - 8, y: y + 3.5, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmt(v);
  }
}
const money = (n) => formatMoneyCompact(n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const deltaHtml = (cur, prev) => {
  if (cur == null || prev == null || !prev) return `<span class="delta">${t('stats.noPrevDay')}</span>`;
  const p = ((cur - prev) / Math.abs(prev)) * 100;
  return `<span class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲ +' : '▼ '}${Math.abs(p).toFixed(1)}% ${t('stats.vsPrevDay')}</span>`;
};
const scopeName = () => {
  const c = scope.current();
  return c.mode === 'station' && c.station ? c.station.name : t('shell.scopeAllStations');
};
const nStations = () => scope.current().mode === 'station' ? 1 : Math.max(scope.stations().length, 1);
const isAll = () => scope.current().mode !== 'station';

// ---------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------
function kpisMonth(T) {
  el('kpis').innerHTML = [
    { lbl: t('stats.kpi.revenue'), val: money(T.amount), unit: '₫',
      sub: `${nf(T.amount)} ₫ · ${t('stats.kpi.inclItems', { n: nf(T.itemsAmt) })}` },
    { lbl: t('stats.kpi.volume'), val: nf(T.volume), unit: 'L', sub: t('stats.kpi.volumeSub') },
    { lbl: t('stats.kpi.avgPrice'), val: T.avgPrice ? nf(T.avgPrice) : '—', unit: '₫/L',
      sub: t('stats.kpi.avgPriceSub') + (isAll() ? ' ' + t('stats.kpi.acrossStations') : '') },
    { lbl: t('stats.kpi.perDay'), val: money(T.avgPerDay), unit: '₫', sub: t('stats.kpi.daysWithData', { n: T.days }) },
  ].map((r) => `<div class="kpi"><div class="lbl">${esc(r.lbl)}</div>
      <div class="val">${esc(r.val)}<span class="unit">${r.unit}</span></div>
      <div class="sub">${esc(r.sub)}</div></div>`).join('');
}
function kpisDay(cur, prev) {
  const slots = M.pumpList.length;
  const active = cur ? M.pumpList.filter((p) => (cur.pumps[p.key]?.vol || 0) > 0).length : 0;
  const avg = cur && cur.volume ? cur.amount / cur.volume : null;
  const pAvg = prev && prev.volume ? prev.amount / prev.volume : null;
  const shiftTxt = cur && cur.shifts.size ? [...cur.shifts].map((s) => s.toUpperCase()).join(', ') : '—';
  el('kpis').innerHTML = (cur ? [
    { lbl: t('stats.kpi.revenue'), val: money(cur.amount), unit: '₫', d: deltaHtml(cur.amount, prev?.amount), sub: `${nf(cur.amount)} ₫` },
    { lbl: t('stats.kpi.volume'), val: nf(cur.volume), unit: 'L', d: deltaHtml(cur.volume, prev?.volume),
      sub: isAll() ? t('stats.kpi.stationsReported', { n: cur.stationCount, total: nStations() }) : t('stats.kpi.shift', { s: shiftTxt }) },
    { lbl: t('stats.kpi.avgPrice'), val: avg ? nf(avg) : '—', unit: '₫/L', d: deltaHtml(avg, pAvg), sub: t('stats.kpi.avgPriceSub') },
    { lbl: t('stats.kpi.activePumps'), val: `${active}/${slots}`, unit: '',
      d: `<span class="delta">${t('stats.kpi.idlePumps', { n: slots - active })}</span>`,
      sub: isAll() ? t('stats.kpi.pumpSlotsAll') : t('stats.kpi.pumpSlotsOne') },
  ] : []).map((r) => `<div class="kpi"><div class="lbl">${esc(r.lbl)}</div>
      <div class="val">${esc(r.val)}<span class="unit">${r.unit}</span></div>
      ${r.d}<div class="sub">${esc(r.sub)}</div></div>`).join('');
}

function chartDailyRevenue(days) {
  const svg = el('c-daily'); clear(svg);
  const W = 860, H = 210, pad = { l: 56, r: 14, t: 10, b: 26 };
  const n = days.length, max = niceMax(Math.max(...days.map((x) => x.amount)));
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b, band = plotW / n, bw = Math.min(24, band - 2);
  yAxis(svg, pad.l, W - pad.r, pad.t, pad.t + plotH, max, money);
  const hi = Math.max(...days.map((x) => x.amount)), lo = Math.min(...days.map((x) => x.amount));
  days.forEach((x, i) => {
    const h = (x.amount / max) * plotH, xx = pad.l + band * i + (band - bw) / 2, y = pad.t + plotH - h;
    mk('path', { d: barPath(xx, y, bw, h), fill: 'var(--s1)' }, svg);
    if (x.amount === hi || x.amount === lo)
      // Halo behind the label -- it sits right at bar-top height, which for
      // a short bar is often level with a y-axis gridline running the full
      // chart width; without this the gridline showed straight through the
      // text's letter-gaps like a strikethrough.
      mk('text', { x: xx + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'dlabel', stroke: 'var(--panel)', 'stroke-width': 3, 'paint-order': 'stroke' }, svg).textContent = money(x.amount);
    hover(mk('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: 'hit' }, svg),
      `<b>${formatDateDMY(x.date)}</b> · ${weekdayLabel(x.date)}<br>${t('stats.kpi.revenue')} <b>${nf(x.amount)} ₫</b><br>${t('stats.kpi.volume')} ${nf(x.volume)} L`);
    if (i % 3 === 0 || i === n - 1)
      mk('text', { x: pad.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = x.date.slice(-2);
  });
  mk('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + plotH, y2: pad.t + plotH, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
  el('cap-daily').textContent = t('stats.daily.cap', {
    scope: scopeName(),
    hiDate: formatDateDMY(days.find((x) => x.amount === hi).date), hi: nf(hi),
    loDate: formatDateDMY(days.find((x) => x.amount === lo).date), lo: nf(lo),
  });
}
function chartDailyVolume(days) {
  const svg = el('c-vol'); clear(svg);
  const W = 860, H = 130, pad = { l: 56, r: 14, t: 10, b: 24 };
  const n = days.length, max = niceMax(Math.max(...days.map((x) => x.volume)));
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b, band = plotW / n;
  yAxis(svg, pad.l, W - pad.r, pad.t, pad.t + plotH, max, (v) => nf(v), 3);
  const pts = days.map((x, i) => [pad.l + band * i + band / 2, pad.t + plotH - (x.volume / max) * plotH]);
  mk('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  days.forEach((x, i) => {
    hover(mk('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: 'hit' }, svg),
      `<b>${formatDateDMY(x.date)}</b><br>${t('stats.kpi.volume')} <b>${nf(x.volume)} L</b>`);
    if (i % 3 === 0 || i === n - 1)
      mk('text', { x: pad.l + band * i + band / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = x.date.slice(-2);
  });
  const last = pts[pts.length - 1];
  mk('circle', { cx: last[0], cy: last[1], r: 4.5, fill: 'var(--s1)', stroke: '#fff', 'stroke-width': 2 }, svg);
  mk('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + plotH, y2: pad.t + plotH, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
}
function chartPrice(days) {
  const svg = el('c-price'); clear(svg);
  const W = 520, H = 230, pad = { l: 52, r: 44, t: 12, b: 26 };
  const n = days.length;
  const all = days.flatMap((x) => M.fuels.map((k) => x.price[k]).filter((v) => v != null));
  if (!all.length) { el('cap-price').textContent = t('stats.price.none'); el('lg-price').innerHTML = ''; return; }
  const lo = Math.floor(Math.min(...all) / 500) * 500 - 500, hi = Math.ceil(Math.max(...all) / 500) * 500;
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b, band = plotW / n;
  const step = Math.max(500, Math.round((hi - lo) / 4 / 500) * 500);
  for (let v = lo; v <= hi; v += step) {
    const y = pad.t + plotH - ((v - lo) / (hi - lo)) * plotH;
    mk('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    mk('text', { x: pad.l - 8, y: y + 3.5, 'text-anchor': 'end', class: 'tick' }, svg).textContent = nf(v / 1000, 1) + 'K';
  }
  el('lg-price').innerHTML = M.fuelMeta.map((f) => `<span><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join('');
  M.fuelMeta.forEach((f) => {
    const seg = [];
    days.forEach((x, i) => {
      if (x.price[f.key] == null) return;
      const y = pad.t + plotH - ((x.price[f.key] - lo) / (hi - lo)) * plotH;
      seg.push([pad.l + band * i, y], [pad.l + band * i + band, y]);   // step: hold, then jump
    });
    if (!seg.length) return;
    mk('polyline', { points: seg.map((p) => p.join(',')).join(' '), fill: 'none', stroke: f.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    const end = seg[seg.length - 1];
    mk('circle', { cx: end[0], cy: end[1], r: 4, fill: f.color, stroke: '#fff', 'stroke-width': 2 }, svg);
    mk('text', { x: end[0] + 8, y: end[1] + 3.5, class: 'dlabel' }, svg).textContent = f.name;
  });
  days.forEach((x, i) => {
    hover(mk('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: 'hit' }, svg),
      `<b>${formatDateDMY(x.date)}</b><br>` + M.fuelMeta.map((f) => `${f.name} <b>${x.price[f.key] == null ? '—' : nf(x.price[f.key]) + ' ₫'}</b>`).join('<br>'));
    if (i % 5 === 0 || i === n - 1)
      mk('text', { x: pad.l + band * i + band / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = x.date.slice(-2);
  });
  mk('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + plotH, y2: pad.t + plotH, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
  el('cap-price').textContent = t('stats.price.cap') + (isAll() ? ' ' + t('stats.price.capAll') : '');
}
function chartDow(days) {
  const svg = el('c-dow'); clear(svg);
  const W = 380, H = 230, pad = { l: 50, r: 10, t: 10, b: 28 };
  const buckets = Array.from({ length: 7 }, () => []);
  days.forEach((d) => buckets[d.dow].push(d.amount));
  const v = buckets.map((b) => b.length ? b.reduce((s, x) => s + x, 0) / b.length : 0);
  const max = niceMax(Math.max(...v));
  const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b, band = plotW / 7, bw = Math.min(24, band - 8);
  yAxis(svg, pad.l, W - pad.r, pad.t, pad.t + plotH, max, money);
  const nz = v.filter((x) => x > 0);
  const hi = Math.max(...v), lo = nz.length ? Math.min(...nz) : 0;
  const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  v.forEach((val, i) => {
    const h = (val / max) * plotH, x = pad.l + band * i + (band - bw) / 2, y = pad.t + plotH - h;
    mk('path', { d: barPath(x, y, bw, h), fill: 'var(--s1)' }, svg);
    if (val && (val === hi || val === lo))
      // Same halo as chartDailyRevenue's peak/low labels -- this sits at
      // bar-top height too, which for a short bar often lands on one of
      // yAxis()'s full-width gridlines.
      mk('text', { x: x + bw / 2, y: y - 6, 'text-anchor': 'middle', class: 'dlabel', stroke: 'var(--panel)', 'stroke-width': 3, 'paint-order': 'stroke' }, svg).textContent = money(val);
    hover(mk('rect', { x: pad.l + band * i, y: pad.t, width: band, height: plotH, class: 'hit' }, svg),
      `<b>${t('statistics.weekday.' + WD[i])}</b><br>${nf(val)} ₫<br>${t('stats.dow.nDays', { n: buckets[i].length })}`);
    mk('text', { x: pad.l + band * i + band / 2, y: H - 9, 'text-anchor': 'middle', class: 'tick' }, svg)
      .textContent = t('statistics.weekday.' + WD[i]);
  });
  mk('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + plotH, y2: pad.t + plotH, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
  el('cap-dow').textContent = lo
    ? t('stats.dow.cap', { pct: (((hi - lo) / lo) * 100).toFixed(0) })
    : t('stats.dow.capThin');
}
function chartMix(fuel, caption) {
  const svg = el('c-mix'); clear(svg);
  const W = 380, gap = 2, y = 14, h = 30;
  const order = [...M.fuelMeta].sort((a, b) => fuel[b.key].amt - fuel[a.key].amt);
  const tot = M.fuels.reduce((s, f) => s + fuel[f].amt, 0);
  el('lg-mix').innerHTML = M.fuelMeta.map((f) => `<span><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join('');
  el('cap-mix').textContent = caption;
  if (!tot) { el('t-mix').innerHTML = ''; return; }
  let x = 0;
  order.forEach((f, i) => {
    const w = (fuel[f.key].amt / tot) * W - (i < order.length - 1 ? gap : 0);   // 2px surface gap
    if (w <= 0) return;
    hover(mk('path', { d: barPath(x, y, w, h, 4, 'right'), fill: f.color }, svg),
      `<b>${f.name}</b><br>${nf(fuel[f.key].amt)} ₫<br>${nf(fuel[f.key].vol)} L`);
    if (w > 46)   // only label inside the mark when it fits
      mk('text', { x: x + w / 2, y: y + h / 2 + 4, 'text-anchor': 'middle', class: 'dlabel', fill: inMarkTextColor(f.color) }, svg)
        .textContent = `${f.name} ${((fuel[f.key].amt / tot) * 100).toFixed(1)}%`;
    x += w + gap;
  });
  el('t-mix').innerHTML = `<thead><tr><th>${t('stats.mix.colType')}</th>`
    + `<th style="text-align:right">${t('stats.col.litres')}</th>`
    + `<th style="text-align:right">${t('stats.col.amount')}</th>`
    + `<th style="text-align:right">₫/L</th></tr></thead><tbody>`
    + order.map((f) => `<tr><td><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</td>`
      + `<td class="n">${nf(fuel[f.key].vol)}</td><td class="n">${nf(fuel[f.key].amt)}</td>`
      + `<td class="n">${fuel[f.key].vol ? nf(fuel[f.key].amt / fuel[f.key].vol) : '—'}</td></tr>`).join('') + '</tbody>';
}
/** One station -> per-pump bars. Many stations -> per-fuel bars: every station
    has its own "trụ 2", and merging two physically different pumps into one bar
    would state something untrue. */
function chartPumps(pumps, fuel, caption) {
  const svg = el('c-pump'); clear(svg);
  const W = 520, pad = { l: 96, r: 96, t: 6 }, rowH = 28, bh = 16;
  const byFuel = isAll();
  const rows = byFuel
    ? M.fuelMeta.map((f) => ({ label: f.name, color: f.color, vol: fuel[f.key].vol, amt: fuel[f.key].amt }))
    : pumps.map((p) => ({
        label: t('stats.pump.label', { fuel: p.fuel.toUpperCase(), n: p.pump }),
        color: (M.fuelMeta.find((f) => f.key === p.fuel) || {}).color || 'var(--s1)',
        vol: p.vol, amt: p.amt }));
  rows.sort((a, b) => b.vol - a.vol);
  const max = Math.max(...rows.map((r) => r.vol)) || 1, plotW = W - pad.l - pad.r;
  svg.setAttribute('viewBox', `0 0 ${W} ${pad.t + rows.length * rowH + 8}`);
  el('h-pump').textContent = byFuel ? t('stats.pump.titleByFuel') : t('stats.pump.title');
  el('lg-pump').innerHTML = M.fuelMeta.map((f) => `<span><i style="background:${f.color}"></i>${esc(f.name)}</span>`).join('');
  rows.forEach((r, i) => {
    const y = pad.t + i * rowH, w = (r.vol / max) * plotW;
    mk('text', { x: pad.l - 10, y: y + bh / 2 + 4, 'text-anchor': 'end', class: 'dlabel' }, svg).textContent = r.label;
    // Baseline only spans the bar itself, not the full row -- it used to run
    // the full plot width regardless of bar length, which drew a line right
    // through the value label sitting just past a short bar (looked like the
    // number was struck through).
    mk('line', { x1: pad.l, x2: pad.l + w, y1: y + bh / 2, y2: y + bh / 2, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
    if (r.vol > 0) {
      hover(mk('path', { d: barPath(pad.l, y, w, bh, 4, 'right'), fill: r.color }, svg),
        `<b>${r.label}</b><br>${nf(r.vol)} L<br>${nf(r.amt)} ₫`);
      mk('text', { x: pad.l + w + 8, y: y + bh / 2 + 4, class: 'dlabel' }, svg).textContent = nf(r.vol) + ' L';
    } else {
      mk('text', { x: pad.l + 4, y: y + bh / 2 + 4, class: 'flag' }, svg).textContent = t('stats.pump.idle');
    }
  });
  el('cap-pump').textContent = caption;
}
function chartItems(items, caption) {
  const card = el('card-oil');
  if (!items.length) { card.classList.add('hide'); return; }
  card.classList.remove('hide');
  const svg = el('c-oil'); clear(svg);
  const W = 520, pad = { l: 116, r: 92, t: 6 }, rowH = 27, bh = 15;
  const rows = [...items].sort((a, b) => b.amt - a.amt);
  const max = Math.max(...rows.map((r) => r.amt)) || 1, plotW = W - pad.l - pad.r;
  svg.setAttribute('viewBox', `0 0 ${W} ${pad.t + rows.length * rowH + 6}`);
  rows.forEach((r, i) => {
    const y = pad.t + i * rowH, w = r.amt ? Math.max((r.amt / max) * plotW, 1) : 0;
    mk('text', { x: pad.l - 10, y: y + bh / 2 + 4, 'text-anchor': 'end', class: 'dlabel' }, svg).textContent = r.name;
    if (w) {
      hover(mk('path', { d: barPath(pad.l, y, w, bh, 4, 'right'), fill: 'var(--s1)' }, svg),
        `<b>${esc(r.name)}</b><br>${nf(r.amt)} ₫<br>${nf(r.qty, 3)}`);
      mk('text', { x: pad.l + w + 8, y: y + bh / 2 + 4, class: 'dlabel' }, svg).textContent = nf(r.amt) + ' ₫';
    } else {
      mk('text', { x: pad.l + 4, y: y + bh / 2 + 4, class: 'tick' }, svg).textContent = t('stats.oil.none');
    }
  });
  el('cap-oil').textContent = caption;
  el('t-oil').innerHTML = `<thead><tr><th>${t('stats.oil.colItem')}</th>`
    + `<th style="text-align:right">${t('stats.oil.colQty')}</th>`
    + `<th style="text-align:right">${t('stats.oil.colUnit')}</th>`
    + `<th style="text-align:right">${t('stats.col.amount')}</th></tr></thead><tbody>`
    + rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${r.qty ? nf(r.qty, r.qty % 1 ? 3 : 0) : '—'}</td>`
      + `<td class="n">${r.qty ? nf(r.amt / r.qty) : '—'}</td><td class="n">${r.amt ? nf(r.amt) : '—'}</td></tr>`).join('') + '</tbody>';
}

// ---------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------
function tableHead() {
  // In all-stations mode a shift column is meaningless -- each station runs its
  // own -- so it reports how many stations reported, which also surfaces a
  // station that has not uploaded.
  const col2 = isAll() ? t('stats.col.stations') : t('stats.col.shift');
  return `<thead><tr><th>${t('stats.col.date')}</th><th>${t('statistics.raw.colWeekday')}</th><th>${col2}</th>`
    + M.fuelMeta.map((f) => `<th style="text-align:right">${esc(f.name)} (L)</th>`).join('')
    + `<th style="text-align:right">${t('stats.col.totalLitres')}</th>`
    + `<th style="text-align:right">${t('stats.col.amount')}</th></tr></thead>`;
}
function rowHtml(x, cls = '') {
  const n = nStations();
  const col2 = isAll()
    ? `<span${x.stationCount < n ? ' style="color:var(--down);font-weight:700"' : ''}>${x.stationCount}/${n}</span>`
    : (x.shifts.size ? [...x.shifts].map((s) => s.toUpperCase()).join(', ') : '—');
  return `<tr class="${cls}"><td>${formatDateDMY(x.date)}</td><td>${weekdayLabel(x.date)}</td><td>${col2}</td>`
    + M.fuelMeta.map((f) => `<td class="n">${nf(x.fuel[f.key].vol)}</td>`).join('')
    + `<td class="n">${nf(x.volume)}</td><td class="n">${nf(x.amount)}</td></tr>`;
}
const missingRow = (date, cols) =>
  `<tr class="missing"><td>${formatDateDMY(date)}</td><td colspan="${cols}">${t('stats.table.noDataForDay')}</td></tr>`;

function tableMonth(days) {
  el('t-daily-h').textContent = t('stats.table.title');
  el('cap-table').textContent = t('stats.table.cap', { scope: scopeName() });
  el('t-daily-wrap').classList.add('scroll');
  el('t-daily').innerHTML = tableHead() + '<tbody>' + days.map((x) => rowHtml(x)).join('') + '</tbody>';
}
function tableDay(sel) {
  const pIso = prevISO(sel), p = M.byDate[pIso], c = M.byDate[sel];
  el('t-daily-h').textContent = t('stats.table.titleDay');
  el('cap-table').textContent = t('stats.table.capDay', { scope: scopeName(), prev: formatDateDMY(pIso), sel: formatDateDMY(sel) });
  el('t-daily-wrap').classList.remove('scroll');
  const cols = M.fuelMeta.length + 4;
  el('t-daily').innerHTML = tableHead() + '<tbody>'
    + (p ? rowHtml(p) : missingRow(pIso, cols)) + (c ? rowHtml(c, 'focus') : missingRow(sel, cols)) + '</tbody>';
}
function tablePriceDay(cur, prev) {
  el('cap-priceday').textContent = t('stats.priceDay.cap') + (isAll() ? ' ' + t('stats.priceDay.capAll') : '');
  el('t-price-day').innerHTML = `<thead><tr><th>${t('stats.mix.colType')}</th>`
    + `<th style="text-align:right">${t('stats.priceDay.colPrice')}</th>`
    + `<th style="text-align:right">${t('stats.priceDay.colPrev')}</th>`
    + `<th style="text-align:right">${t('stats.priceDay.colChange')}</th></tr></thead><tbody>`
    + M.fuelMeta.map((f) => {
      const c = cur?.price[f.key], p = prev?.price[f.key];
      const chg = (c != null && p) ? ((c - p) / p) * 100 : null;
      const st = chg == null ? '' : ` style="color:var(${chg >= 0 ? '--up' : '--down'});font-weight:700"`;
      return `<tr><td><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</td>`
        + `<td class="n">${c == null ? '—' : nf(c)}</td><td class="n">${p == null ? '—' : nf(p)}</td>`
        + `<td class="n"${st}>${chg == null ? '—' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}</td></tr>`;
    }).join('') + '</tbody>';
}
function tableShift(days) {
  const agg = new Map();
  days.forEach((d) => d.shifts.forEach((s) => {
    const v = agg.get(s) || { days: 0, amount: 0 };
    v.days++; v.amount += d.amount; agg.set(s, v);
  }));
  el('card-shift').classList.toggle('hide', agg.size === 0 || isAll());
  el('t-shift').innerHTML = `<thead><tr><th>${t('stats.col.shift')}</th>`
    + `<th style="text-align:right">${t('stats.shift.colDays')}</th>`
    + `<th style="text-align:right">${t('stats.col.amount')}</th>`
    + `<th style="text-align:right">${t('stats.shift.colPerDay')}</th></tr></thead><tbody>`
    + [...agg.entries()].sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, v]) => `<tr><td>${esc(name.toUpperCase())}</td><td class="n">${v.days}</td>`
        + `<td class="n">${nf(v.amount)}</td><td class="n">${nf(v.amount / v.days)}</td></tr>`).join('') + '</tbody>';
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return t('stats.exportedAt', { date: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` });
}
function monthLabel() { const [y, m] = MONTH.split('-'); return `${m}/${y}`; }

function render() {
  if (!M) return;
  const noData = M.days.length === 0 || M.pumpList.length === 0;

  document.querySelectorAll('[data-scope]').forEach((c) => {
    const okMode = c.dataset.scope === 'both' || c.dataset.scope === MODE;
    const okSt = !c.dataset.stations
      || (c.dataset.stations === 'single' && !isAll())
      || (c.dataset.stations === 'all' && isAll());
    c.classList.toggle('hide', noData || !(okMode && okSt));
  });
  el('kpis').classList.toggle('hide', noData);
  el('dpick').hidden = MODE !== 'day';
  el('dpick').min = M.start; el('dpick').max = M.end; el('dpick').value = SEL;
  el('seg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === MODE));

  if (noData) {
    el('warn').classList.add('on');
    el('warn-tx').innerHTML = `<b>${t('stats.empty.title')}</b> `
      + t('stats.empty.body', { month: monthLabel(), scope: scopeName() });
    el('page-sub').textContent = '';
    el('ph-title').textContent = `Demo_CSV — ${t('shell.nav.statistics')} ${monthLabel()}`;
    el('ph-meta').textContent = `${scopeName()} · ${stamp()} · ${t('stats.empty.title')}`;
    return;
  }

  const T = totalsOf(M.days);

  if (MODE === 'month') {
    el('warn').classList.remove('on');
    el('page-sub').textContent = t('stats.sub.month', { scope: scopeName(), month: monthLabel() });
    kpisMonth(T);
    chartDailyRevenue(M.days); chartDailyVolume(M.days); chartPrice(M.days); chartDow(M.days);
    chartMix(T.fuel, t('stats.mix.capMonth', { scope: scopeName(), total: nf(M.fuels.reduce((s, f) => s + T.fuel[f].amt, 0)), items: nf(T.itemsAmt) }));
    chartPumps(T.pumps, T.fuel, isAll()
      ? t('stats.pump.capAll', { n: nStations() })
      : t('stats.pump.capMonth'));
    chartItems(T.items, t('stats.oil.cap', { scope: scopeName(), total: nf(T.itemsAmt) }));
    tableShift(M.days); tableMonth(M.days);
    el('ph-title').textContent = `Demo_CSV — ${t('shell.nav.statistics')} ${monthLabel()} · ${scopeName()}`;
    el('ph-meta').textContent = `${stamp()} · ${nf(T.amount)} ₫ · ${nf(T.volume)} L`;
  } else {
    const cur = M.byDate[SEL], pIso = prevISO(SEL), prev = M.byDate[pIso];
    // Missing days are warned about, never silently swapped for the nearest day
    // that happens to have data -- quietly reporting the wrong date is worse
    // than saying the report is incomplete.
    const missing = [
      !prev ? `${formatDateDMY(pIso)} (${t('stats.warn.prevDay')})` : null,
      !cur ? `${formatDateDMY(SEL)} (${t('stats.warn.reportDay')})` : null,
    ].filter(Boolean);
    const partial = isAll() && cur && cur.stationCount < nStations();
    el('warn').classList.toggle('on', missing.length > 0 || !!partial);
    if (missing.length || partial)
      el('warn-tx').innerHTML = (missing.length ? `<b>${t('stats.warn.missing')}</b> ${missing.join(', ')}. ` : '')
        + (partial ? `<b>${t('stats.warn.partial', { n: cur.stationCount, total: nStations(), date: formatDateDMY(SEL) })}</b> ` : '')
        + t('stats.warn.tail');
    el('page-sub').textContent = t('stats.sub.day', { scope: scopeName(), sel: formatDateDMY(SEL), prev: formatDateDMY(pIso) });
    kpisDay(cur, prev);
    const zero = Object.fromEntries(M.fuels.map((f) => [f, { vol: 0, amt: 0 }]));
    chartMix(cur ? cur.fuel : zero, cur
      ? t('stats.mix.capDay', { scope: scopeName(), date: formatDateDMY(SEL), total: nf(M.fuels.reduce((s, f) => s + cur.fuel[f].amt, 0)) })
      : t('stats.noDataDay'));
    chartPumps(M.pumpList.map((p) => ({ ...p, ...(cur?.pumps[p.key] || { vol: 0, amt: 0 }) })), cur ? cur.fuel : zero,
      isAll() ? t('stats.pump.capAllDay', { n: nStations() }) : t('stats.pump.capDay', { date: formatDateDMY(SEL) }));
    chartItems(M.itemList.map((it) => ({ ...it, ...(cur?.items[it.key] || { qty: 0, amt: 0 }) })),
      cur ? t('stats.oil.capDay', { scope: scopeName(), date: formatDateDMY(SEL) }) : t('stats.noDataDay'));
    tablePriceDay(cur, prev);
    tableDay(SEL);
    el('ph-title').textContent = `Demo_CSV — ${t('stats.report.dayTitle', { date: formatDateDMY(SEL) })} · ${scopeName()}`;
    el('ph-meta').textContent = `${stamp()} · ${t('stats.vsDate', { date: formatDateDMY(pIso) })}`
      + (cur ? ` · ${nf(cur.amount)} ₫ · ${nf(cur.volume)} L` : '')
      + (missing.length || partial ? ` · ⚠ ${t('stats.warn.missingShort')}` : '');
  }
}

function wire() {
  el('seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) { MODE = b.dataset.mode; render(); }
  });
  el('mpick').addEventListener('change', () => {
    if (!el('mpick').value) return;
    MONTH = el('mpick').value; SEL = null; reload();
  });
  el('dpick').addEventListener('change', () => { SEL = el('dpick').value; render(); });
  // The export carries whatever scope the screen shows, so a reader can never
  // be handed a PDF covering a period or a station they did not just look at.
  el('btn-pdf').addEventListener('click', () => window.print());
  addEventListener('beforeprint', render);   // refresh the timestamp
}
