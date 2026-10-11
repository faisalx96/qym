# Run detail — decisions taken alone

- 2026-10-11 — `frontend/src/lib/` was never committed on `ui/foundation`: the root
  `.gitignore` rule `lib/` (Python packaging) swallowed it. Copied the files from the
  foundation worktree and added `!frontend/src/lib/` to `.gitignore` on this branch.
  The foundation reviewer should cherry-pick that one-line ignore fix.
- 2026-10-11 — Seeding is done only through the public API (`e2e/run-detail/seed.ts`,
  NDJSON RunEventV1) and shared by the dev walkthrough and the Playwright specs.
- 2026-10-11 — Offline HTML export stays on the legacy `export-html` endpoint; the
  React page only links to it (brief §9 Q1).
- 2026-10-11 — Legacy item-level diagnosis editors are not rebuilt; their stored
  values render read-only; editing happens per metric through the issue dialog
  (brief §9 Q2).
- 2026-10-11 — Pass switching is an in-app search-param change (`?pass=N`); rows are
  scoped client-side through one selector so a half-applied scope is impossible
  (brief §9 Q7). Server `pass_number` scoping is left for later.
- 2026-10-11 — Not-found/denied: the page classifies the 200 `{error}` envelope (not
  found / denied / else) in the query function and throws an `ApiError` with 404/403
  so `ErrorState` works; the endpoint itself is left unchanged for the legacy page.
- 2026-10-11 — Virtualization library: `@tanstack/react-virtual@3.14.13` (pinned; newest release ≥ 2 weeks old). It is headless, measures dynamic row heights (expanded item cards) and uses the shell's `main#shell-content` scroller via `scrollMargin`, so the page keeps one scroller. Used for the item list, heatmap, span tree and item×metric matrix.
- 2026-10-12 — Run was interrupted by a usage limit; the design sub-agent's outputs survived, only UX_DECISION.md was missing and a fresh UX sub-agent wrote it. Winner: variant C (items-first), see decisions/run-detail/UX_DECISION.md.
- 2026-10-12 — Deep analysis: correlation matrix + relationship scatter kept (panel tab "Deep"); item×metric matrix, quality-latency frontier, by-pass trend and stability map dropped for v1 (NICE in brief §3c; Deep tab leaves room). Sankey dropped (NICE).
- 2026-10-12 — Reviews have a home as a panel tab ("Reviews", shown only when review events exist) plus the score-lock notice above the table; experiment panel and versioning details live in the expandable hero.
- 2026-10-12 — Section anchors: `#overview|latency|deep|categories|errors|root-cause` open the matching panel tab, `#items` scrolls to the table; `?panel=<tab>` is the new URL form. Under 1200px the panel is a Drawer instead of an inline column (UX_DECISION fix).
- 2026-10-12 — Legacy item-level diagnosis editors are not rebuilt (brief §9 Q2): legacy values show read-only; issue dialog is per metric.
- 2026-10-12 — Root cause: issues are reviewed per pass on repeat runs (the server requires `pass_number`), so the all-passes view shows links to `?pass=N&item=ID` instead of cards. Category catalog editing from inside the issue dialog is not kept (brief §9 Q12): the dialog offers the project catalog plus a free-text "New category…"; solution is free text (no preset list).
- 2026-10-12 — Page size: virtualized table keeps a real pager with page sizes 20 (default, so legacy `?page=N` links land where they did) / 50 / 100 / 500, remembered in localStorage `qym:run-page-size` (brief §9 Q3).
- 2026-10-12 — Categories "Compare" view and the Sankey are dropped (NICE); the Categories tab keeps chips + cards with click-to-filter.

## Final e2e stabilisation (2026-10-11)

- Four failures triaged. Product bug: `normalizeTrace` built the "All attempts" tree by splicing failed spans into the final attempt's own tree, so selecting "Attempt 2" still showed the merged failed try (fixed: the combined tree gets fresh copies; Vitest case added). Spec faults: the rule-builder test reloaded before the 150 ms debounced value committed (now waits for `"value":"1000"`); the sort test read latency by hard-coded cell index 6 (now `data-cell="latency"`, and renamed "by latency"); the shell deep-link spec still expected ComingSoon for `/runs/<id>` (now expects the run page's `main`). No assertion was weakened.
- `ensureProject` in `e2e/run-detail/seed.ts` swallowed every POST error and fell back to a by-slug GET (404 when the POST had hit a transient SQLite 5xx). It now retries the POST and only falls back on 409.
- Run the suite with `--workers 2` when other agents' servers are active.

## Bundle

`npm run build` (gzip): entry `index-*.js` 120.80 kB; `react` 74.88 kB; `aria` 115.36 kB; `query` 13.21 kB; CSS 18.38 kB. The run-detail feature is not code-split: it is part of the entry chunk (there is no separate run-detail chunk). Splitting it with `lazy()` in `router.tsx` is a follow-up if the entry budget matters.
