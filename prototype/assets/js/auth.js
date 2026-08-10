// Session, profile, and sign-in/out for Demo_CSV.
//
// IMPORTANT: the profile object cached here (including `role`) drives UI
// only -- which nav items show, which station picker options appear, etc.
// It must never be the thing that decides whether an action is ALLOWED.
// Every real permission decision is enforced by Postgres Row Level Security
// on the other end of the request. If this cache is ever stale or wrong,
// the worst outcome should be a confusing UI, never a security hole.
import { supabase } from './supabase-client.js';

const PROFILE_CACHE_PREFIX = 'demo_csv.profile.';

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('getSession failed:', error);
    return null;
  }
  return data.session;
}

// Fetches (and caches in sessionStorage, not localStorage -- a stale
// role surviving into a *different* user's session on a shared browser is
// exactly the kind of thing that produces a baffling bug report) the
// profile row for a given user id.
export async function getProfile(userId) {
  const cacheKey = PROFILE_CACHE_PREFIX + userId;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through and refetch
    }
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role, phone')
    .eq('id', userId)
    .single();
  if (error) {
    console.error('getProfile failed:', error);
    return null;
  }
  sessionStorage.setItem(cacheKey, JSON.stringify(data));
  return data;
}

// Exported so callers that change a user's role server-side (e.g. the
// first-run "become the Owner" flow) can force a refetch instead of
// reading the now-stale cached role for the rest of the tab's life.
export function clearProfileCache(userId) {
  if (userId) sessionStorage.removeItem(PROFILE_CACHE_PREFIX + userId);
}

// Call this must-run-first on every protected page. Redirects to the login
// page (preserving where the visitor was headed) if there is no session.
// Callers MUST stop rendering when this returns null -- the redirect has
// been started, but script execution continues until navigation actually
// happens, so the caller has to bail out explicitly.
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace(`login.html?next=${next}`);
    return null;
  }
  const profile = await getProfile(session.user.id);
  return { session, profile };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

// `data.session` will be null here if the project requires email
// confirmation -- callers must handle that branch (show "check your email")
// rather than assuming a successful call always yields a live session.
export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const session = await getSession();
  if (session?.user?.id) clearProfileCache(session.user.id);
  await supabase.auth.signOut();
}
