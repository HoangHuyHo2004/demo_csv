// Number/currency formatting and metric display conventions shared by
// dashboard.js and statistics.js.

// Metric names like `revenue` are conventions this app assumes, not
// something the schema enforces -- a station whose CSVs use different
// column names still works, it just won't get a fixed color/highlight
// here. Widgets fall back to whatever metrics are actually present,
// ranked by size, rather than showing "$0" for a convention that never
// matched anything real.
const METRIC_COLORS = {
  sales_volume: '#1f6f4a',
  revenue: '#123c2a',
  purchases: '#3455b3',
  losses: '#c94141',
  inventory_on_hand: '#a4680d',
};
const FALLBACK_PALETTE = ['#1f6f4a', '#3455b3', '#a4680d', '#7c5cff', '#c94141'];

export function metricColor(name, fallbackIndex = 0) {
  return METRIC_COLORS[name] || FALLBACK_PALETTE[fallbackIndex % FALLBACK_PALETTE.length];
}

export function displayMetricName(name) {
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Zero is a claim about the data; a missing value is not the same thing
// as a real zero, so absent/NaN input renders as an em-dash rather than
// "0" or "$0" -- see the empty-state note in the Phase 5 plan.
export function formatNumber(n, { decimals = 0 } = {}) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatCompact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}

export function formatCurrencyCompact(n) {
  const formatted = formatCompact(n);
  return formatted === '—' ? formatted : '$' + formatted;
}

// Percent change vs a previous-period value. Returns null (not 0 or
// Infinity) when there's nothing sane to compare against, so callers can
// render "—" instead of a misleading "+∞%" or "+100%" off a zero base.
export function percentDelta(current, previous) {
  if (current === null || current === undefined) return null;
  if (previous === null || previous === undefined || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatDelta(pct) {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  const sign = pct >= 0 ? '▲ +' : '▼ ';
  return `${sign}${Math.abs(pct).toFixed(0)}%`;
}

export function isoDateNDaysAgo(n, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function dateRangeDays(fromISO, toISO) {
  const dates = [];
  let d = new Date(fromISO + 'T00:00:00Z');
  const end = new Date(toISO + 'T00:00:00Z');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}
