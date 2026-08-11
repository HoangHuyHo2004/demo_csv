# Demo_CSV

A daily-CSV business tracker for a small business with multiple stations (e.g. petrol
stations). An accountant uploads a CSV or Excel (.xlsx/.xls) file per station per day;
the app parses it, stores it, and renders trend dashboards for the owner.

**Live site:** https://hoanghuyho2004.github.io/demo_csv/
**Backend:** Supabase project `demo-csv` (ap-southeast-1)

---

## Architecture

Static site, no server. The browser talks to Supabase directly via `supabase-js`.
Supabase provides auth, a REST API (PostgREST), and Row Level Security — there is no
backend process this app runs itself, which is also why **Row Level Security is the
entire security boundary**. There is no server-side check to fall back on if an RLS
policy is wrong.

```
prototype/
  login.html                 sign in / create account
  index.html                 Overview dashboard (wired to live data)
  statistics.html            Statistics dashboard (wired to live data)
  uploads.html                CSV upload pipeline (wired to live data)
  metrics.html, stations.html, alerts.html,
  insights.html, settings.html, security.html   static mockups — NOT wired to the
                                                  database (see Known limitations)
  assets/
    css/app.css               single shared stylesheet for all pages
    js/
      config.js                Supabase URL + publishable key (safe to commit — see below)
      supabase-client.js       singleton Supabase client
      auth.js                  session guard, sign in/up/out, cached profile
      guard.js                 runs on every protected page: enforces auth, mounts shell
      shell.js                 renders the sidebar/header from one shared template
      scope.js / scope-ui.js   the "station scope" switcher in the header
      first-run.js             first-owner bootstrap flow (index.html only)
      data.js                  every Supabase query in the app lives here
      csv.js                   CSV/XLSX parsing, type inference, number/date normalization
      upload.js                uploads.html controller (dropzone, save/overwrite, history)
      dashboard.js              index.html controller
      statistics.js             statistics.html controller
      charts.js                 hand-rolled SVG geometry helpers
      fmt.js                    number/currency formatting, metric display conventions
      empty.js                  empty-state helpers
      i18n.js                   English/Vietnamese translation engine (see below)
      i18n/dict.*.js             one translation dictionary per page, plus dict.common.js
                                  and dict.shell.js for strings shared across pages
supabase/
  migrations/                  every SQL migration applied to the project, in order
                                 (any file marked "NOT YET APPLIED" is pending)
  functions/                   Edge Functions — scheduled report delivery (not deployed)
tools/
  convert_journal.py           daily-journal .xlsx -> one flat CSV per day, for upload
```

## Running locally

ES modules don't load over `file://` — you must serve the files over HTTP:

```bash
cd prototype
python -m http.server 8000
```

Then open `http://localhost:8000/index.html`. Double-clicking the HTML files will show
a blank page with a CORS/module error in the console — that's expected, not a bug.

## Database

Schema and RLS policies are defined in `supabase/migrations/`, applied in order via the
Supabase MCP tools. To recreate the project from scratch, apply each migration file in
filename order against a fresh Supabase project, then run the bootstrap flow described
below.

Every file's content was verified against the live project's actual schema, grants, and
policies as of the last verification pass — with one exception:
`20260809093234_tighten_function_grants.sql` is a best-effort reconstruction (its
original text wasn't preserved verbatim); its content matches the live grants it claims
to set, but treat it as approximate rather than a byte-exact record.

### Roles

Two roles: **Owner** (full access to every station) and **Accountant** (access limited
to stations they're explicitly added to via `station_members`). New sign-ups default to
`accountant`.

### Becoming the first Owner

There is no seed data and no admin UI for the very first setup. When a signed-in user
who isn't an Owner has zero accessible stations, `index.html` shows a "Set up Demo_CSV"
overlay. Clicking **Become the Owner** calls `bootstrap_first_owner()`, a database
function that is a one-shot: it silently refuses if an Owner already exists anywhere in
the project, so it can safely be left callable by any signed-in user. If no stations
exist yet either, the same overlay then asks for a station name/code before revealing
the dashboard.

Granting an Accountant access to a station has no UI yet — insert the `station_members`
row directly:

```sql
insert into public.station_members (station_id, user_id, added_by)
values ('<station-id>', '<accountant-user-id>', '<owner-user-id>');
```

## Why the Supabase key in `config.js` is safe to commit

`SUPABASE_PUBLISHABLE_KEY` is not a secret. It's an identifier that tells PostgREST
"this request is from project X, acting as the `anon` role" — every Supabase web app
ships this in its client bundle, visible in view-source. With Row Level Security enabled
on every table, `anon` and even `authenticated` can do nothing until a user signs in and
gets a JWT, and even then it's the RLS policies — not this key — that decide what they
can see or change.

The key that must **never** appear in this repository is the `service_role` key. That
one bypasses Row Level Security entirely and belongs only on a trusted server, which
this static site does not have.

## Language (English / Vietnamese)

Every page behind the login wall (not `login.html` itself, which stays English) supports
switching between English and Vietnamese from Settings → Language & locale. The choice is
per-user (`localStorage` keyed by user id, not global), so a shared browser with two
accounts never leaks one person's language into the other's session, and it applies
instantly without a page reload.

Static text is marked with a `data-i18n="key"` attribute and translated by a small
sweep (`applyTranslations()` in `assets/js/i18n.js`) that runs after auth resolves.
Text generated from JavaScript (KPI labels, upload status, empty states, etc.) calls
`t('key')` directly at render time and re-renders on a language-change event, since a
one-time DOM sweep can't reach text that doesn't exist yet. Every dictionary key is
duplicated in both `en` and `vi` — English isn't a fallback default baked into the
markup, it's translated the same way Vietnamese is, so the two stay symmetric by
construction rather than by convention.

## What's wired vs. what's a mockup

Per an explicit scope decision, only the core loop is wired to live data:
**Login → Uploads → Overview → Statistics**. The other six pages (Metrics, Stations,
Alerts, Insights, Settings, Security) are the original static prototype — they render
real UI behind the login wall, but every number on them is invented mockup data, not
read from the database. This was a deliberate scope decision (see conversation history),
not an oversight, but it means a visitor could reasonably mistake "13 alerts" or "565K
records" on those pages for real figures.

## Known limitations

- **Statistics reads one specific metric-name contract.** It renders the daily-journal
  names produced by `tools/convert_journal.py` (`sl_<fuel>_tru<n>`, `tt_<fuel>_tru<n>`,
  `sl_<item>`, `tt_<item>`, `ca_<shift>`). Uploads using any other column names — including
  the earlier `revenue`/`sales_volume` test data — are ignored and the page shows its
  empty state. Pumps, fuels, items and shifts are discovered from the names present, so
  nothing is hardcoded, but the prefixes are load-bearing. See
  `docs/statistics-dashboard-spec.md`.
- **Shift names display as ASCII slugs** (e.g. `VAAN` for a name spelled with `â`) rather
  than the original Vietnamese spelling. The converter folds diacritics Telex-style so
  that two shifts differing only by vowel shape cannot collide into one metric —
  correct, but ugly. The `metrics.display_name` column exists to carry the real name and
  nothing populates it yet.
- **Month-over-month comparison is not implemented.** The month view has no prior-month
  delta; only the day view compares (against the previous day).
- **The donut chart's segment labels on Overview are positioned at fixed coordinates**
  inherited from the original mockup's fixed 68/23/9 layout. With real, differently-sized
  segments the percentage labels can land slightly off from their arc — a cosmetic gap,
  not a data error. A proper fix computes each label's position from its segment's actual
  midpoint angle.
- **Alerts and Insights still show invented figures in US dollars.** Those two pages are
  unwired mockups (see above); their demo text was never converted to VND.
- **CSV number parsing assumes US/UK-style formatting** (comma-thousands, dot-decimal)
  when only one separator is present to disambiguate — confirmed against real uploaded
  data (e.g. `"1,234,567"`). A bare `"1.234"` is read as 1.234, not 1234. Multiple dots
  are unambiguous either way and always read as thousands grouping (`"4.200.000"` →
  4200000). A different-locale deployment would need this revisited.
- **No automated test suite.** Every fix in this build was verified by hand against the
  live database (see conversation history for specifics) rather than by a repeatable
  test file — a real gap if this codebase grows further.
- **Recent Uploads on the Overview page shows overwritten rows alongside their
  replacements**, which is an honest audit trail but can look like a duplicate at a
  glance.
- Free-tier Supabase projects pause after ~7 days of inactivity; the first request after
  a pause can hang for several seconds. `login.html` shows a "waking up the database…"
  hint after a 4-second delay, but this hasn't been tested against an actually-paused
  project.

## Security posture

Four real defects were found and fixed in the schema during this build (not just
theoretical hardening — each was verified against the live database):

- A privilege-escalation hole in `profiles` that let any Accountant PATCH their own role
  to `owner`.
- The `metric_daily` view bypassing Row Level Security entirely (it was `SECURITY
  DEFINER`; fixed to `SECURITY INVOKER`).
- No DELETE policy on `metric_values` for Accountants, which silently no-op'd the
  overwrite/rollback flow instead of erroring.
- A unique constraint that made the CSV overwrite flow structurally impossible.

All four have a corresponding regression test that was re-run and confirmed passing as
of the last verification pass (see conversation history / `supabase/migrations/` for
details). `get_advisors` (security + performance) reports zero ERROR-level findings as
of that same pass — remaining WARN-level items are either deliberate (e.g.
`bootstrap_first_owner` must be callable by non-Owners to do its job) or platform
defaults (leaked-password protection is off, a reasonable follow-up to enable).
