// Hand-rolled SVG geometry. The existing <polyline>/<rect>/<circle>
// elements in index.html and statistics.html stay put -- these functions
// only compute the attribute values (points, dasharray, heights) that get
// written onto them, so the axes/gridlines/labels around them never need
// to change.

export function polylinePoints(values, { w, h, pad = 4 } = {}) {
  const clean = values.filter((v) => v !== null && v !== undefined);
  if (clean.length === 0) return '';
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  return values.map((v, i) => {
    const val = v === null || v === undefined ? min : v;
    const x = pad + stepX * i;
    const y = pad + innerH - ((val - min) / range) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function areaPath(values, { w, h, pad = 4, baseline } = {}) {
  const points = polylinePoints(values, { w, h, pad });
  if (!points) return '';
  const parts = points.split(' ');
  const base = baseline ?? (h - pad);
  const firstX = parts[0].split(',')[0];
  const lastX = parts[parts.length - 1].split(',')[0];
  const line = parts.map((p, i) => (i === 0 ? 'M' : 'L') + p).join(' ');
  return `${line} L${lastX},${base} L${firstX},${base} Z`;
}

// Normalizes a series to 0-100 (percent of the max) for CSS height/width bars.
export function barPercents(values) {
  const max = Math.max(...values.map((v) => v || 0), 0) || 1;
  return values.map((v) => Math.max(0, ((v || 0) / max) * 100));
}

// parts: [{ value, color }]. Returns segments in the order given, each
// with the dasharray/dashoffset to draw on a stroke-dasharray donut
// (circumference normalized to 100 via r=15.9155, so percentages are
// literal dash lengths). offset starts at 25 to begin at 12 o'clock,
// matching the existing transform="rotate(-90 21 21)" on each circle.
export function donutSegments(parts) {
  const total = parts.reduce((a, p) => a + (p.value || 0), 0) || 1;
  let offset = 25;
  return parts.map((p) => {
    const pct = ((p.value || 0) / total) * 100;
    const seg = {
      dasharray: `${pct.toFixed(1)} ${(100 - pct).toFixed(1)}`,
      dashoffset: offset,
      color: p.color,
      pct,
    };
    offset -= pct;
    return seg;
  });
}

export function sparkline(values, w = 60, h = 26) {
  return polylinePoints(values, { w, h, pad: 3 });
}

// dates: ordered array of ISO date strings for the full range (including
// zero-value days, so the heatmap has no gaps). byDate: { 'YYYY-MM-DD': n }.
export function heatCells(byDate, dates) {
  const vals = dates.map((d) => byDate[d] ?? 0);
  const max = Math.max(...vals, 0) || 1;
  return dates.map((d) => {
    const v = byDate[d] ?? 0;
    const level = v === 0 ? 0 : Math.min(5, Math.ceil((v / max) * 5));
    return { date: d, value: v, level };
  });
}

export function pearsonR(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}
