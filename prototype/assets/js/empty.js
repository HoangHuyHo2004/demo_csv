// Empty-state helpers. A fresh install has zero rows, so this is the
// default view most visitors see first, not a rare edge case -- it gets
// real treatment rather than a blank chart or a stray "NaN".

export function hasData(values) {
  return Array.isArray(values) && values.some((v) => v !== null && v !== undefined);
}

export function emptyTableRow(colspan, message = 'No data yet.') {
  return `<tr><td colspan="${colspan}" style="text-align:center;color:var(--muted);padding:24px">${message}</td></tr>`;
}

export function emptyCardHtml(message = 'No data yet — upload a CSV to see this chart.') {
  return `<div style="text-align:center;color:var(--muted);padding:32px 12px;font-size:12px">${message}</div>`;
}
