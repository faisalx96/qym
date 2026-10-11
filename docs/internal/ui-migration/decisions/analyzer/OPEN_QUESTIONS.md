# Analyzer — decisions made alone (brief 08 §9, brief 05 Q4/Q10)

- 2026-10-11 Q1 compare-page modal: dropped. Compare links to `/projects/:slug/analysis?run=ID`.
- 2026-10-11 Q3 Diagnosis sidebar: shows every catalog category; those without approved examples carry a "Needs examples" badge (they were silently saved before).
- 2026-10-11 Q4 target count: the client filter is ported verbatim into a pure, unit-tested module (no backend change); after a job starts, the server's `progress.total` replaces the client estimate in the status bar.
- 2026-10-11 Q5 polling: kept (job endpoint is the source of truth); 1 s interval, hidden-tab pause via `usePollingInterval`, stops on terminal status; no SSE.
- 2026-10-11 Q6 "Fields:" badges: replaced by "Fields sent" derived from the request config (exact, no regex).
- 2026-10-11 Q7 restore / permanent delete of rule versions: not exposed (no UI today, admin-only route).
- 2026-10-11 Q8 rule token estimate (chars/4): kept as informational text.
- 2026-10-11 Q9 dashboard tab: out of scope; `?scope=dashboard` is treated as `run`.
- 2026-10-11 Q10 footer: plain `--bg-surface` bar with a border, no blur or translucent rgba.
- 2026-10-11 Compare/legacy URLs: `/run/:id/analyzer`, `/projects/:slug/runs/:id/analyzer` redirect to `/projects/:slug/analysis?run=ID` (query kept); wired in router.tsx, not in the run-detail area's code.
- 2026-10-11 Test infra: e2e platform gets `QYM_ALLOW_PRIVATE_LLM_BASE_URLS=true` and a stub OpenAI-compatible server (`frontend/scripts/stub_llm.py`); `QYM_ROLE=api` dropped from the Playwright env (as in ui/overview-runs-list) so job workers run.
