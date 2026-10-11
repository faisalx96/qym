# overview-runs-list — decisions taken alone

Each line: date · question (brief 03 §9 number when it applies) · decision · why.

- 2026-10-11 · foundation gap · `frontend/src/lib/` was not committed on `ui/foundation` (repo `.gitignore` `lib/` pattern). Copied from the foundation worktree and added `!frontend/src/lib/` to `.gitignore` on this branch. Reviewer: apply the same fix to `ui/foundation`.
- 2026-10-11 · foundation gap · `frontend/playwright.config.ts` started the platform with `QYM_ROLE=api`, which disables the dashboard summary worker, so `/api/dashboard/*` never lists runs in e2e. Dropped `QYM_ROLE=api` (the default `all` runs the loops in-process).
- 2026-10-11 · §9.1 · Versioning-metadata filters move into the URL as repeated `v.<key>=<value>` params (same multi-select semantics, `__none__`/`__empty__` allowed). Column visibility stays in sessionStorage (`qym_visible_metrics`, same shape) and chart sort/group/tab stay in memory: they are presentation, not the view. `runs_order.ts` keeps the legacy context keys only, so the run page order ignores versioning filters exactly as today (latent bug kept for compatibility; fix belongs to brief 04 + backend).
- 2026-10-11 · §9.2 · The URL is the only source of truth for the view. The "bare URL restores the tab's last filters" rule is dropped: a sidebar click shows the default view. Reason: the rule was the top pain point in §7 (silent re-application of old filters) and the sessionStorage copy cannot be shared or bookmarked.
- 2026-10-11 · §9.3 · Keep client collation (ported `runs_order.ts` with the same `localeCompare` rules); the run page and `test_runs_order_js.py` depend on the wire format. Server-side collation is a backend change out of scope.
- 2026-10-11 · §9.4 · Frozen columns: no measurement code. The Run column is `position: sticky` (CSS only); the "Frozen columns" section of the Columns menu is dropped. `qym:runs-frozen-columns` is no longer read.
- 2026-10-11 · §9.5 · Grid/Timeline views and the legacy `/api/runs` full-fetch path are not ported.
- 2026-10-11 · §9.6 · `insights.js` is not revived; the backend route is left for a later cleanup.
- 2026-10-11 · §9.7 · Model colours: an ordered 12-hue categorical palette built by the design agent with the `dataviz` skill, indexed by `chart_data.modelIndex` (server order by frequency) so Runs, Charts and (later) Models/Compare agree; beyond 12 the hue wraps and a different marker shape is added in the legend.
- 2026-10-11 · §9.8 · Overview polls with one TanStack interval derived from the data: 10 s while any live run or `freshness.updating`, else 60 s, never while hidden. No whole-page reload.
- 2026-10-11 · §9.9 · Pinned off-page selected rows keep the `ids` round trip (≤100 per call); the selection stores only run ids and pass refs.
- 2026-10-11 · §9.10 · `__none__`, `__empty__`, `|||plain|reasoning` sentinels stay in URLs (bookmarks, run page, tests) but are isolated in `features/runs-list/urlState.ts`.
- 2026-10-11 · §9.11 · One toast system: the shell `useToast()` (top-right).
- 2026-10-11 · charts library · Recharts 3.10.1 pinned (exact) for the Overview trend (line + run bars, accessibilityLayer); the Charts page keeps plain-div mini bars (the brief allows it; no axes needed, keeps the table semantics).
- 2026-10-11 · seeding · `frontend/scripts/seed_runs.py` (stdlib, API only) and `e2e/helpers.ts seedRuns()` push runs through `/v1/runs` + `/v1/runs/{id}/events`; official-origin runs need an experiment launch token and are not seeded (the Origin filter is still exercised with `local`).
- 2026-10-11 · foundation gap · `frontend/playwright.config.ts` hardcoded `<repo>/.venv/bin/python`, which a worktree does not have. It now honours `QYM_PYTHON`, then the repo venv, then the active `python`.
