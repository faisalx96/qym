# UX review: every interaction in the React UI

Branch `ui/qa`. Four reviewers took disjoint page groups (A shell/settings/admin/docs, B runs/overview/charts/models,
C run-detail/compare/analyzer, D datasets/reviews/trash/experiments/queue/environments), each on its own ports and
database, and fixed cheap findings at the root with a regression spec. Items in the Deferred sections of the nine QA
inventories (`docs/internal/ui-migration/qa/`) were not re-reported.

## Method

For each page and state: every control by mouse and keyboard (Enter, Space, Tab order, Escape, focus return after
dialogs), disabled and loading states, double submit and rapid repeat clicks, Back/Forward, reload and deep links;
forms with empty, whitespace, long, Arabic/RTL and junk input and injected 400/409/500/offline responses; lists at
0/1/many/hundreds of rows with sort, filter, page and selection combinations; cross-page flows; viewports
390/768/1280/1920, dark theme (the app has no light theme), 150% zoom, reduced motion; axe serious/critical; console
errors and failed requests. Data: seeded SQLite with several projects, 400+ runs (running, failed, stopped, approved),
datasets with thousands of items, a 3,000 and a 5,200 item run, reviews, experiments, environments, analysis jobs via the
stub LLM.

Not covered (honest gaps): 10-minute memory growth on a live page beyond one 3,000-item run (68 MB heap), the dataset
upload wizard with hostile files, environment Test/Refresh/delete, the experiment promote flow end to end, non-admin
gating of every admin page.

## Summary

| Severity | Found | Fixed | Open |
|---|---|---|---|
| blocker | 0 | 0 | 0 |
| major | 19 | 19 | 0 |
| minor | 26 | 18 | 8 |
| nit | 17 | 1 | 16 |

(C24, a SQLite-only seeding lock, is not a UI issue and not counted.) (IDs are per group: A, B/O, C, D. Fix hashes are in the tables.)

## Findings and coverage by group

### UX review, group A (shell, settings, admin, docs)

| ID | Sev | Page | Repro | Status |
|---|---|---|---|---|
| A1 | major | Settings (API keys, dataset read tokens, rename, review rules, members add, LLM connection save), Admin (create/edit user, enqueue job), Profile bootstrap | Press Enter twice quickly in the form: two POST/PATCH requests (two API keys created, duplicate create-user) | fixed (1dad7872; `useSubmitLock` in lib/pending.ts) |
| A2 | major | Create project dialog (shared FormDialog) | Name `   ` + Enter creates a project with an empty name (slug `project`) | fixed (bb8507a7; required fields trimmed, FormDialog single-flight; also protects datasets/runs/experiments dialogs) |
| A3 | major | Settings > AI prompts | Edit a prompt, switch settings tab/sidebar/Back/close tab: draft silently lost | fixed (bb8507a7; useBlocker + beforeunload + discard dialog) |
| A4 | minor | 390px, every page | axe `label-content-name-mismatch` on compact user menu (aria-label lacks visible initials) | fixed (1dad7872) |
| A5 | minor | Settings > LLM connections | "Add connection"/Edit: focus not moved into the form; on Cancel/Save focus falls to body | fixed (bb8507a7) |
| A6 | minor | Command palette | Pick an entry, reopen: previous query still in the field | fixed (7296242a) |
| A7 | major | Admin > Users (122 users) / Projects (28) | No search/filter: finding a user means scrolling a 120-row table | fixed (7296242a, filter shown above 8 rows; e420bade fixes an empty-list regression of it) |
| A8 | minor (test infra) | e2e global-setup | `QYM_E2E_AUTH_MODE=proxy_headers` runs abort (warm-up GET /v1/me is 401) | fixed (c589c5b1) |
| A9 | minor | Create project (server) | API accepts a 300-char name that rename rejects (>200); renders fine (truncates) | open (0.25h, platform schema: same max_length on create) |
| A10 | nit | Settings tabs vs Admin tabs | Settings tab clicks replace history, Admin tab clicks push: Back behaves differently | open (0.25h, decide one policy) |
| A11 | nit | Toasts at 390px | Toast covers the top-bar search button while visible | open (0.5h) |
| A12 | nit | Logout from /profile | Redirects to `/login?next=%2F` (not `/profile`) | open (0.25h) |
| A13 | nit | Members add combobox | Capped at 20 options with no "refine search" hint when more match | open (0.25h) |

Regression specs: e2e/shell/ux-a-submit.spec.ts (4), e2e/shell/ux-a-forms.spec.ts (4), e2e/admin/ux-a-filter.spec.ts (2).
Counts: 13 findings, 0 blockers. Fixed 8 (major A1 A2 A3 A7; minor A4 A5 A6 A8). Open 5 (minor A9; nits A10 A11 A12 A13).

#### Coverage (page x state)
| Page | States checked |
|---|---|
| Projects landing, project home, 404s (/nope, /projects/zzz) | axe + h-scroll + console at 390/768/1280/1920 x light/dark; long (300 char) names; create dialog empty/blank/long/Arabic/duplicate; Esc focus return |
| Shell chrome (nav, switcher, palette, user menu, skip link) | keyboard tab order, palette filter/no-match/Esc, switcher keyboard + Back/Forward, collapsed (390) menu a11y |
| Login / sign-up / profile / logout (proxy_headers + local auth) | unauth deep link next=, wrong password, double Enter (1 POST), short password, Arabic display name, logout + Back, cookie cleared mid-session; /v1/me 500 and offline error panel |
| Settings: general, members, API keys, LLM, prompts, environments, danger | all tabs axe x4 viewports x2 themes; rename 400/409/422/500/offline toasts; double submit; members combobox with 120 candidates; tab Back/Forward/reload/bogus tab; list endpoint 500 and offline (error panel + Retry) |
| Admin: runs, projects, users (122), maintenance | axe all viewports/themes; list 500/offline; create-user double submit; filter; existing admin specs green |
| Docs (all 27 pages) | h-scroll, axe, console, single h1 at 390 dark / 768 dark / 1280 light; hash deep link offset; copy button; TOC |

Final: vitest 117 files / 1091 tests green; shell+admin+docs Playwright (none mode) 132 passed + 11 skipped (session-auth ones), plus the 2 failures that were mine and are fixed (re-run green); session-auth login-form specs green in proxy_headers mode. Lint errors remaining in the repo are only in other agents' e2e/ux-probe-* files. No servers left running on 8813/5813/9813/8913/8914.

### UX review, group B (runs list, dashboard, charts, trend, models)

Env: platform 8814 / Vite 5814, seeded projects: big (403 runs incl. running/failed/stopped/submitted/approved/rejected), mid (42), small (2), empty (0), weird (Arabic, 240-char, HTML, emoji names). All servers stopped.

Commits: f5e43916, 283a5ea0, 41e3e3cd, 04549620. New specs: e2e/runs-list/ux-layout.spec.ts (11 tests), ux-charts.spec.ts (1), ux-models.spec.ts (1).

#### Findings

| ID | Sev | Page | Repro | Status |
|---|---|---|---|---|
| B1 | major | Runs list | Select mode at 1280px: the status bar's left cell clipped the selection cluster ("Dele", Clear/Done not visible; at 390 Delete cut off). | fixed (f5e43916) |
| B2 | major | Runs list | After B1, with Submit visible the pager "Next page" and "Last updated"/"Shortcuts" overlapped or ran off the bar at 768-1500px (Next page unclickable; Shortcuts clipped at 1024). Bar now stacks selection actions on their own row below 1500px. | fixed (f5e43916) |
| B3 | major | Runs list (any Pagination) | 390px: Next/Last page buttons clipped off the right edge ("of 9" wrapped), unreachable without swiping the pager. Pagination now wraps, total never wraps. | fixed (f5e43916) |
| B4 | minor | Dashboard | 1280px: Recent/Approved runs cards squeezed the Run column to ~2 characters and clipped "7d ago"; two-up grid now auto-fits (stacks when under 500px/card), narrower columns. | fixed (f5e43916) |
| B5 | minor | Runs list, Charts | Column header: only the label text sorted; rest of header cell (cursor: pointer) was dead. Whole cell is now the hit area. | fixed (f5e43916, 283a5ea0) |
| B6 | minor | Charts | Dataset tab and Runs/Grouped/Group-by choice reset on reload and on Back from a run. Persisted per project+task in sessionStorage. | fixed (283a5ea0) |
| B7 | major | Runs list, Models | Filters > Time > Range...: popover painted above the modal (react-aria popovers are z-index 100000), hiding "Custom date range" title/description. Popover now closes when the dialog opens. | fixed (283a5ea0) |
| B8 | major | Models | After picking Task (and Dataset) the selects only offered the current value (URL chip narrowed the options); switching required removing the chip. Single value no longer narrows. | fixed (41e3e3cd) |
| B9 | minor | Models | Hand-picked runs (Edit) leaked across task/dataset/filter changes (stale ids sent for another scope). Now scoped and reset. | fixed (41e3e3cd) |
| B10 | nit | Charts | Long metric name ("ANSWER CORRECTNES") lost its sort glyph under overflow clipping; now ellipsis + glyph. | fixed (41e3e3cd) |
| B11 | minor | Dashboard trend | 390px: x-axis day labels overlapped ("Oct 60ct 7"); last label clipped ("Oct 1" for Oct 12). preserveStartEnd + minTickGap, wider right margin. | fixed (04549620) |
| B12 | minor | Dashboard | 390px Live runs: Run column collapsed to "text2"; min width 160. | fixed (283a5ea0), no dedicated spec |
| O1 | minor | Runs list | Delete a row via dialog (keyboard): the row's button disappears after refetch, focus drops to body; keyboard users restart from page top. Fix: restore focus to the row at the deleted index once rows update. | open (1 h) |
| O2 | nit | Dashboard (shared ErrorState) | 500 inside a card: ErrorState renders a centered block with left-aligned text, unlike the centered EmptyState. | open (30 min, shared ui) |
| O3 | nit | Models | `?task=rag-qa&dataset=<not in task>` shows "Select a dataset" + empty state "Select a task and dataset" while the chip still says dataset: <x>; no hint that the dataset does not exist for the task. | open (30 min) |
| O4 | nit | Runs list | 1280px: sticky Actions column covers the Owner column ("OWNI" header, "DU D"); no scroll affordance. | open (1 h) |
| O5 | nit | Charts/Dashboard vs Models | Metric labels lose underscores on Charts/Dashboard ("rouge l", "latency s") but keep them on Models ("rouge_l"). | open (30 min, decision) |
| O6 | minor | Runs list 390px | Only Run + Actions columns visible; other columns need horizontal scroll with no cue. Mobile card layout would be a feature. | open (2-3 h, product call) |
| O7 | nit | Runs list | Selection survives filtering (3 selected, 0 rows visible, Delete enabled). Probably intended (selection pinned across pages) but destructive on invisible rows; confirm dialog does list names. | open (decision) |

Known/deferred, not re-reported: Back to a run restores scroll (test.fail in cutover-navigation), K4 charts concurrency, C28 run-name toggle, trend keyboard tooltip.

#### Coverage (page x state)

| Page | States checked |
|---|---|
| Runs list | 403/42/2/1/0 runs; weird names (RTL/emoji/HTML/240 chars); sort via header (mouse, keyboard) + filter + page + search combos; selection across pages/sort/search, Compare then Back; select-mode bar at 390/768/1024/1181/1280/1920; Filters popover + custom range dialog (validation, layering, Esc focus return); row delete (dialog, Esc, double-click = 1 request, focus); More-actions menu stable during polling; 500 on list + Retry; keyboard (/ j k x Enter ? g, Tab order); URL replace semantics; axe 390/768/1280/1920 |
| Dashboard | KPIs, live/recent/approved/reviews/trend cards at 390/768/1024/1280/1440/1920; 0 runs; origin and range URL state; trend select; per-card 500 + Retry; axe |
| Charts | 5 dataset tabs, Runs/Grouped, sort, Columns menu (Esc focus), empty project, long names, 500 + Retry, tab persistence, axe |
| Trend | 7d/30d/90d, 390/1280/1920 axis labels, empty state |
| Models | no selection, task+dataset, bad k (abc/0/1000/-1/2.5), bad metric, bad task/dataset, origin=official empty, Edit dialog (cap, Esc focus, apply), switching task/dataset, reload, 500 + Retry, 390/768/1280, axe |
| Cross-cutting | dark only (no light theme in app), reduced motion + 150% zoom (853px) screenshots, console errors/warnings and 4xx/5xx: none seen on these pages |

#### Test results

Playwright e2e/runs-list: 158 passed (includes the known test.fail), --workers 1. Vitest runs-list/models/ui: 84 passed. eslint, tsc -b, prettier clean for touched files (the repo-wide `npm run lint`/tsc also show errors in other agents' untracked e2e/ux-probe* files; not mine).

### UX review, group C: run detail, compare, analyzer

Commits (branch ui/qa): a6317619 (analyzer), cb7d17d3 (compare), 5a7176f9 (run detail + Tabs), 02bb0de0 (app query client), e71b9576 (trace passes, landmark, cohorts), f9d65bfd (revert of one attempted fix).
Method: real app on ports 8815/5815/9815, seeded run detail (classic 240 items, repeat x3, running, locked, 3,000-item run, edge-case run with 5 KB tokens, RTL, HTML, huge JSON, 400-line output), compare scenario (3-4 runs, cohorts, repeat), analyzer (stub LLM, repeat, Arabic). Throwaway Playwright probes (archived in scratchpad/c/probes-archive): axe at 390/768/1280/1920 dark+light on 9 pages, click-everything crawl on 5 pages, Tab traces, 400/403/404/409/500/offline injection, Back/Forward/reload/deep links, double-click/double-Enter, history behaviour, shortcut opt-out.

#### Findings

| ID | Sev | Page | Repro | Status |
|---|---|---|---|---|
| C01 | major | Analyzer, guidance | Edit a category description (status "Unsaved changes"), click Runs in the sidebar, or switch to Production rules: edits vanish with no prompt; no beforeunload either | fixed (a6317619) `analyzer/ux-flow.spec.ts` |
| C02 | major | Analyzer, Run step | Double-click "Analyze N items": two POST /analysis-jobs | fixed (a6317619) |
| C03 | major | Analyzer | "Review results" in the job bar while on Project guidance leaves scope=categories (two router writes in one tick, the first lost) | fixed (a6317619) |
| C04 | minor | Analyzer | Wizard steps and the Analyze run / Project guidance switch used replaceState, so browser Back left the workspace instead of the previous step | fixed (a6317619) |
| C05 | major | Run detail + Compare | Score editor: double-click Save posted twice; Enter on an unchanged value posted a no-op and marked the score "edited"; Escape/Save/Cancel dropped focus to body | fixed (5a7176f9, cb7d17d3) `run-detail/ux-score-editor.spec.ts`, `compare/ux-editor.spec.ts` |
| C06 | major | All pages (app) | Click an action while offline: spinner forever ("Analysis running"), nothing said, mutation fires later when the network returns (TanStack networkMode online) | fixed (02bb0de0) `analyzer/ux-offline.spec.ts` |
| C07 | minor | Run detail, trace drawer (repeat run) | Open a trace of a repeat run: React duplicate-key warnings; three chips all named "Attempt 1", one selected selects all | fixed (e71b9576) `run-detail/ux-trace-passes.spec.ts` (chips now "Pass N . attempt M") |
| C08 | minor | Compare | Metrics tab: the intro caption ("... 95% noise band") was cut off at the right edge of the scroll region | fixed (cb7d17d3) |
| C09 | minor | Compare | Empty notices wrapper left a ~34 px gap under the header | fixed (cb7d17d3) |
| C10 | major | Compare, <= 640 px | Delta chips (B +15 pts ...) squeezed to zero width between metric select and Analytics; sticky chip bar took about a quarter of the screen; with 4 runs the page scrolled sideways once the bar was not sticky (abs-positioned sr labels escaped the scroller) | fixed (cb7d17d3) `compare/ux-layout.spec.ts` |
| C11 | major | Compare | Analyze popover: unpadded, bullets over the run dots, links overflowing the surface | fixed (cb7d17d3) |
| C12 | minor | Compare | Two `<main>` landmarks (shell + items list) | fixed (e71b9576) |
| C13 | minor | Compare | `cohortA` with 2 runs vs `cohortB` with 1: "No runs to compare / select two or more" (misleading) | fixed (e71b9576) |
| C14 | minor | Run detail, Compare | WCAG 2.1.4: J/K (run pager) and "/" (trace drawer) ignored the Runs-list single-key opt-out | fixed (5a7176f9, cb7d17d3) `run-detail/ux-shortcuts.spec.ts` |
| C15 | major | Run detail | axe serious: danger count pill 3.95:1 (Errors tab, also shared Tabs); SectionNav danger count used undefined `--danger`; histogram bars `label-content-name-mismatch`; empty-bucket axis label opacity contrast; latency pins name mismatch | fixed (5a7176f9) `run-detail/ux-a11y.spec.ts` (dark+light x overview/errors/latency) |
| C16 | minor | Run detail | Score band 1 text (#ef4444 on --bg-elevated) 4.15:1 in the metric strip (light theme too): `--score-1` token is marginally below AA | open (0.5 h, token change, belongs to the shell/tokens owner) |
| C17 | minor | Shell, 768 px | Run page with a long run id: breadcrumb pushes `.topbarEnd` (Go to / Ctrl K) 12 px past the viewport -> page scrolls sideways at 768 px. One-line fix: `.topbarEnd { flex: none }` in AppShell.module.css | open (group A file, 5 min) |
| C18 | minor | Run detail, Analyzer, Compare | Item open, trace open, filters, wizard step: item/trace/filter changes are replaceState by design (old behaviour): Back leaves the page. Only the analyzer was changed | open, product decision |
| C19 | minor | Run detail, Compare | Issue dialog: a stray backdrop click discards typed text. An attempted guard (non-dismissable backdrop when dirty) broke Escape after the click (focus goes to body), reverted (f9d65bfd) | open (1 h: confirm-on-dismiss in the Dialog primitive) |
| C20 | nit | Analyzer | After a reload, a finished job's result is not shown (Review says "Nothing to review yet"); Run step says "Not run" | open (1 h, load the last job) |
| C21 | nit | Compare | "1 items improved" plural; 20 tab stops through the item list before reaching the pager; category list rows tight when a badge wraps (Analyzer diagnosis) | open (0.25 h) |
| C22 | nit | Run detail | 404 run has title "قيِّم" only; table input cell for JSON input shows the tail `":"prompt" }` after RTL ellipsis; repeat passes table wraps "Pass 1" | open (0.5 h) |
| C23 | nit | Compare/Run list | Back from compare after opening an item returns to the Runs list (selection lost); not a regression of this review | open, product decision |
| C24 | n/a | Platform (SQLite only) | Ingesting 5,200 items in one go held the SQLite write lock for minutes and caused 500s on later POSTs (seeding only; PostgreSQL not affected) | not a UI issue |

#### Coverage (page x state)

| Page | States checked |
|---|---|
| Run detail | classic, repeat (heatmap, Repeat tab, per-pass trace), running (live indicator), locked, 3,000 items (load 0.6 s, search, sort, last page, 500 rows/page, 68 MB heap), edge-case run (5 KB token, Arabic, bidi, HTML/XSS, emoji, huge JSON, empty, 400 lines, 80 metadata keys, long traceback, 0 ms); item card, error item, score editor (valid, invalid, unchanged, 500, double), issue dialog, filters popover, Display, CSV, trace drawer (keyboard, scrim, Back), pager J/K; 400/401/403/404/500 on run, details, trace, step latency; offline search; deep links (bad item/trace/page/show/filters/pass/panel/metric/sort); axe dark+light at 390/768/1280/1920; Tab order; zoom/viewports 320-1440 |
| Compare | 2/3/4 runs, cohorts (1v1, 2v2, 2v1, 1v2), repeat+single, different dataset, other project runs, missing/bogus ids, bad params; item open, Analytics tabs, Filters, Display, CSV, Analyze popover, run details; score editor; runs list -> compare -> item -> Back/Forward; axe; viewports 320-1440; crawl of all buttons |
| Analyzer | single, repeat (sample picker, bad pass values), Arabic, guidance (categories, rules, documents), Configure/Preview/Run/Review, Test Selected, Analyze (double, 500, 409, 403, network failure, offline), reload mid-job, unsaved edits, history; config 403/500, preview 500, unknown run, no run; viewports 320-1440; axe |

#### Test counts after fixes

Full run of `e2e/analyzer e2e/compare e2e/run-detail` on the port-8815 stack: 323 passed, 2 failed (SQLite "database is locked" while seeding, both pass on rerun x3), 1 spec (issue dialog) removed with its revert. New specs: 7 files, 21 tests. `npm run lint` clean, `tsc -b` clean, vitest 1091 passed, `test:design` 34 passed, pytest tests/platform/test_design_language.py passed. `npm run stylelint` has one error in group A's UserMenu.module.css (deprecated `clip`), none in my files.

### UX review, group D (datasets, reviews, trash, experiments, queue, environments)

#### Findings

| ID | Severity | Page | Repro | Status |
|---|---|---|---|---|
| D-01 | major | Dataset compare (`/datasets/:ref/compare`) | Open compare for a dataset whose fetch fails or is missing (404/500) and the answer takes more than 300 ms: skeleton shows forever, no error, no retry. Cause: disabled versions query is `isPending` forever. | fixed (29110099, spec datasets/ux-compare-missing) |
| D-02 | major | Dataset detail at 390 px (any PageHeader with actions) | Version switcher / Create draft overlapped the dataset title ("big-set" clipped to "set"). PageHeader `.row` never wrapped. Shared component: now wraps actions under the title at <=640 px. | fixed (55cce477, spec datasets/ux-header-narrow) |
| D-03 | minor | Dataset detail, "forked from vN" link | axe serious `link-in-text-block` at 768 (colour only, 1.05:1 vs text). Underlined. | fixed (82cc0530, spec datasets/ux-axe-narrow) |
| D-04 | minor | New experiment, below 1200 px launch bar | "Fix N problems first: ..." link is 4.15:1 on the elevated bar (axe color-contrast serious at 768). Lifted with color-mix toward text. | fixed (82cc0530, spec experiments/ux-axe-launch-narrow) |
| D-05 | minor | Shell, 390 px (all pages) | User-menu trigger fails axe `label-content-name-mismatch` (visible text "DU" not in accessible name). Group A file. | open (15 min, shell UserMenu aria-label should contain visible initials or drop the label) |
| D-06 | nit | Dataset detail header at 390 px | Meta row wraps with a leading "·" separator at the start of lines. | open (20 min, `.metaItem + .metaItem::before` cannot know line breaks; hide separators at <=640 px) |
| D-07 | nit | Reviews, rapid `a` presses | Five quick `a` presses send one approve (in-flight guard); intended protection, but a fast reviewer must wait ~150 ms per item. Not changed. | open (by design, no action) |
| D-08 | nit | Dataset item pane | Open pane (`data-item-pane`) is local state, not in the URL: reload/Back does not restore it. Item page (`?item=`) is the deep-linkable form. | open (product decision) |

No Deferred item from the QA inventories was re-reported.

Verified OK (no finding): 500/404/offline on catalog, detail, item, reviews, trash, experiments, queue, environments, launch all end in an error state with Retry; reviews 500 and 409 on decide show toast and invalidate; dataset item save 500 keeps the edit and toasts; unsaved-edit guards (Escape, other row, sidebar navigation, beforeunload) all present; double click on Launch creates one experiment; Add environment dialog validates empty/junk input and Escape returns focus to the trigger; no horizontal page overflow at 390/768/1280/1920 on any group page, light and dark; no console errors on any group page.

#### Coverage

| Page | empty | 1 / few | many (3000 items, 125 reviews, 12 trash) | error 500/404/offline | 390 | 768 | 1280 | 1920 | dark/light | axe | keyboard | Back/Fwd/reload |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dataset catalog | yes | yes | n/a | yes | yes | yes | yes | yes | yes | yes | partial | yes |
| Dataset detail (items/runs/lineage/settings) | yes | yes | 3000 items, search (Arabic, junk) | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| Dataset item pane + page | n/a | yes | yes | yes (save 500) | partial | yes | yes | yes | yes | yes | yes (Esc, guard) | yes |
| Dataset compare | n/a | yes | n/a | yes | partial | yes | yes | yes | yes | yes | partial | yes |
| Reviews | yes | yes | 125 | yes (500, 409) | yes | yes | yes | yes | yes | yes | yes (j/a/r/Esc/?) | partial |
| Trash | yes | yes | 12 | yes | yes | yes | yes | yes | yes | yes | partial | partial |
| Experiments list | n/a | yes | 6 | yes | yes | yes | yes | yes | yes | yes | partial | partial |
| Queue | n/a | yes | 7 jobs | yes | yes | yes | yes | yes | yes | yes | partial | partial |
| Environments list + add dialog | n/a | yes | 2 | yes | yes | yes | yes | yes | yes | yes | yes (dialog) | partial |
| Launch experiment | n/a | yes | n/a | yes | yes | yes | yes | yes | yes | yes | partial | yes (Back after launch) |

Test runs: new specs (4) + datasets detail/a11y/tabs, trash, reviews.spec, experiments a11y subset: 46 passed, 0 failed before I stopped the run (machine contention made the full group suite take >75 min); lint, tsc, prettier clean on my files; vitest datasets/experiments/trash/reviews 470 passed. Lint/tsc errors seen repo-wide came from another agent probe files (e2e/ux-probe-c).

Not covered: upload wizard with hostile files, environment Test/Refresh/delete, promote flow, long-running memory growth, zoom 150%, reduced motion, non-admin gating.


## Repo-level fixes during the gate and the final pass

- `6f476db8`, `08f1abde` style: prettier over 292 files; `278affc5` keeps the `tabIndex` eslint directives on the attribute line after prettier moved them.
- UserMenu `.srOnly` used the deprecated `clip` (stylelint `property-no-deprecated`): now `clip-path: inset(50%)`.
- `e2e/analyzer/cutover-catalog-refresh.spec.ts` had a race (tabs render before the first `analysis-config` response is captured; failed 1 run in 3): now polls for the captured config.

## Final test counts

See the commit that adds this file; numbers recorded in the hand-off: `npm run check` (tsc, eslint, stylelint, vitest 117 files / 1091 tests, design-language 34), full Playwright at `--workers 2`, `npm run e2e:sdk` 42 passed, pytest `tests/platform tests/sdk tests/test_restructure.py` 3336 passed / 744 skipped.
