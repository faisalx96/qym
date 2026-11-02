# Datasets, reviews, trash — analysis

Walked on 2026-10-11 against the vanilla pages on port 8805 (`QYM_AUTH_MODE=none`,
SQLite) with seeded data: project `acme` (4 live datasets: "Support QA" with 320 items
and v1 prod / v2 published / v3 draft, a never-published draft, an empty dataset, a
private test set; 1 deleted dataset; 2 SDK runs with 28 corrections: 22 pending, 4
approved, 2 rejected; 2 soft-deleted runs) and an archived project `legacy` with one
soft-deleted run. Also by reading `datasets.html`, `reviews.html`, `trash.html`,
`api/datasets.py`, `api/analysis.py`, `api/runs.py`. This file covers all three
features (`features/datasets`, `features/reviews`, `features/trash`).

## Confirmed (matches brief 07)

- **Catalog**: cards with identicon, creator pill, state line (`v1 prod · v3 draft`,
  `v1 draft · never published`, `empty`), stats, dates. Search is client-side and
  mirrored to `?q=` (replaceState); sort is a select, in-memory only. "+ New dataset"
  menu has Start blank / Import. Deleted view (`?view=deleted`) is a 5-column table with
  Restore. Archived project hides create controls.
- **Detail**: URL normalises to `?tab=items&v=v1` (production alias first). Hero shows
  `v1 initial import Production` version pill (combobox popover, rows link to
  `?v=`), state-driven primary action (`+ Create draft` on production, `+ Add item`
  / `Import` / `Publish` on drafts), ⋮ overflow. Tabs Items / Runs / Lineage / Settings.
- **Items table**: `#`, `ID` (only when user ids exist), Input, Expected, Metadata,
  Runs, one column per metric (`exact_match`, `fuzzy_match` coloured), Latency,
  Edits, ⋮ (Copy as JSON; Delete on drafts). Header click → server sort, URL gets
  `sort=expected_asc` silently; pager 25/50/100/250, `?page=` 0-based. Arabic cells
  render RTL via `dir`. Private test set as admin shows items (`items_visible: true`);
  non-admins get the locked state (server 403 otherwise).
- **Item page**: `?item=&tab=details|runs|history`. Three panels with type tag
  (`string`/`object`), Text/JSON segmented toggle on Input and Expected only, live
  status ("unchanged"), Save changes / Delete / Previous / Next on drafts; published
  versions show "Create draft to edit" and read-only panels. History lists per-version
  cards with `created`/`updated` revisions and before/after per field. Runs tab has a
  stat strip + table with trace button.
- **Runs / Lineage / Settings / Compare** exactly as in §2.9–2.13: lineage change
  counts (+1 −1 ~2), Compare buttons, change log; settings General / Visibility
  (admins) / Danger zone (typed-name delete); compare hero with base/head selects,
  swap, Open base/head, Download diff, summary strip, 4 tabs with counts, collapsible
  rows with word diff and "type changed: string → number".
- **Upload wizard**: 3 steps, name → slug preview, encoding select appears after a file
  is chosen ("UTF-8 · detected"), mapping table with 5 roles per column and a live
  summary line, review step with version name / Publish immediately / Set as
  production + preview table; Esc with a file loaded asks "Discard this upload?".
- **Reviews**: hero with queue line + progress bar, 4 status tiles as `role=tab`,
  toolbar of 15+ controls (select-all, search, sort, 4 facet multiselects with counts
  and "Only", source segmented, two range sliders, Clear filters, count, ?). Cards are
  ~330 px tall (two issue columns + chips + previews); ~2 fit on a 800 px viewport.
  `j` sets `is-current` and focuses the card; `o` expands and lazy-loads snapshots,
  revision history, metric scores, item metadata; `e` opens the inline issue form.
  Filters mirror to the URL (`?status=pending` is written on load). The global
  `/reviews` adds a Project chip.
- **Trash**: retention sentence, "Retention 30 days", total count, project select with
  counts and "(archived)", "Restore selected", sticky Actions column, purge column
  ("in 29 days" / "Purge paused while the project is archived"), archived rows cannot
  be restored. No URL state.

## What the brief got wrong or left open

- Runs tab pager (vanilla) prints `1–2 of 194.41655849245407 runs` — the vanilla code
  passes a latency average as `total` (bug); the React version uses `total` from the
  response.
- The brief says the catalog sort "could move server-side": `GET /v1/datasets` has no
  `sort`/`q`; keep client-side but put `?sort=` in the URL (decision logged).
- `?id=` deep link inserts an out-of-page correction at the top — confirmed; the new
  version keeps that behaviour but marks the card as "linked" (decision logged).
- The item page has no dirty-state guard — confirmed; one is added (`beforeunload` +
  in-app confirm on Prev/Next/tab/back).
- The wizard reads whole files on the main thread — confirmed; parsing moves to a
  Web Worker (`csv.worker.ts`) with the same encoding scoring.
- Corrections created through `POST /api/runs/update_root_cause_issue` land as human
  rows with `ai_root_cause_issues: []` — the AI column shows "—"; the mocks must show
  both populated and empty AI columns.
- `frontend/src/lib/` on `ui/foundation` was never committed (the root `.gitignore`
  `lib/` rule swallows it); this branch copies it from the foundation worktree and adds
  a `!frontend/src/lib/` exception.

## Behaviours kept

Everything marked MUST-KEEP in brief §3, specifically: every URL/param contract in §8
(`?q`, `?view=deleted`, `?tab`, `?v` normalisation and resolution order, `?item`,
`?page` 0-based, `?search`, `?sort`, `?label`, compare `?base/?head/?tab`, reviews
`status/source/conf_min/conf_max/q/task/dataset/model/run/id` with the `__none__`
sentinel, `tab=versions` → lineage); the Text/JSON type-explicit editor (strings are
never coerced; touched fields only); version resolution; private-set locked state and
request short-circuit; permission gating (`can_set_production`, `can_delete`,
`can_manage`, `can_set_private_test_set`, `review_block`, archived read-only);
chunked `items:bulk` (1000) for add-to-draft; CSV encoding/delimiter detection,
JSON/JSONL per-line errors, auto-mapping; discard confirm + focus return; keyboard
triage `j k a r e o x / ? Shift+A` + ↑/↓ and Enter; bulk `expected_count` /
`expected_status` 409 with a reload-and-reselect conflict UI; infinite scroll + Load
more; lazy card detail; edit form with new-id handling; trash single/bulk restore with
skipped reasons; purge countdown and archived-paused copy; admin-only gate.

## Dropped

Legacy item drawer (dead code), `sessionStorage` dataset-name cache (query cache),
fixed-bottom pager hack, `refreshDetailView({force})` full reloads (query
invalidation), page-local toast system, hover-only cell popovers (the full value is
one click away on the item page), `localStorage` reviews sort (moves to `?sort=`),
`RESTORING_REVIEWS_VIEW` scroll suppression (the shell owns scroll restoration).
