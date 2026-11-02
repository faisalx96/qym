# Final consolidated review of round 2 (whole app)

Branch `ui/final-review` = merged `UI-redesign` tip `b4c21515`. Reviewed against both feedback rounds, in the running app
(platform 8941 / Vite 5941, fake Evaluation Services 9041/9042, stub LLM 9941; legacy reference on 8943 for the report
pages). Evidence is in the orchestrator scratchpad `fr/shots/` (names are given per point below), probe scripts in `fr/*.mjs`.

Seeds: 400-run `demo` project (+1 running, 2 repeat runs), `rd-seed` (classic 240-item run, repeat run, Arabic
multi-pass run, 300-item 5-key many-categories run), `cmp8` (9 aligned runs, cohort and sweep), `big` (5,200-item run,
2,746 items delivered before the ingest went stale, so it is a "stopped" run), `exp-demo2` (2 environments against the
fakes, 4 experiments, a 30-item `golden` dataset).

## Verdict

**The merged app meets the standard of both rounds.** 16 of 18 feedback points are met (several with an open polish item) and
2 are partly met (Arabic key placement, "interactive instead of static"). No blocker and
no feature regression found. Three things are real and cheap: one real pytest failure that only exists on the merged tip
(neither branch could see it), two serious axe violations on the repeat panel, and three 390 px overflows.

**A fix pass is recommended before the colour and typeface pass starts**, not because anything is broken, but because
the cross-area inconsistencies (section 3: run identity, heading scale, sticky bar heights, card recipes) are exactly the
things a colour/typeface pass restyles; doing it over four divergent recipes will either bake the differences in or
turn into a second per-page pass. Estimated size: about one day (items F1 to F12 below; F13 onward can ride along).

## 1. Feedback points

Screenshots are `fr/shots/<name>.png` (1440 unless stated).

### Round 1

| # | Point | Verdict | Evidence and note |
|---|---|---|---|
| R1-1 | Tables too simplistic / not friendly | **Met** | `runs-1440`, `runs-columns`, `runs-passes`, `cw-p4-1440-s1`, `ds-detail`, `exp-list-1440`, `admin-runs-1440`. One `DataTable` recipe: band header, sticky header, density and column menu, footer count and pager, row actions, expandable rows, phone card mode (`m1`). Open: clickable rows without a hover state on the experiments list and dataset items (F7). |
| R1-2 | Analysis page cluttered and not smooth | **Met** | `analysis-1440`, `m4`. One page: setup, targets, always-visible action bar; no wizard chrome. Open: analysis controls have no hover (F7); input preview in the target list shows raw JSON and bidi-scrambles Arabic. |
| R1-3 | Experiment creation lost the simple home and the smooth per-section transition | **Met** | `ex-home-1440` (tick environment, type name, Launch as is; versions card with agent, image and kb), `ex-step0-1440`, `ex-step3-1440`, `ex-step5-1440` (six-segment rail, Back / Continue / Skip to review, review rail beside the steps, raw JSON hidden behind a button). Open: wide config tables are clipped by the review rail (F9). |
| R1-4 | Run detail, compare and cohort too simple; want report style, quick-filter sidebar only when items are chosen | **Met** | `rdw-classic-1440-s1..s5` (every section full width, stacked), `scope-open/active-1440` (Quick filters rail appears only with a scope, "Filters (1)" + "Clear (1)"), `cw-p4-1440-s*`, `cw-cohort-1440-s0`, `cw-sweep-1440-s0`. Open: the run header is about three times the legacy height (F4). |

### Round 2

| # | Point | Verdict | Evidence and note |
|---|---|---|---|
| R2-runs-1 | Filters presented directly, not behind a Filters button | **Met** | `runs-1440`: six facet triggers inline with their values; `runs-filter-390` opens a drawer on a phone (acceptable). |
| R2-runs-2 | User can change column order and frozen columns | **Met** | `runs-columns`: search, All / None / Reset layout, "Frozen (2)" and "Scrolling columns" groups, drag handles, pin per row; header menu and keyboard reorder. |
| R2-runs-3 | Passes analysis cluttered | **Met** | `runs-passes`: one header line, five stat tiles in one row, threshold chip, table with the Analyze column visible at 1440. |
| R2-rd-1 | Grey boxes not friendly | **Met** | `item-classic-1440`, `item-arabic-1440`: Input / Expected / Output are flat sections with one status rail; no nested filled boxes in the item. (The wizard still nests four bordered levels, F9.) |
| R2-rd-2 | Repeat run analysis unclear | **Met** | `rdw-repeat-1440-s1/s2`: verdict line, three labelled stat groups, curve, "always fail / always pass" distribution, per-pass table with best / worst. Open: two serious axe violations (F2); the repeat blocks stop at 1311 px while the rest of the report runs to 1405 px. |
| R2-rd-3 | Trace steps collapsed by default | **Met** | `rdw-classic-1440-s2`: Agent and Eval rows start collapsed with Expand all / Collapse all and search. |
| R2-rd-4 | Deep analysis one visual per row | **Met** | `rdw-classic-1440-s2/s3`: correlation matrix, then the relationship scatter, each full width. Open: this scatter is single-colour grey while the latency scatter above it is pass / fail coloured (F11). |
| R2-rd-5 | Categories overwhelming | **Met** | `nav-many-Categories-1440`: key chips with counts (5 keys, 24 values), one key at a time, top 8 and "Show all 24 values", rank-by control. |
| R2-rd-6a | Arabic input with multi passes ends up far right | **Partly** | `item-arabic-1440`: the three pass columns now read well inside their own cards, but in RTL values the key header sits at the far right edge of the row (EXPECTED OUTPUT label at left, "ANSWER" label and value at x about 1300), while CONTEXT, TOPICS and LANG keys of the same item sit left. A reader still travels about 900 px from the section label to the value (F5). Same on the classic item's "PROMPT" key (`item-classic-1440`). |
| R2-rd-6b | JSON output split per key into sections | **Met** | `item-classic-1440`: ANSWER, CITATIONS as a table, Sections / Raw toggle. |
| R2-rd-7 | Metric-chosen item UI not friendly, refer to old design | **Met** | `item-classic-1440-metric`: clicking a metric chip opens its REASON panel under the chip row, with the edit pencil and root cause below. The legacy item panel was not diffed again in this pass; the per-branch review did. |
| R2-traces | Viewing traces for items not friendly | **Met** | `trace-classic-1440`: summary pills, filter, span tree with duration bars and kind icons, detail with Input / Output, Metrics, Raw tabs; keyboard: Enter opens, Escape closes and focus returns to the Trace button. |
| R2-compare | Compare page highly unfriendly | **Met** | `cw-p4-1440-s0..s4`, `cw-p8-1440-s0`, `leg-cmp-0` (legacy): run cards with colour rails, averages as a metric by run matrix with deltas and noise bands, category cards with baseline tick, error cards, aligned item matrix. At 8 runs the cards become one-line rows. Open: fixes F8, F12. |
| R2-general | Feel interactive instead of static single colours | **Partly** | Charts, chips and bars now carry tone and dim siblings, and the runs, run-detail and compare surfaces are covered by the strict hover audit. My wider hover probe (all pages, first 70 interactive elements each) still finds interactive elements that do not react: sweep outcome tiles, experiments list rows, dataset item rows, analysis controls and steppers, the queue "Remote queue" toggle (F7). |

Counts: 18 feedback points, 16 met, 2 partly, 0 not met.

## 2. Findings and fix list (by severity)

Severity: S1 = fails a gate or an a11y rule, S2 = visible defect, S3 = polish. File pointers are under `frontend/src/`.

| ID | Sev | Finding | Pointer |
|---|---|---|---|
| F1 | S1 | **One real gate failure that exists only on the merged tip (plus one unreproduced).** (a) `tests/platform/test_archived_project_read_only.py::test_every_write_route_is_classified`: `POST /api/analysis-jobs/active-runs` (runs-polish) is not classified; it is a read-shaped POST and belongs in `ALLOWED` with its justification (or call `require_project_writable`). (a) is real (fails alone, twice). (b) One Vitest failure appeared in the first `npm run check` log (`design-language > raw <table> markup lives in ui/DataTable`, `features/dev/UiGalleryPage.tsx`) but the file holds no `<table>` on this tip and the test passes alone (47/47) and in the later check: not reproduced, treat as a transient. | `tests/platform/test_archived_project_read_only.py` (ALLOWED list); `features/dev/UiGalleryPage.tsx` |
| F2 | S1 | **axe serious on the repeat panel**: `aria-prohibited-attr` (6 nodes): the Pass@k chart dots are `<circle aria-label="Pass@k @k=1: 66.7%">` without a role; and `label-content-name-mismatch` on the per-pass column buttons whose `aria-label` does not contain the visible text. Seen on the repeat run and the Arabic multi-pass run, at 1440 and 390. The per-branch a11y specs miss it because the repeat panel is not in their scan list. | `features/run-detail/components/charts/Charts.tsx:547` (circle), `:589` (`passCol` button); `Charts.module.css:100` |
| F3 | S2 | **Three 390 px overflows** (page-level scrollWidth is 0 because the cards clip): Admin users filter input and table run past the card edge; Project settings "Name" input and its Save row are cut at the right; Projects page "New project" button is cut at the right edge. Also the Overview and Admin stat grids leave an orphan grey cell (`overview-390`, `admin-runs-390`). | `features/admin/users/UsersTable.tsx:175`, `features/projects` settings General tab, `features/shell/projects/ProjectsPage.tsx:56,74`; the KeyValue/stat grid used by Overview and Admin |
| F4 | S2 | **Run header is about 440 px tall at 1440 (legacy 160 px)** and over 1,100 px at 390: the whole first screen of the report is metadata, versioning details and execution context, with no data. Collapse the secondary rows (versioning details, execution context) behind the existing chevron by default, keep one strip like legacy. | `features/run-detail/components/RunHero.tsx`, `RunHero.module.css`; `rdw-classic-1440-s0`, `leg-run-bottom`, `m2` |
| F5 | S2 | **Arabic / RTL values: key header jumps to the far right** while LTR keys sit left (section 1, R2-rd-6a). Keep the key header and its value in one left-anchored row and let only the value text be `dir="auto"` / right-aligned inside its own column. | `features/run-detail/components/items/ItemCard.tsx`, `ItemCard.module.css` (the key section header); the JSON section component it renders |
| F6 | S2 | **Heatmap is unreadable at width**: the item column takes about 1000 px and the three pass cells sit 170 px wide at the far right, with no row guide; also all 60 rows render without a pager. Cap the item column or centre the cell block; add the row hover. | `features/run-detail/components/items/Heatmap.tsx`, `Heatmap.module.css`; `heatmap.png` |
| F7 | S2 | **Hover gaps** (cursor is pointer but nothing changes): sweep outcome tiles (`_outcome` in `SweepView.module.css`), experiments list rows, dataset item rows, analysis accordion triggers / "Full value" / mapping steppers, queue "Remote queue" toggle, docs sidebar links. The strict hover audit only samples runs, run detail and compare; extend its page list to every page above and add these to the audited set. | `features/compare/components/sweep/SweepView.module.css`, `features/experiments/*list*`, `features/datasets/detail/ItemsTab*`, `features/analyzer/*`, `e2e/visual-language/hover-audit.spec.ts` |
| F8 | S2 | **Sticky bars differ**: run-detail section nav 34 px, compare bar 44 px (`--compare-bar-h`), items toolbar 71 px, experiment home bar 61 px, analysis action rail 56 px, compare item header 28 px. Pick one section-nav height and one action-bar height (tokens) and use them in both reports. | `features/run-detail/components/SectionNav.module.css`, `features/compare/components/CompareBar.module.css`, `features/experiments/launch/entry/entry.module.css`, `styles/tokens.css` |
| F9 | S2 | **Experiment wizard step 4 tables are clipped** beside the Review rail (Endpoints table loses its right columns, Role table cut at "reasoni") with no scroll cue, inside four nested bordered levels (section > LLM_OVERRIDES > Endpoints > table). Give the config step the full width (collapse the rail to a bar while a wide table is open) and drop two nesting levels. | `features/experiments/launch/*` (RoleTable, endpoints table, `ex-llm-1440`) |
| F10 | S3 | **Same entity, different rendering** (section 3 table). Biggest: run identity (four recipes) and item input (structured prompt on run detail vs raw JSON string in the dataset items tab). | see section 3 |
| F11 | S3 | Metric relationship scatter on Deep analysis is single-colour grey (quality vs latency right above it is pass / fail coloured). | `features/run-detail/components/charts/Charts.tsx:344` scatter |
| F12 | S3 | Compare: run colours 6 to 8 reuse hues of 1 to 3 (H teal = A teal); error cards use one third of the width (empty right side); at 390 the section tabs clip at "Categories" with no edge cue. Known from the compare review; still open. | `features/compare/components/RunTag.module.css`, `ReportSections.module.css` |
| F13 | S3 | Heading scale: Overview uses H2 13 px (5 panels) and H2 18 px (2); Charts H2 15; Analysis H2 15 + 18; Admin H3 15; run detail and compare H2 18; repeat blocks H3 13. Runs and Charts H1 are 24/700, every other page 22/650. | `features/overview`, `features/charts`, `ui/` PageHeader and section heading |
| F14 | S3 | Two page widths: Overview, Models, Settings, Admin, Profile, Projects are centred at 1120 px; Runs, Run detail, Compare, Analysis, Experiments, Datasets run at 1233 px. Charts (filter bar identical to Runs) is 1233, Overview 1120. | `ui/` Page layout, per-page `max-width` |
| F15 | S3 | Card recipes: left rail 3 px (run cards, compare cards), left rail 2 px with 14/20 padding (experiment home, versions card), bottom rail (sweep metric cards), plain 1 px with 0 padding (tables), 14/14 (queue cards), 5 px radius with 8 px padding (repeat tiles). One `Card` with `tone` / `rail` would cover all of them. | `ui/Card`, `ReportSections.module.css`, `entry.module.css`, `SweepView.module.css` |
| F17 | S3 | `e2e/runs-list/cutover-run-rows.spec.ts:8` asserts the old `/docs-guide#...` URL and races the redirect to `/docs/...`; update the expected URL. | `frontend/e2e/runs-list/cutover-run-rows.spec.ts:14` |
| F16 | S3 | Copy and small bits: "Published By:" capital B (`datasets/detail/LineageTab.tsx:65`); run-not-found offers "Back to Dashboard" instead of the project's runs; Experiment home highlights "From scratch" before an environment is picked while the other cards are disabled; steps table cell "61 18 err" wraps; runs-list `tr` focus has no ring (the inner link has); items default page size 20 for a 2,747-item run (138 pages). | various |

## 3. Cross-area inconsistencies (what the per-branch reviews could not see)

| Entity or pattern | Rendering A | Rendering B | Rendering C |
|---|---|---|---|
| **Run** (name) | Runs list: sans white link, no mono | Overview and Admin: teal mono link with the task as a wide purple block under it | Run detail header: 22 px mono UUID; compare card: sans bold with colour swatch and letter; analysis: mono |
| **Task** | Runs list and compare card: small mono purple pill | Overview: wide block under the name | Run detail header: pill; analysis header: plain text "Task rag_answer" |
| **Model** | Runs list and compare card: pill with coloured dot | Charts: dot + plain text | Run detail header: plain text; Overview: absent |
| **Dataset** | Runs list and compare: chip with database glyph | Run detail header: avatar icon + text | Experiments home: plain `<select>` |
| **Item input** | Run detail: the prompt string, two lines | Dataset items tab: raw JSON `{"prompt":"..."}` in mono | Analysis targets: raw JSON, bidi-scrambled for Arabic |
| **Score** | Runs list / items: bar + coloured number | Compare averages: coloured pill + delta + noise band | Overview stat tiles: large mono number only |
| **Status chip** | Same outlined uppercase chip on runs, overview, admin, run detail (consistent) | | |
| **Hover** | Rows highlight on runs list, run items, compare matrix | Experiments rows and dataset rows are pointer with no change; sweep tiles, analysis controls the same | Charts dim siblings only in the audited surfaces |
| **Sticky bar** | 34 px (run nav) | 44 px (compare bar) | 56 / 61 / 71 px (action bars, item toolbar) |
| **Section heading** | 18/650 (run detail, compare, repeat) | 13/600 (overview panels, charts group titles) | 15/600 (charts, analysis, admin) |
| **Card** | left rail 3 px | left rail 2 px, 14/20 | bottom rail, plain 1 px, 14/14 |
| **Rhythm** | Run detail and compare sections breathe (about 64 px between sections) | Sweep and the experiments review step are tight and use 13 px section titles under an 18 px "Sweep" title | Compare error cards occupy a third of the width |
| **Copy tone** | Sentence case, plain ("Scan the items that changed...") | Terse capitalised ("Published By:", "Select a task and dataset") | Empty states are consistent ("No ... yet") |

## 4. Interaction sweep

| Check | Result |
|---|---|
| Keyboard, runs -> run -> item -> trace | Pass. Tab order on the runs list: search, 2 range inputs, Select, Columns, Density, six facets, table region, header, rows (run link, error badge, Analyze, delete, more); Enter on a run link opens it and focus lands on `main`. On run detail Enter on "Open item #1" expands it, 12 tabs reach "Trace", Enter opens the drawer (focus in the dialog), tab cycle Copy id / Open in Langfuse / Close, Escape closes and returns focus to the Trace button. Gaps: `tr[row]` focus has no ring on the runs list; `?` shows no shortcuts dialog on run detail (runs list has the footer link). |
| Back / Forward | Pass: run detail Back returns to `/projects/demo` and Forward to the same run; scope, filter and panel state are carried in the URL (`?filters=`, `?panel=repeat`, `?view=heatmap`, `?item=`). |
| Deep links (CUTOVER URL map) | Pass: `/run/{id}` -> project run; `/run/{id}/analyzer` and `/projects/{slug}/runs/{id}/analyzer[?scope=]` -> `/projects/{slug}/analysis?run=`; `/docs-guide` and `/docs` -> `/docs/get-started/what-is-qym`; `/admin` -> `/admin/runs`; `/index.html` -> `/`; `/datasets/golden` -> `?v=v1&tab=items`; `/app/...?x=1` -> 302 to the same path (checked against the built app on 8941); `/v1/nonexistent` -> JSON 404. Missing project, run and unknown path render their own not-found states. |
| Reduced motion | Pass: with `prefers-reduced-motion: reduce` 0 running animations and 0 elements with a non-zero transition or animation duration on runs, run detail, repeat, compare, experiments, analysis, charts, overview (without it: 20 to 1,183 elements per page carry transitions). |
| axe serious / critical | 56 page loads (28 pages x 1440 and 390): **54 clean, 2 pages with violations**, both the repeat panel (F2). No other page has a serious or critical violation; no console errors on any page. |
| Hover audit (strict, extended) | Gaps listed in F7. |
| Performance | Built app on 8941: 400-run list ready in under 100 ms of data to first row and 6.4k DOM nodes (50 per page); run detail 2,746 items: ready in 403 ms, 1 long task (116 ms), 0 long tasks across a 24,000 px scroll, page size 20 with a pager (138 pages), search "Question 77" settles in about 1.6 s; charts page 10.5k DOM nodes, 1 long task (69 ms). The 5,200-item case was seeded but the run only received 2,746 items; the items table is paged, so the cost does not scale with the count. |

## 5. Gate

| Step | Result |
|---|---|
| `npm run check` | Pass (typecheck, eslint, stylelint, Vitest, design-language 47). One transient Vitest failure in the first log, not reproduced (F1b). |
| `npm run build`, `npm run build:sdk` | Pass (21 s, 13 s). |
| pytest platform + sdk | 3,262 passed, 1 failed, 744 skipped (run in chunks; `-n 4/2/3` single runs were killed by the memory cap, exit 137). Failure: `test_every_write_route_is_classified`, **real** (F1a). |
| Playwright `npm run e2e` | 1,090 passed, 3 failed, 12 skipped (25.7 min). All three attributed by rerunning alone: see below. |
| `npm run e2e:sdk` | 42 passed. |

Playwright failures:
- `runs-list/cutover-run-rows.spec.ts:8` (empty project links to first-run guide): fails 1 of 2 reruns. **Test defect, not product**: it expects `/docs-guide#get-started/first-run` but the app redirects to `/docs/get-started/first-run`; the assertion races the redirect (also seen failing in earlier branch gates). Fix the expectation (F17).
- `experiments/launch/tables.spec.ts:75` (390 px, global sweep keeps run count in the launch bar): **flake**, passes alone twice (click intercepted by the sticky launch bar under load). Relates to the sticky-bar overlap noted in F8/F9.
- `runs-list/table-redesign.spec.ts:30` (Date on screen at 1280): **flake**, passes alone twice (Date header right edge 1170 vs 1146 limit in the full run); layout-under-load sensitive, worth a margin.


## 6. Counts

- Pages walked: 28 routes x 2 widths (56 loads) plus run-detail variants (classic, repeat, Arabic, many), compare variants (2, 4, 8 runs, cohort, sweep), expanded item, metric panel, trace drawer, heatmap, experiments home and six wizard steps, legacy compare and run detail.
- Feedback points: 18 (4 round 1, 14 round 2): 16 met, 2 partly, 0 not met.
- Findings: 17 (2 S1, 7 S2, 8 S3), plus the 13-row cross-area table in section 3.
- axe: 56 loads, 2 with serious violations (same panel). Console errors: 0.

## Re-review (fix pass, tip 92a13ecc)

Re-walked in the running app (platform 8941, Vite 5941, same seeds, 28 routes x 2 widths again) plus targeted probes (`fr/*.mjs`, screenshots `fr/shots/rr-*`, `item-arabic-1440`, `cw-*`; round-1 shots kept in `fr/shots-r1`). Fonts and colours were not judged.

### Per finding

| ID | Verdict | Evidence |
|---|---|---|
| F1 | **Fixed** | `test_archived_project_read_only.py` 282 passed; `npm run check` 140 files / 1,263 tests, design-language 48, green. |
| F2 | **Fixed** | axe on all 56 page loads: 0 serious/critical (repeat and Arabic multi-pass runs at 1440 and 390 were the two offenders before). 0 console errors. |
| F3 | **Fixed** | No clipped fields on admin users, project settings, projects at 390; overview and admin stat grids no longer leave a grey cell (`overview-390`, `m6`). |
| F4 | **Fixed** | Header strip is about 95 px at 1440 (was 420) and about 290 px at 390 (was over 1,100); first section is on the first screen at both widths. Nothing from legacy is lost: the strip carries name, status, Export, pager, task / dataset / model tags, start, runtime; the chevron (collapsed by default) reveals owner, project, execution context, run-name metadata and versioning details (`rr-header-expanded`). |
| F5 | **Fixed** | Arabic multi-pass item: EXPECTED OUTPUT > ANSWER header is left-anchored like CONTEXT / TOPICS, only the value text is RTL in its own column; pass columns unchanged (`item-arabic-1440`). |
| F6 | **Fixed** | Heatmap: item column capped, block as wide as its three pass columns, 30 rows then "Show 30 more" (`rr-heatmap`). |
| F7 | **Partly** | Fixed and confirmed by pixel diff or computed style: sweep tiles, queue "Remote queue" toggle, docs links, review problem link. Experiments rows and dataset item rows do react (my first probe was too coarse; they were not a defect, the implementer is right). **Still no hover change** on the analysis page disclosures "Input mapping", "More options" and the "Full value" buttons (identical pixels hovered vs not; `hov3.mjs`); the claimed analysis hover is not visible on those three. |
| F8 | **Partly** | Section navs are now both 44 px (run detail and compare); analysis action rail 56 px. The experiment home bar is still 61 px and the run items toolbar 71 px (the spec says one 56 px action bar). Compare item header 28 px unchanged. |
| F9 | **Fixed** | Settings step uses the full width, Review rail becomes a compact launch bar ("1 run to launch / Ready to launch / Cancel / Raw JSON / Launch"), nesting down to two levels, tables show an edge fade where they still overflow (`ex-llm-1440`, `-b`). Flows verified end to end against the fakes: "Launch as is" from home created 1 experiment and 1 job; Customize > step 4 > compact-bar "Launch" created 1 job. |
| F10 | **Partly** | Run name is sans on Overview, Admin, runs list, compare, analysis; mono only for ids and the run header (the id is the title). Task / dataset / model tags are shared on the run header, analysis header, compare and runs list; dataset items show the prompt string, not raw JSON. Remaining: Admin still stacks the task pill under the run name while the runs list puts it inline; Overview recent runs show no task, dataset or model tag at all. |
| F11 | **Fixed** | Relationship scatter coloured pass / fail (implementer test `charts.spec.ts`; seen in the walk). |
| F12 | **Fixed** | `--chart-6..8` distinct from 1 to 3 in the 8-run compare (`cw-p8-1440-s0`); compare tab edge cue present. Error cards now span the full width (see N1). |
| F13 | **Partly** | Scale is consistent on run detail, compare, charts, admin, reviews, trash (H1 22 everywhere, H2 18, H3 15). Overview mixes H2 15 (5 panels) and 18 (2) by design; Analysis still has H3 18 (three) under an H2 15 (inverted hierarchy). |
| F14 | **Fixed** | Every page except Profile (deliberately narrow, 1120) is 1233 px wide. |
| F15 | **Partly** | `Card rail` covers run cards, queue cards, sweep tiles, home start cards. Still three recipes in play: repeat tiles (5 px radius, 8 px padding), experiment home cards (14/20), tables (0 padding). |
| F16 | **Fixed** | Copy and small items (Published by, Back to runs, steps count on one line, From scratch disabled before an environment, runs-row focus band, 1,000+ item run opens at 100 rows) covered by their specs; not individually re-screenshotted. |
| F17 | **Fixed** | `cutover-run-rows.spec.ts:8` and the other two flaky specs: 3 of 3 passes alone each (see below). |

Counts: 17 findings, 11 fixed, 5 partly (F7, F8, F10, F13, F15), 0 not fixed (F16 counted fixed on spec evidence).

### New observations (no regression of a met feedback point)

- N1 (S3): compare error cards stretch to 1,190 px, so the run name sits about 1,000 px from its count and delta; cap the card width or the inner grid (`ReportSections.module.css`).
- N2 (S3): wizard settings step stacks two sticky bars at the bottom (Back / Skip / Continue, then the compact launch bar), about 100 px of the viewport; merge them or only stick one.
- N3 (S3): the sweep view still uses 13 px section titles under its 18 px title and tighter spacing than the compare tabs.

### Gate (targeted)

- `npm run check`: pass (typecheck, eslint, stylelint, Vitest 140 files / 1,263 tests, design-language 48).
- Playwright through `heavy.sh --cost 4` on `e2e/run-detail e2e/compare e2e/experiments e2e/visual-language e2e/shell e2e/runs-list`: **865 passed, 9 skipped, 0 failed** (18.9 min).
- The three earlier flakes, each rerun alone 3 times: `runs-list/cutover-run-rows.spec.ts:8` 3/3 pass, `experiments/launch/tables.spec.ts` "390px: the global sweep keeps the run count in the launch bar" 3/3 pass, `runs-list/table-redesign.spec.ts` "Date ... at 1280" 3/3 pass.
- pytest: only `test_archived_project_read_only.py` re-run here (282 passed); the implementer reports the full platform + sdk run green.
- All servers stopped; no listener on 8941, 5941, 8945, 5945, 9041, 9042, 9045, 9046, 9941, 9945.

### Final verdict

**Pass.** All S1 and S2 defects from the first review are fixed except two small residuals (analysis hover, bar heights 61 / 71 px vs 56 px). Nothing regressed, the gate is green. The colour and typeface pass can start now; carry F7 (analysis hover), F8, F10 (Admin / Overview tags), F13 (analysis headings), F15 and N1 to N3 into it as they touch the same recipes the design pass restyles, so fix them there rather than in a separate pass.
