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
