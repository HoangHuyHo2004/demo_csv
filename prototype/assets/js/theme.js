// Theme (light/dark/system), mirroring i18n.js's getLanguage/setLanguage/
// onChange shape. Unlike language, theme is a device preference rather than
// an account one -- intentionally not gated behind a userId -- which is
// also what lets theme-init.js apply it synchronously before any session is
// known, avoiding a light-flash on load (including on the pre-auth login
// page).
const STORAGE_KEY = 'demo_csv.theme';
const MODES = ['light', 'dark', 'system'];
const listeners = [];

let currentMode = 'system';
try { currentMode = localStorage.getItem(STORAGE_KEY) || 'system'; } catch (e) {}

function systemPref() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(mode) {
  document.documentElement.setAttribute('data-theme', mode === 'system' ? systemPref() : mode);
}

// Keep in sync if the OS scheme changes while the user is on "System" --
// otherwise the app would only pick that up on the next full page load.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentMode === 'system') apply('system');
  });
}

export function getMode() {
  return currentMode;
}

export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  currentMode = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) {}
  apply(mode);
  listeners.forEach((cb) => cb(mode));
}

export function onChange(cb) {
  listeners.push(cb);
}
