# Admin + in-app Docs — analysis (area 09)

Walked on 2026-10-11 against the vanilla pages on port 8807 (`QYM_AUTH_MODE=none`,
SQLite, 3 projects incl. one archived, 5 users incl. a second admin and a disabled
member, 12 runs incl. 2 live) and by reading `admin.html`, `docs.js`, `docs.css`,
`api/admin.py`, `api/web.py`, `api/runs.py`, `api/projects.py`. The docs half of
this analysis lives here too (`features/docs/ANALYSIS.md` is a pointer).

## Confirmed (brief §2 journeys)

- **A — live runs**: `GET /api/runs/live?all_projects=true&limit=100` every 10 s
  after first load, sequence-guarded; `GET /api/runs/recent?all_projects=true&
  include_projects=false&global_limit=6&global_offset=N`; the two sets are
  disjoint (archiving a project stopped its live run, which then showed in
  Recent). Force stop: confirm (danger, copy mentions "Coder"), one POST, run
  leaves Live, Recent row merges the response, `#run-message` announces, both
  lists reload. `can_force_stop` is true for RUNNING/PENDING only.
- **B — projects**: admins see archived projects in `GET /v1/projects`; Archive
  → preview of in-progress runs, Unarchive → preview of API keys + "Revoke keys
  first" → `settings?tab=apikeys`. Both dialogs already exist in the foundation
  (`features/shell/dialogs/ArchiveProjectDialogs.tsx`) and are reused as-is.
- **C — users**: add-bar + table; Disable confirm → "Disabled X" toast with Undo
  (10 s); Enable has no confirm; self row: Disable permanently disabled with a
  tooltip; Edit modal locks role/active for self and omits them from the PUT;
  Reset password only when `local_auth.enabled` and not self (hidden under
  `QYM_AUTH_MODE=none`, so e2e for it needs `QYM_E2E_AUTH_MODE=proxy_headers`);
  while pending every control locks and the modal cannot close.
- **D — maintenance**: one long header sentence, Postgres-only stats (SQLite
  gives `db_stats.error` = "(sqlite3.OperationalError) no such function:
  current_database"), 17 job kinds, only `drop_legacy_spans` is irreversible;
  typed confirm must equal the kind; jobs table with Log/Start/Cancel; 3 s
  re-poll while any job is queued/running/cancel_requested.
- **E — docs**: hash routing `#section/page[/heading]`, no hash →
  `replaceState` to `#get-started/what-is-qym`; partials fetched from
  `/static/docs/<s>/<p>.html` and injected; TOC from h2/h3 with slugified ids
  (no partial carries an id attribute: 0 of 411 headings); `/` focuses search,
  Enter opens the first match, Escape clears; search is title-only; the sticky
  nav rail is taller than the viewport, so the active link scrolls out of view
  (pain point confirmed in the screenshot); deep link
  `#developer/endpoints/conventions` lands at scrollTop 434 with the TOC entry
  highlighted.

## What the brief got wrong or left open

- `GET /v1/projects` run_count sums to 12 while Recent reports "6 total" and Live
  2: the archived project's runs are counted in the stat strip but listed
  nowhere. The stat strip is therefore kept but labelled "Runs (all projects)".
- Live runs show `run_name` = "" for API-created runs without `external_run_id`;
  the vanilla page falls back to the first 8 chars of `run_id`. Kept.
- Reset password is invisible under `QYM_AUTH_MODE=none` (providers payload says
  `local_auth.enabled=false`), not only "when not self" as §2.C reads.
- The content partials contain one unescaped `<slug>` / `<run_id>` inside a
  `<pre>` (`get-started/api-keys.html:113`) that the HTML parser swallows; fixed
  in the partial (content bug, same effect on the vanilla page).
- `docs.css` sizes (28/20/16/15/13 px…) are frozen by
  `tests/platform/test_design_language.py:66`; the frontend lint forbids any px
  font size, so the prose scale becomes `--docs-*` tokens in `tokens.css`
  (sanctioned exception, documented in DESIGN_LANGUAGE §5).
- Foundation gap: `frontend/src/lib/` was never committed (root `.gitignore`
  `lib/`); un-ignored and committed on this branch (`64f97ea`).

## Behaviours kept

Admin gate (role check + 403 handling); stat strip; four tabs now in the URL
(`/admin/:tab`, `/admin` → `/admin/runs`); live polling 10 s with
cancel-on-mutation and pause when hidden; recent runs page size 6 with `?page=`;
force stop with confirm, optimistic removal, run-status bus broadcast, status
announcement; projects list incl. archived with the foundation archive/unarchive
dialogs and Create Project; users create (with email validation and the
`existing` case surfaced), disable confirm + Undo toast, enable, edit dialog
with self-locks and server 400/409 messages inline, reset password → one-time
secret (never cached, cleared on close, dialog locked while pending);
maintenance summary + tables (error as a first-class state), enqueue with JSON
validation and typed confirm for irreversible kinds, jobs table with
Log/Start/Cancel and 3 s polling while active. Docs: IA as data (`ia.json`,
read by `test_platform_docs.py`), real routes `/docs/:section/:page#heading`
with redirects from `/docs-guide#a/b/c`, TOC scroll-spy on the shell scroller,
prev/next, `/` hotkey, Enter/Escape, copy buttons, "not written yet" state,
table scroll wrapper, single-line pre wrap, prose scale via tokens.

## Dropped / changed

Session-storage tab memory (URL instead); full `load()` after every mutation
(targeted invalidation); "Coder" wording (generic "the runner"); raw `<pre>`
log under the jobs table (drawer); inline never-clearing message lines
(toasts + `role=status` line); runtime highlight.js bundle (Shiki at build
time); runtime `innerHTML` injection (content compiled to hast JSON at build,
rendered through `hast-util-to-jsx-runtime`, see OPEN_QUESTIONS for the
decision); title-only search (titles + headings + body text, index lazy-loaded).
User delete stays out of the UI (never surfaced; OPEN_QUESTIONS).
