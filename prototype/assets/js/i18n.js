// Minimal, dependency-free i18n. No framework, no build step, so the
// contract has to be simple enough for plain HTML to follow directly:
//
//   <span data-i18n="settings.account.title">Account</span>
//   <input data-i18n-placeholder="uploads.searchPlaceholder" placeholder="Search…">
//   <button data-i18n-title="shell.signOut" title="Sign out">…</button>
//
// Only put data-i18n on an element whose ENTIRE text content is
// translatable -- applyTranslations() sets .textContent, which would wipe
// out any child element (an icon <svg>, a nested <small>, a <code>, etc.)
// A label with a hint underneath needs two separate data-i18n spans, not
// one on the parent. The one exception is data-i18n-html, which sets
// .innerHTML instead -- use it only for the handful of strings that
// genuinely need inline markup (e.g. "Click <b>Show</b> to reveal"), and
// only with dictionary values (developer-authored constants), never with
// anything derived from user input.
//
// Dictionaries are flat string maps keyed by "page.section.name", one file
// per page under ./i18n/dict.*.js, each exporting { en, vi }. Keeping them
// in separate files (rather than one shared object) means translating one
// page never touches another page's file.
import { en as enCommon, vi as viCommon } from './i18n/dict.common.js';
import { en as enShell, vi as viShell } from './i18n/dict.shell.js';
import { en as enSettings, vi as viSettings } from './i18n/dict.settings.js';
import { en as enSecurity, vi as viSecurity } from './i18n/dict.security.js';
import { en as enIndex, vi as viIndex } from './i18n/dict.index.js';
import { en as enStatistics, vi as viStatistics } from './i18n/dict.statistics.js';
import { en as enUploads, vi as viUploads } from './i18n/dict.uploads.js';
import { en as enMetrics, vi as viMetrics } from './i18n/dict.metrics.js';
import { en as enStations, vi as viStations } from './i18n/dict.stations.js';
import { en as enAlerts, vi as viAlerts } from './i18n/dict.alerts.js';
import { en as enInsights, vi as viInsights } from './i18n/dict.insights.js';

const TRANSLATIONS = {
  en: {
    ...enCommon, ...enShell, ...enSettings, ...enSecurity, ...enIndex,
    ...enStatistics, ...enUploads, ...enMetrics, ...enStations, ...enAlerts,
    ...enInsights,
  },
  vi: {
    ...viCommon, ...viShell, ...viSettings, ...viSecurity, ...viIndex,
    ...viStatistics, ...viUploads, ...viMetrics, ...viStations, ...viAlerts,
    ...viInsights,
  },
};

export const SUPPORTED_LANGUAGES = ['en', 'vi'];
const DEFAULT_LANGUAGE = 'en';

let currentUserId = null;
let currentLang = DEFAULT_LANGUAGE;
const listeners = [];

function storageKey(userId) {
  return `demo_csv.lang.${userId}`;
}

// Looks up `key` in the current language, falling back to English, then to
// the raw key itself -- a missing translation should be visibly wrong
// (shows "settings.foo.bar" or the English string) rather than throwing or
// silently rendering blank.
export function t(key, vars) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[DEFAULT_LANGUAGE];
  let str = dict[key] ?? TRANSLATIONS[DEFAULT_LANGUAGE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll(`{{${k}}}`, v);
    }
  }
  return str;
}

export function getLanguage() {
  return currentLang;
}

// Applies the current language to every translatable element under `root`
// (defaults to the whole document). Call again after mounting any dynamic
// content (the shell sidebar, a re-rendered file list, etc.) -- there's no
// MutationObserver watching for new nodes, on purpose: implicit magic here
// would make it harder to reason about when a string gets translated.
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  if (root === document || root.nodeType === 9) {
    document.documentElement.lang = currentLang;
  }
}

// Sets the language, persists it for this user, re-applies to the whole
// document, and notifies anything that rendered translated strings from
// JS (dashboard KPIs, upload status labels, etc.) rather than static
// markup -- those can't be caught by applyTranslations()'s querySelector
// sweep since they don't exist as data-i18n elements.
export function setLanguage(lang) {
  if (!SUPPORTED_LANGUAGES.includes(lang)) return;
  currentLang = lang;
  if (currentUserId) {
    try { localStorage.setItem(storageKey(currentUserId), lang); } catch {}
  }
  applyTranslations(document);
  listeners.forEach((cb) => cb(lang));
}

export function onChange(cb) {
  listeners.push(cb);
}

// Call once per page, after the session/profile is known (guard.js does
// this). Reads the signed-in user's saved language -- deliberately
// per-user, not global: a shared browser with two accounts shouldn't have
// one person's language choice leak into the other's session.
export function init(userId) {
  currentUserId = userId;
  let saved = null;
  try { saved = localStorage.getItem(storageKey(userId)); } catch {}
  currentLang = SUPPORTED_LANGUAGES.includes(saved) ? saved : DEFAULT_LANGUAGE;
  applyTranslations(document);
  // Notifies onChange listeners too (not just setLanguage()) -- a page's
  // own module script (e.g. settings.html syncing its language <select>)
  // can register a listener before or after guard.js's init() actually
  // resolves; without this, whichever ran first would show a stale
  // default until the user manually changed the language.
  listeners.forEach((cb) => cb(currentLang));
  return currentLang;
}
