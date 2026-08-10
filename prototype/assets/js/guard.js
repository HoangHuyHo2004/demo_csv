// Runs on every protected page: redirects to login if there's no session,
// otherwise fills in the profile block (rendered by shell.js) and reveals
// the app. Include this AFTER shell.js so the sidebar/profile DOM already
// exists by the time the (async) session check resolves.
import { requireSession, signOut } from './auth.js';
import { mountScopeSwitcher } from './scope-ui.js';

(async function () {
  const result = await requireSession();
  if (!result) return; // requireSession() already started a redirect to login.html

  const { session, profile } = result;

  if (window.DemoCSVShell) {
    window.DemoCSVShell.setProfile(
      profile?.display_name || session.user.email,
      session.user.email
    );
    window.DemoCSVShell.onSignOut(async () => {
      await signOut();
      location.href = 'login.html';
    });
  }

  // No-ops on pages without a #scope-switcher element (e.g. stations.html).
  await mountScopeSwitcher(session.user.id, profile?.role === 'owner');

  // Hide anything marked owner-only (e.g. Security's Roles & permissions,
  // Audit log, IP & geo access) when the signed-in user isn't an Owner.
  // This is a UI convenience only -- these sections are static mockups
  // with no real data behind them, so there's nothing here for RLS to
  // protect. The moment any of them starts reading real data, that data
  // must be protected by RLS on the query itself, not by this hiding.
  if (profile?.role !== 'owner') {
    document.querySelectorAll('[data-owner-only]').forEach((el) => {
      el.style.display = 'none';
    });
  }

  document.body.classList.remove('preauth');
})();
