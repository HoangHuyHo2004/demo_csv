// CSV parsing, type inference, and locale-safe number/date normalization.
// These are the highest-risk functions in the upload pipeline -- a wrong
// parse here produces a wrong number in the database with no error to
// flag it, so keep them small, pure, and easy to reason about in
// isolation.
import Papa from 'https://esm.sh/papaparse@5.4.1';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

// worker:true is deliberately NOT used here. Papa's worker mode reloads
// the library inside a Worker context by URL, which is unreliable when
// the library itself was loaded as an ES module from a CDN rather than a
// classic <script> tag on this no-build-step site. Parsing runs on the
// main thread instead -- fine at the file sizes this app expects (single
// daily CSVs, not bulk historical dumps).
export function parseFile(file) {
  return /\.xlsx?$/i.test(file.name) ? parseSpreadsheet(file) : parseCsv(file);
}

function parseCsv(file) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      complete: (results) => {
        resolve({
          headers: results.meta.fields || [],
          rows: results.data || [],
          rowCount: (results.data || []).length,
          errors: results.errors || [],
        });
      },
      error: (err) => {
        resolve({ headers: [], rows: [], rowCount: 0, errors: [{ message: err.message }] });
      },
    });
  });
}

// Reads the first sheet only -- multi-sheet workbooks aren't a case this
// app's daily-upload model needs to support. raw:false formats each cell
// through its own display format (so a date cell comes out as text, not a
// JS Date or an Excel serial number), which lets the exact same
// normalizeNumber()/toISODate() parsing used for CSV text work unchanged
// here -- one parsing path for both file types instead of two.
async function parseSpreadsheet(file) {
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const headerRow = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })[0] || [];
    const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
    return { headers: headerRow, rows, rowCount: rows.length, errors: [] };
  } catch (err) {
    return { headers: [], rows: [], rowCount: 0, errors: [{ message: err.message }] };
  }
}

// Accepts "1,234,567.89", "1.234.567,89", "₫1.234", "(500)" (negative),
// "12%", NBSP-separated thousands, etc. Returns null if the string isn't
// recognizably numeric -- callers use that to distinguish "0" from "not a
// number."
export function normalizeNumber(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '') return null;

  const isParenNegative = /^\(.*\)$/.test(s);
  s = s.replace(/^\(|\)$/g, '');
  const isNegative = isParenNegative || /^-/.test(s);
  s = s.replace(/^[-+]/, '');

  // Strip currency symbols, percent signs, and any whitespace (including
  // NBSP) used as a thousands separator.
  s = s.replace(/[₫$€£%\s ]/g, '');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  let normalized;

  if (hasComma && hasDot) {
    // Whichever separator appears last is the decimal separator.
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    normalized = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    const parts = s.split(',');
    // A single comma with something other than 3 trailing digits reads as
    // a decimal comma ("12,5"); anything else is thousands grouping.
    normalized = (parts.length === 2 && parts[1].length !== 3)
      ? parts[0] + '.' + parts[1]
      : s.replace(/,/g, '');
  } else if (hasDot) {
    const parts = s.split('.');
    // More than one dot can only be thousands grouping -- a real number
    // has at most one decimal point ("1.234.567" -> 1234567). A single
    // dot is read as a decimal point regardless of how many digits follow
    // it: this app's data convention is comma-thousands/dot-decimal
    // (confirmed against real files, e.g. "1,234,567"), so "1.234" is 1.234,
    // not 1234.
    normalized = parts.length > 2
      ? s.replace(/\./g, '')
      : s;
  } else {
    normalized = s;
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return isNegative ? -n : n;
}

// Parses to an ISO "YYYY-MM-DD" string via explicit regex only. Never
// round-trips through `new Date(string)` -- its US-first, timezone-shifted
// parsing of ambiguous formats like "03/04/2026" is exactly the kind of
// silent off-by-one-day bug that's hard to notice until a report is wrong.
export function toISODate(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '') return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return buildISODate(m[1], m[2], m[3]);

  // DD/MM/YYYY or DD-MM-YYYY (day-first, matching VN/EU convention, which
  // this app's default locale assumes). If the first segment can't be a
  // day (>12) but the second can, recover as if it were MM/DD/YYYY.
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return (a > 12 && b <= 12)
      ? buildISODate(m[3], m[1], m[2])
      : buildISODate(m[3], m[2], m[1]);
  }

  return null;
}

function buildISODate(y, mo, d) {
  const yn = Number(y);
  const mn = Number(mo);
  const dn = Number(d);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${yn}-${pad(mn)}-${pad(dn)}`;
}

export function detectDateFromFilename(filename) {
  const m = String(filename || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Samples up to 200 rows per column. A column is 'date' or 'number' if
// >=80% of its non-empty sampled values parse as that type; otherwise
// 'text'.
export function inferTypes(headers, rows) {
  const sample = rows.slice(0, 200);
  return headers.map((name) => {
    let numCount = 0;
    let dateCount = 0;
    let nonEmpty = 0;
    for (const row of sample) {
      const raw = row[name];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      nonEmpty++;
      if (toISODate(raw) !== null) dateCount++;
      else if (normalizeNumber(raw) !== null) numCount++;
    }
    let type = 'text';
    if (nonEmpty > 0) {
      if (dateCount / nonEmpty >= 0.8) type = 'date';
      else if (numCount / nonEmpty >= 0.8) type = 'number';
    }
    return { name, type, nonEmpty };
  });
}

// Column names that read as a point-in-time snapshot (a stock level, an
// account balance) rather than a per-period transaction total. Summing a
// snapshot across rows produces a number with no real-world meaning, so
// these are excluded from tracking by default (see is_snapshot handling
// in upload.js) rather than silently summed.
export function looksLikeSnapshot(name) {
  return /inventory|stock|on_hand|level|balance/i.test(String(name || ''));
}

export function detectDateColumnName(columns) {
  const named = columns.find((c) => /^date$/i.test(c.name));
  if (named) return named.name;
  const typed = columns.find((c) => c.type === 'date');
  return typed ? typed.name : null;
}
