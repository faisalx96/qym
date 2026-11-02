# Compare — analysis (ui/compare)

Walked 2026-10-11 against vanilla `/compare` on port 8803 (SQLite, `QYM_AUTH_MODE=none`),
seed = `frontend/e2e/compare/seed.ts` (`node frontend/scripts/seed-compare.ts <base> <slug>`): 4 aligned
single-pass runs (3 models, task errors, a scorer error), one `samples=3` repeat run, one short run on a
different item set. Screenshots taken with Playwright at 1440x900/1000.

## Confirmed (brief 05 §2/§3 matches the page)

- `runs[]` -> `GET /api/compare?files=..&view=compact` (one request, compact rows, lazy bodies), then a
  `GET /api/runs/step-latency` for the panel. A whole repeat run in `runs[]` becomes one column per pass
  (`columns=passes` is only the table layout switch); the URL is rewritten with `replaceState` (cohort
  links gain empty `cohortALabel=&cohortBLabel=`).
- Page order: run summary cards -> Per-Run Averages (baseline select, "Run average | Each pass" toggle,
  delta +/- band, up/down count buttons) -> Comparison Overview (metric tabs, stats strip, winner bar,
  correct distribution) -> Performance by Category -> Step latency -> Error Distribution -> Root Cause ->
  Item-by-Item (search, Filters, Display, CSV, 20/page, expandable rows, per-run output cards, Trace,
  score pencil, root-cause issues). The scroller is `.compare-container`, not the window.
- Cohort links add the Compare | Sweep segmented control, the "Compare sides" banner and the Sweep view
  (verdict, 5 stat cards with noise, per-metadata table, outcome cards, item table). The Sweep filters
  are not in the URL.
- Item-level alignment is by `compare_item_id` (item id; fingerprint fallback); compact rows have
  `input_preview` only, details come from `POST /api/runs/{id}/items/details`.
- Delta numbers: baseline column shows only the value; others "+17.5 pts +/-15.5" (paired mean diff,
  95% band) with a boxed verdict when beyond noise; the count buttons are items improved/regressed.

## What the brief got wrong / left out

- The brief's "§9 statistics" are not in the brief (§9 is open questions). Math to port lives in
  `compare.html` 9180-9429 (stats), 10598-10665 (paired baseline), 6575-6720/7075-7200 (sweep),
  `metrics.js` 728+ (grouped cohorts); `qym.core.reducers.noise_report` is the reference for noise.
- Run card titles fall back to the run id when `config.run_name` is unset (`run_metadata.run_name` is not
  used): the React labels use the same derivation (`run_name || model . date`).
- Pass refs are `"<id>::pass<N>"` (separator `::pass`, no second "pass"): confirmed in `expandPassRefIds`.
- `/api/compare` already returns `compare_item_id` on every compact row; no server change is needed to
  slice passes client-side, so the pass-aware endpoint is a follow-up, not a prerequisite.
- The sidebar shell here is the legacy one; the React page sits in the foundation shell.

## Behaviours kept

All URL params and both sessionStorage handoffs (read-only, URL wins, never written by the new page except
the label/removal rewrite of the URL); pass refs and whole-repeat-run expansion; 20-run cap (422 message);
missing-runs toast; alignment-warning replacing item sections; remove-a-run (min 2); read-only/locked/
different-data notices; Per-Run Averages with paired baseline stats and count filters; metric tabs with
threshold slider; stats strip, winner bar, correct distribution (over filtered items); category cards;
error distribution; root-cause categories (Sankey dropped for a stacked matrix: Q5); item list with search,
rule builder (`filters` JSON round trip), page-filter chips, Display menu; lazy bodies; output group per
run/pass, trace drawer, copy, score edit, issue editor; pagination + `?item=` scroll-once; Sweep tab with
noise bands; CSV with column picker.

## Dropped / changed

Self-contained HTML export (cannot inline a Vite bundle; link to the legacy page), Auto-Analyze overlay
(per-run links to the analyzer instead, Q4), legacy hidden selects/dropdown editors, `window.prompt`
rename (inline label field), header user-menu dead code, `alert()`. Sweep filters go in the URL
(`sweepMove`, `sweepOutcome`, `sweepQ`, `sweepKey`, `sweepValues`, `sweepReverse`). Heavy math is pure TS in
`lib/` with Vitest; moved to a worker only if a 20-run compare exceeds 50 ms.
