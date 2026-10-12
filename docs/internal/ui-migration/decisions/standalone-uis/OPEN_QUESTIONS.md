# standalone-uis: decisions and open questions

Dated lines; decisions made alone by the component agent.

- 2026-10-11: Open question 1 of brief 10 is decided by the user: keep a local offline SDK viewer, rebuilt lean.
- 2026-10-11: `qym run create` crashed on every call at the foundation commit (`Evaluator.run() got an unexpected keyword argument 'show_progress'`); fixed to `run(show_tui=show_progress and show_table)` because the SDK entry path could not be tested otherwise.
- 2026-10-11: `DashboardServer` (+ `run_dashboard`) removed, not repaired: it served a `_static/dashboard` the SDK no longer ships. Its useful parts (saved-file API + score edit) live on `UIServer`; the listing, compare, delete and heartbeat endpoints had no client and are dropped.
- 2026-10-11: CLI wiring: `qym run create --local-ui [--ui-port N]` (live viewer, held open after the run when stdin is a TTY) and `qym ui [FILE]` (saved csv/xlsx). `live_mode='local'` stays a deprecated no-op (its meaning, "no platform", is orthogonal to showing a viewer). Python API: `EvaluatorConfig(local_ui=True, ui_port=...)`.
- 2026-10-11: `GET api/runs/<path>` now answers 404/400 with `{error}` instead of HTTP 200; only `.csv`/`.xlsx` paths are accepted (both GET and `update_metric`).
- 2026-10-11: `api/run` gains `status` (RUNNING|COMPLETED|STOPPED) and `ended_at` so the client freezes its timer deterministically.
- 2026-10-11: UX decision: `timeline` layout (ribbon + compact list + persistent detail pane). Must-fix list applied: empty score inputs for n/a, labelled Save/Cancel with aria-live status, neutral score colours (dot only), output preview column, collapse/expand for long blocks, ribbon capped at 6.5rem with scroll, skip link, unique keys, sticky header.
- 2026-10-11: Bundle: React 18 as-is, no Preact needed. Measured raw: app.js 170.9 KB + app.css 17.7 KB + index.html 0.6 KB + favicon.svg 0.2 KB = about 189 KB (gzip 56 + 4 KB), under the 300 KB budget. react-aria-components is not imported by the viewer.
- 2026-10-11: No SVG logo exists in the foundation (brand = text wordmark + favicon.png 54 KB); the viewer ships a 240-byte `favicon.svg` and the wordmark as text.
- 2026-10-11: `docs/USER_GUIDE.md` did not exist in this checkout (AGENTS.md still names it); created it with the local-viewer section only. The in-app docs pages (`_static/dashboard/docs/**`, admin-docs area) still describe `--no-ui`/`--ui-port` as the old web UI: left for that branch.
- 2026-10-11: Rows are windowed 200 at a time ("Show N more") instead of a virtualised list; revisit if runs above ~5k rows are common.
- 2026-10-11: CI (`.github/workflows/tests.yml`) builds the SDK wheel without running `npm run build:sdk` (and pins Node 22 while `frontend/` needs 24), so a CI-built wheel has no viewer; `qym ui` then prints how to build it. Needs a pipeline step; not touched here.
- 2026-10-11: `--no-ui` now only hides the terminal table (its help said "Disable local web UI").
