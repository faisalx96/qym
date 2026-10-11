# standalone-uis: decisions and open questions

Dated lines; decisions made alone by the component agent.

- 2026-10-11: Open question 1 of brief 10 is decided by the user: keep a local offline SDK viewer, rebuilt lean.
- 2026-10-11: `qym run create` crashed on every call at the foundation commit (`Evaluator.run() got an unexpected keyword argument 'show_progress'`); fixed to `run(show_tui=show_progress and show_table)` because the SDK entry path could not be tested otherwise.
- 2026-10-11: `DashboardServer` (+ `run_dashboard`) removed, not repaired: it served a `_static/dashboard` the SDK no longer ships. Its useful parts (saved-file API + score edit) live on `UIServer`; the listing, compare, delete and heartbeat endpoints had no client and are dropped.
- 2026-10-11: CLI wiring: `qym run create --local-ui [--ui-port N]` (live viewer, held open after the run when stdin is a TTY) and `qym ui [FILE]` (saved csv/xlsx). `live_mode='local'` stays a deprecated no-op (its meaning, "no platform", is orthogonal to showing a viewer). Python API: `EvaluatorConfig(local_ui=True, ui_port=...)`.
- 2026-10-11: `GET api/runs/<path>` now answers 404/400 with `{error}` instead of HTTP 200; only `.csv`/`.xlsx` paths are accepted (both GET and `update_metric`).
- 2026-10-11: `api/run` gains `status` (RUNNING|COMPLETED|STOPPED) and `ended_at` so the client freezes its timer deterministically.
