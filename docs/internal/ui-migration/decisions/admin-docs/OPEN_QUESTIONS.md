# Admin + Docs (area 09) — decisions taken alone and open questions

Dated lines; each is a decision the admin-docs agent made without a human.

- 2026-10-11 — **Foundation gap fixed on this branch**: `frontend/src/lib/` was never
  committed on `ui/foundation` (root `.gitignore` has `lib/` for Python build output).
  Copied from the foundation worktree, un-ignored with `!frontend/src/lib/`, committed
  as `64f97ea`. The reviewer should apply the same fix to `ui/foundation`.
- 2026-10-11 — **Docs content: keep the 27 HTML partials as the source, compile at build
  time** (brief 09 §9.1). Not MDX: converting 573 KB of hand-written HTML (callouts
  with inline SVGs, 137 tables, 214 code blocks) is a lossy rewrite the content tests
  (`tests/platform/test_platform_docs.py`) would have to be re-targeted for, and the
  vanilla page keeps serving the same files until the cutover. Not runtime fetch +
  innerHTML either: the frontend lint bans `dangerouslySetInnerHTML` outside `TextBlock`
  and a runtime highlighter costs ~130 KB (hljs) or more (Shiki). Instead
  `frontend/plugins/docs-content.ts` (Vite plugin, virtual modules) parses each partial
  with `hast-util-from-html`, assigns heading ids with the vanilla `slugify`, runs Shiki
  on `<pre data-lang>` with a theme whose colours are the `--code-*` tokens (emitted as
  `tok-*` classes), strips script/style/on* defensively, and emits one code-split JSON
  chunk per page rendered through `hast-util-to-jsx-runtime` (React elements, no HTML
  strings). The IA moved to `frontend/src/features/docs/ia.json`; the Python test reads
  it and asserts `docs.js` still lists the same pages. At cutover: move the partials to
  `frontend/content/docs/` and point `DOCS_CONTENT_DIR` at it.
- 2026-10-11 — **Docs routes are paths** (`/docs/:section/:page#heading`, foundation
  OPEN_QUESTIONS §2). `/docs-guide`, `/docs-guide#section/page[/heading]` and `/docs`
  redirect (`replace`) to the path form; unknown section/page falls back to the first
  page like the vanilla router. Old hash links in READMEs keep working.
- 2026-10-11 — **Docs search is full-text** (brief 09 §9.8): titles and section titles
  rank first, then h2/h3 headings, then body text (first 24 KB per page). The index is
  a lazily imported chunk (~400 KB raw / ~110 KB gzip) loaded on the first keystroke;
  the nav filter still works instantly on titles.
- 2026-10-11 — **Prose scale via tokens** (`--docs-font-*`, `--docs-body`, `--docs-*`
  widths) added to `tokens.css`; DESIGN_LANGUAGE §5 updated; the frontend
  design-language test only allows `--docs-font-*` under `features/docs/`.
- 2026-10-11 — **Content fix**: `get-started/api-keys.html:113` had an unescaped
  `<slug>`/`<run_id>` inside a `<pre>` (swallowed by the HTML parser on the vanilla page
  too); escaped.
- 2026-10-11 — **User delete stays out of the UI** (brief 09 §9.2): never surfaced,
  disable + undo covers the admin need; deleting would orphan run ownership.
- 2026-10-11 — **Create User duplicate** (brief 09 §9.3): `existing: true` is surfaced
  as an info toast "already exists" and the row is highlighted/scrolled into view; no
  error, no silent "User created".
- 2026-10-11 — **Recent-runs page size stays 6** (brief 09 §9.4) with `?page=` in the
  URL; no size selector (the page is a monitor, not a browser — Runs pages do that).
- 2026-10-11 — **Maintenance on SQLite** (brief 09 §9.5): the tab stays; `db_stats.error`
  is rendered as a first-class "Statistics unavailable" state above the jobs section.
- 2026-10-11 — **"Total Runs" stat** (brief 09 §9.6) stays a client sum of
  `project.run_count` (includes archived projects), labelled "Runs (all projects)".
- 2026-10-11 — **Force-stop copy** (brief 09 §9.10) drops "Coder": "The process may
  keep running where it was launched until stopped there."
- 2026-10-11 — **Provider configuration** (brief 09 §9.9) has no admin UI; env-only.
- 2026-10-11 — **Foundation change**: `ArchiveProjectDialog` got an optional
  `onArchived` callback; when given it is called instead of `navigate('/')` so the admin
  Projects tab stays put (Project Settings keeps the old behaviour).

## Open for the reviewer

1. The search index chunk size (full body text) — cap per page lower, or move to a
   server endpoint if the docs grow.
2. `tests/platform/test_design_language.py` still freezes `docs.css` sizes; delete with
   the vanilla docs page at cutover.

## Design decision (playbook step 3) and foundation primitive changes

- 2026-10-11 — **Admin: variant `tabs`** (UX_DECISION.md: tabs 27 vs rail 20 vs sections 20 of 30);
  **Docs: variant `hybrid`** (nav · article · sticky TOC with a results-popover combobox; 25 vs 23 vs 21).
  Tab is the path segment `/admin/:tab`; stat strip shown on the Runs tab only; row actions are ghost
  buttons, red only in the terminal confirm and on the irreversible-job submit.
- 2026-10-11 — **Foundation primitive changes**: `SearchField` gained `inputProps` (combobox
  role/aria on the input); `Textarea` now sets `isInvalid` from `errorMessage` (like `TextField`;
  the error was never shown); `ArchiveProjectDialog` gained `onArchived`.
- 2026-10-11 — Force stop is hidden on terminal runs (STOPPED/COMPLETED/FAILED) even when the
  server still says `can_force_stop` (it does for just-stopped runs).
- Not tested under QYM_AUTH_MODE=none: member forbidden state and reset password (covered by
  `e2e/admin/proxy.spec.ts` with `QYM_E2E_AUTH_MODE=proxy_headers`, run on its own with a fresh DB).
