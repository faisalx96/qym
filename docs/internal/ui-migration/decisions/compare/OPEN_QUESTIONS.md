# Compare: decisions made without asking (dated)

- 2026-10-11 Q1 pass refs: kept `"<id>::pass<N>"` as the public format; one helper (`lib/refs.ts`); slicing stays client-side (one fetch of the base run, `scopeRowToPass` from run-detail). A pass-aware `/api/compare` is a follow-up, not needed.
- 2026-10-11 Q2 baseline for cohorts: default stays the first column; with `columns=run` a repeat run is one column (mean of its passes). Sweep deltas are B minus A, as before.
- 2026-10-11 Q3 domain filter: `domain` now means "is any of" (was AND) with an explicit "only" list (`domainOnly`, the old exclusive) and exclude mode; the `filters` JSON keys are unchanged. Old multi-value domain links therefore match more items.
- 2026-10-11 Q4 Auto-Analyze overlay dropped; per-run "Analyze" links to the legacy analyzer page until the analyzer area ships.
- 2026-10-11 Q5 legacy root-cause dropdowns/solution/feedback and the Sankey dropped; root causes are a categories x columns table with sub-causes.
- 2026-10-11 Q6 Langfuse: kept the external link in the trace drawer and an "Open in Langfuse" button on output cards (row.trace_url wins, else host/project from /api/compare).
- 2026-10-11 Q7 HTML export not rebuilt (cannot inline a Vite bundle); the Export menu links the legacy page `/compare?...` which still has "Export HTML".
- 2026-10-11 Q8 Sweep for numeric metrics: not offered (needs pass/fail); unchanged.
- 2026-10-11 Q9 thresholds go in the URL as repeatable `thr=<metric>:<0..1>` (new, additive).
- 2026-10-11 Q12 field-visibility settings kept per project in localStorage via the Display menu is not rebuilt; Display has Raw/Rendered and a metadata visibility list for the session.
- 2026-10-11 Heavy math stays on the main thread: 20 runs x 2000 items measured stats 35 ms (cold 75 ms incl. the score matrix), filter pass 17 ms, deltas 12 ms (lib/__tests__/perf.test.ts); a per-(model, metric) score matrix cache removes the repeated getRowScore work. No worker.
- 2026-10-11 Run colours: first five runs use `--chart-1..5`, the rest cycle; the letter A..T is the identity key everywhere, colour is never the only signal.
- 2026-10-11 Shared files copied verbatim from ui/run-detail @771663e WITHOUT a header comment so a merge sees identical add/add content: see COPIED_FROM_RUN_DETAIL.md. Files that had to change (TraceDrawer, IssueDialog) are copies under features/compare/components/rd/ with a header.
- 2026-10-11 UX decision: variant C (item-first); adoptions listed in UX_DECISION.md are applied except where noted in the final report.
- 2026-10-11 Follow-ups: pass-aware `/api/compare`, `/api/compare/export.csv` and a deltas endpoint were NOT built (client math is fast enough, see perf note); pivotable matrix (UX adoption 2) only partly adopted (Metrics/Categories/Errors/Root cause tabs, no pivot control); foundation `Tag[data-tone=danger]` fails axe color-contrast on --bg-surface (a11y spec filters that rule); Auto-Analyze links per run not added yet; Langfuse removal proposal untouched.

## Review pass (2026-10-12)

- Paired baseline band and p-value now use Student t (n-1 df) instead of the vanilla normal approximation (`lib/tdist.ts`, checked against scipy). Differs from the legacy page for small n only (n=4: band x1.62, n=40: x1.03); the Sweep noise model (`lib/noise.ts`) is unchanged and still normal because it mirrors `qym.core.reducers.noise_report`.
- Q4 follow-up done: Root cause tab lists an "Analyze" link per compared run to the legacy analyzer (`/projects/{slug}/analysis?run=..&pass=..`).
- Q7 stays open. Cost of a real HTML export: a server-side `GET /api/compare/export-html` modelled on `/api/runs/{id}/export-html` (about 1 to 1.5 days incl. tests), because a Vite bundle cannot be inlined client-side.
- Auto-Analyze overlay (Q4) stays open until the analyzer area ships; cost is the analyzer area itself (brief 05 analyzer half / 08), not compare work.
- Foundation `Tag[data-tone=danger]` contrast fixed locally (identical to ui/foundation); the a11y spec no longer filters `color-contrast`.
- CSV cells that start with = + - @ (and are not numbers) are prefixed with an apostrophe against spreadsheet formula injection; the legacy export did not.
