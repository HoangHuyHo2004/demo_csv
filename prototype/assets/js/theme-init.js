// Plain, non-module script -- deliberately loaded first, before the
// stylesheet <link>, on every page. This has to run synchronously before
// first paint or the page flashes light-then-dark; a module script (which
// defers) would be too late for that. theme.js (loaded later, as a module)
// re-derives the same state from the same key and takes over from here.
(function () {
  var KEY = 'demo_csv.theme';
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  var mode = saved || 'system';
  var resolved = mode === 'system'
    ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
})();
