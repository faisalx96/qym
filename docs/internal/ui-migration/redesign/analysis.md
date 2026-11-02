# Redesign brief: Auto-analysis workspace

Investigation only; no product code changed. Evidence: legacy page run on port 8827 (worktree `qym-wt-legacy`, 7814183), React page on Vite 5828 / platform 8828, stub LLM `frontend/scripts/stub_llm.py` (0.8 s delay), Playwright/Chromium, seeded run of 25 items (22 failing targets; 34 item-metric targets) plus a 2-sample run. Screenshots are in the scratchpad (`.../scratchpad/an/legacy-*.png`, `react-*.png`), not in the repo.

## 1. Feedback point

> "the analysis page feels too cluttered and not smooth."

**Which page.** "The analysis page" is the `/projects/:slug/analysis?run=ID` workspace (nav item "Auto-analysis"; legacy `analyzer.html`, React `frontend/src/features/analyzer`). The run-detail "Root cause" tab (`features/run-detail/components/panels/RootCauseTab.tsx`; legacy `item_reasons.js`) is a results viewer for already-saved analyses, has no run/preview/progress flow, and is not a candidate for "cluttered / not smooth" (it is covered by the run-detail redesign brief). The compare page's Auto-Analyze is now just a link to this workspace (`qa/analyzer.md` A16). This brief covers the workspace (run scope, and project-guidance scope).

**Reading of "intended UX".** Unlike the other three feedback points, the legacy analyzer was not a polished report. It was one long, linear, single-column page (3274 px tall at 1280x900) of full-width cards in a fixed order: run + metrics, instructions, targets (with filters and a paginated list of 10 items), prompt preview (in a nested 498 px scroller), then a sticky-less action footer. Results (test result card, progress, completion) were appended into the same column and the page auto-scrolled to them. What users valued is, as far as the code shows: (a) everything for one analysis is on one page with no mode switching, (b) one obvious primary button ("Analyze N items") at the end, (c) quiet cards: few badges, no step chrome, no persistent banners. The React rebuild kept all capabilities but wrapped them in a 4-step wizard with a stepper, two nested switchers, a sticky job bar and a sticky Back/Next footer. That adds chrome and moves things (see section 3), and the primary action lives on step 3 of 4. The redesign should keep the legacy one-page mental model, remove the wizard chrome, and add the smoothness the legacy page also lacked (it shifts too, see 2.4).

## 2. Legacy page anatomy (`analyzer.html`, `playground.js`, `dashboard.css`)

Files: `packages/platform/qym_platform/_static/dashboard/analyzer.html` (markup 3577-3665, CSS 16-3573, JS 3665-6168, `composeAnalyzerWorkspace` 5208), `playground.js` (builds the run panel), `qym_safe.js`. Single `<main id="shell-content">` is the only page scroller.

### 2.1 Layout (1280x900, same at 1920: content is full width of main, no max-width, so cards just stretch)

| # | Region | Contents | Height @1280 | Notes |
|---|---|---|---|---|
| 0 | Hero (analyzer.html:3578-3600) | H1 "Auto-analysis", description, meta "Project x . Workspace metric failure diagnosis", tab strip: Analyze run / Diagnosis categories / Production rules / Documents (the hidden Dashboard tab is kill-switched) | ~180 | Underline tabs, `?scope=` persisted. One row of 4 plain text tabs. |
| 1 | Run card `.analysis-run-card` | run name, "TASK / MODEL / DATASET" meta, View run button; "Metrics to analyze" label, checkbox chips, Select all / Clear, "2 of 2 metrics selected" | 205 | Single card, one internal divider. |
| 2 | Additional instructions card | hint line with `{variable_name}`, textarea (~120 px) | ~290 | Variable mapping appears only when `{vars}` are typed. |
| 3 | Targets card `.analysis-target-card` | Header "Targets" + sub copy; "Filter & Items" collapsible with count pill (22); options row (Max score slider, Skip analyzed, Re-analyze human labels, Timeout, Analyze limit, Max issues, "Input mapping" button); list of item cards (#n, "2 metric targets", one row per metric with score + "failed" pill, input preview line), pagination "1-10 of 22 items . 1 of 3" | 1690 (10 items x 104-146 px) | The tallest region; each item is its own bordered card inside the target card (card-in-card). |
| 4 | Prompt preview card | title, Settings popover (Production rules / Project documents / Trace evidence toggles hidden in a popover), "Final prompt: 8,837 characters", system/user message blocks in a mono `pre`, expand + copy icons | 668 card; inner scroller 498 px showing a 3267 px prompt | Toggles are not visible until the popover opens. |
| 5 | Results (conditional) | Appears only when there is content: `TEST RESULTS` (issue cards, "Fields:" regex chips, collapsed "ITEM CONTEXT"), progress ("Analyzing metric failures: 7/34 (21%)", gradient bar, "Last: item-11 . exact_match"), completion ("Analyzed 34 metric failures successfully / Created 1 category / View run") | grows by 195-600 | Mounted by a MutationObserver (analyzer.html:5805). |
| 6 | Action footer | "Ready when the item count looks right", LLM connection select, `Test Selected`, `Analyze 22 items` (green, one accent button); becomes `Cancel analysis` (red) while running | ~120 | In flow at the end of the page, not sticky; the page auto-scrolls to it/the results when a job starts. |

### 2.2 How a user got from picking a run to results

Runs list "Analyze" chip -> page loads (skeleton cards, `data-qym-skeleton="cards"` 3 cards) -> single column fills in -> user optionally edits metrics/instructions/filters, scrolls (about 2.5 screens) past the 10-item target list and the prompt preview -> clicks `Test Selected` (result card appended above the footer; page grows 195 px and scrolls down) or `Analyze N items` (progress card replaces the footer area; footer buttons disabled, Cancel shown) -> completion card with "View run". No step chrome, no URL step, one primary button. Project-level work (categories, rules, documents) is in the other three tabs, one at a time.

### 2.3 Density and disclosure

- Visible above the fold at 1280x900 (measured with the same script as React, main area only): 13 interactive controls, 9 bordered boxes, 2 badges/chips/tags, 4 headings. Total document 1576 px at first paint of a short run, 3274 px with 22 targets.
- Progressive disclosure used: "Filter & Items" collapsible, Settings popover for context toggles, collapsed "ITEM CONTEXT", Input mapping in a dialog, pagination (10 per page), Variable Mapping only when variables exist.
- Typography: 12-13 px labels (uppercase eyebrow style), 15-18 px card titles; mono for ids and scores; red score highlight chips.

### 2.4 Legacy motion and shifts (measured; legacy is not perfectly smooth either)

- One `transition` rule in the whole page (analyzer.html:3124, opacity).
- Page height changes: before 3274; after `Test Selected` 3469 then 3625 (two steps, results card then item context); after `Analyze` start 3875; at job completion (t = 4.0 s) it drops to 2724, then 2424, then 2174 as "Skip analyzed" removes the 22 analysed targets and the prompt preview collapses to "No items match current filters." So the legacy page also jumps by ~1700 px at completion, and the scroll position is moved by script (2583 -> 3023 -> 1324).
- The 10 item cards are redrawn after the job and the preview box is replaced by an error-ish text ("No items match current filters").
- Polling progress text updates in place (no remount), so progress itself did not flicker; the jumps are structural.

## 3. React page anatomy (`frontend/src/features/analyzer`)

### 3.1 Component tree

```
AnalyzerPage.tsx
  RunShell.tsx                       (run scope; key=runId)
    PageHeader                       title + description + meta "Project x"
    SegmentedControl                 "Analyze run | Project guidance"     (areaRow)
    [Badge "Analysis n/m"]           only when job is live and area=guidance
    .stickyBar > JobStatus mode=bar  (job exists and not on Review step)
    RunAnalyze.tsx                   (hidden attr when area != run)
      Skeleton kind=cards            after 300 ms delay
      SamplePicker.tsx               repeat runs without ?pass
      Workspace
        banner (no LLM / read-only)  s.banner
        ol.stepper  4 x button       Configure | Preview | Run | Review, each with a dynamic note
        step body:
          configure: Card "Run and metrics" (RunHeader + MetricChips), Card "Additional instructions" (Instructions, FieldsMapping vars), Card "Targets" (TargetFilters + TargetList + hint)
          preview:   Select "Previewed target", grid[Card "Fields" (FieldsMapping), Card "Prompt preview" (PromptPreview, 3 Switches, Tag chars, messages scroller)]
          run:       Card "Connection and actions" (Testing chips, Change targets, RunBar: Select + Test + Analyze), Card "Test results"
          review:    JobStatus mode=card or EmptyState
        footer.nav (sticky bottom)   Back | "Step n of 4: hint" | Next: <step>
    GuidanceArea.tsx                 (Tabs: Diagnosis / Rules / Documents; DiagnosisPanel, RulesPanel, DocumentsPanel, ...)
  ProjectLanding.tsx                 no ?run
```

State: `?run`, `?pass`, `?metric`, `?scope` (run|categories|rules|documents), `?step` (configure|preview|run|review) in `useAnalyzerRoute.ts` / `RunShell.tsx:35`. Step changes use `pushUrlQuery`, so each step is a history entry. Job polling: `useAnalysisJob` 1 s `refetchInterval`, `staleTime: 0` (`api/analysis.ts:681-690`). Preview request debounced 500 ms (`useRunWorkspace.ts:147`). Item bodies (first 20) are loaded lazily when step=preview (`RunAnalyze.tsx:44`).

### 3.2 Counts (measured at 900 px viewport height; "controls" = buttons, links, inputs, selects, tabs, switches in `main`; "bordered boxes" = visible non-control elements with a border, width > 60, height > 24; "badges" = elements whose class matches badge/chip/tag, leaf only)

| Step | Viewport | Controls | Bordered boxes | Badges/chips/tags | Headings | Scroll height of main |
|---|---|---|---|---|---|---|
| Configure | 1280 | 20 | 7 | 3 | 5 | 1834 |
| Configure | 1920 | 23 | 7 | 3 | 5 | 1763 |
| Preview | 1280 | 29 | 12 | 8 | 3 | 957 (+ inner prompt scroller 3737/358) |
| Preview | 1920 | 29 | 12 | 8 | 3 | 908 (+ inner scroller 2847/358) |
| Run (idle) | 1280/1920 | 14 | 5 | 1 | 4 | 850 |
| Review (no job) | 1280/1920 | 9 | 1 | 0 | 2 | 850 |
| Legacy (for comparison) | 1280/1920 | 13 | 9 | 2 | 4 | 3274 for 22 targets (1576 empty) |

Reading the numbers: on any single step the React page is not denser than legacy in raw counts (Configure 20 vs 13 controls; Preview 29 is the worst: 3 switches, 3 field selects, 3 "Full value" buttons, 3 include switches, metadata button, target select, copy). The clutter is in the chrome around the content: above the first real field there are 5 stacked layers (nav breadcrumb, H1 + description + meta, area switcher, 4-button stepper with sub-labels, then a card with its own header) which occupy y = 0 to 270 px of a 900 px viewport (30 percent) before any control is reachable, and during a job a sixth (job bar, +60 px). Bordered regions on the Configure fold: area switcher, 4 stepper buttons (each bordered), 3 cards = 8 borders plus the footer rule.

Colour/emphasis: three accent-coloured things compete on Configure: the active stepper tile (accent border), the accent "Next: Preview" button, the accent area switch segment. In the job state a fourth (bar border turns green on completion) appears.

### 3.3 State transitions and measured shifts

Measured with a `layout-shift` PerformanceObserver (user-input shifts excluded by the API, so also probed element tops every 100 ms) and screenshots 500 ms apart while running the stub LLM job (34 targets, ~0.8 s each).

- Load: skeleton only after 300 ms (`useDelayedPending`); on the local stub the data arrive first so nothing flashes. CLS 0.0 at load. Good.
- Step switches (Configure -> Preview -> Run): CLS ~0 reported, but the page height changes from 1834 -> 957 -> 850, so the main scrollbar appears and disappears and the content column width changes by the scrollbar width (visible shift of about 15 px on the right edge of all full-width cards on every step change between a tall and a short step). On Preview, the item bodies fetch on entry (`bodiesLoading`) and the mapping selects re-render when it arrives.
- Job start: the sticky `JobStatus` bar mounts above the stepper and pushes the whole workspace down 60 px (stepper top 205 -> 265 px, verified by probe and screenshots `react-test-done.png` vs `react-job-1.png`). The browser does not count it as a shift because it follows a click, but visually everything jumps and the Analyze button the user just pressed moves under the pointer. The bar also steals focus (`region.current?.focus()`, JobStatus.tsx:127).
- During the job: 6 status polls in 6 s (1/s), plus 1 `analysis-config` and 1 `?view=compact` refetch at completion. Reported CLS across the whole run 0.0011 (10 tiny entries from the progress bar fill, the job text and button labels). DOM mutations: about 90 over the 6 s run (~15/s), then flat. So polling itself does not flicker; width of text such as "8 / 34 targets" -> "10 / 34 targets" shifts the progress track by a few px.
- Button label thrash on the Run step (screenshots): `Analyze 22 items` -> `Analysis running` -> `Analyze 0 items` (disabled) after completion; `Test Selected (1)` stays enabled-looking but disabled; the "Testing:" chip row loses its chip (`item-2 . exact_match` -> "no targets"); the Configure tab note flips "22 targets" -> "0 targets"; stepper tile 4 flips to a check with "Complete". Because "Skip analyzed" is on by default, finishing a job empties the target list the user was just looking at (same as legacy).
- Completion: the sticky bar changes from progress to "COMPLETED . 34 of 34 metric analyses succeeded" with three buttons (Review results / View run / Dismiss), a toast fires, and the Review stepper tile changes. Three different surfaces announce the same outcome (bar, toast, Review card). Bar height is constant (`min-height: var(--status-bar-height)`), so no reflow from the content change, good.
- Review step: shows the same summary again in a card, with a second View run / Dismiss pair.
- Preview step: the prompt scroller is a 358 px inner scroll area containing a 2800-3700 px prompt, auto-scrolled to the bottom on each update (`PromptPreview.tsx:12`), so editing a mapping jumps the text under the reader. Pending state is a text "Updating..." that appears and disappears in the toolbar row (the row has `role=status`), plus the "8,837 chars" tag changing width.
- Navigation cost: wizard steps create history entries; Back from Review goes to Run, not out of the page (intentional), but the sticky footer Back/Next duplicates the stepper.
- Slow interactions: none measured over 100 ms in these runs; the Preview step is the heaviest (first entry issues the 20-item details fetch plus the preview POST after the 500 ms debounce, so the prompt appears about 0.5 to 0.9 s after entering the step with only a text status).

### 3.4 Capabilities the React page has (must all survive)

Run scope: run header with id tag and View run (keeps `?pass`); sample picker interstitial and in-place sample switch with busy guard; metric chips, Select all, Clear, `?metric=` preselect; additional instructions with `{var}` detection and per-variable source/JSON-path mapping, `{categories}` reserved; Fields mapping for INPUT / EXPECTED / ACTUAL OUTPUT with "Full value" JSON-field picker, include toggles (Error, Scores, Metric metadata), metadata picker; targets filters (max score, skip analyzed, re-analyze human labels with confirm dialog, limit, timeout, max issues, retries, direction/threshold), target list with checkboxes (up to 3 for Test) and pagination, previewed target select; debounced prompt preview (no LLM call) with copy, char count, expand, context toggles (rules / documents / trace), "Fields sent"; LLM connection select with key-missing, no-connection and read-only banners; Test Selected (<=3) with cancel and result cards (issues, confidence, fields sent, item context); Analyze N with job lifecycle (queued, analyzing, retrying, aggregating, completed, failed, cancelled), cancel, resume via `/active` after reload, toast, error-code groups, aggregation error, retry counts, View run; stale-sample 409 message; URL state (`run`, `pass`, `metric`, `scope`, `step`) and legacy URL redirects.
Guidance scope (Project guidance): Diagnosis catalog editor with taxonomy validation, subcategories, examples, `base_revision` 409 handling and search; Production rules (versions, draft autosave 700 ms, publish with set-as-production, promote, delete, compare, merge with conflict resolution, download JSON, rule generation job with progress, approved-example picker with facets and character budget); Documents (upload with large-document confirm, include toggle, delete); live-job badge on the guidance area.

## 4. Gap analysis

| legacy | react | why it matters | proposed change |
|---|---|---|---|
| One page, one column, no step chrome; Analyze is the last element, always the same place | 4-step wizard: stepper (4 bordered tiles with dynamic notes), sticky Back/Next footer, `?step`, Run on step 3 | Stepper + footer duplicate each other and push content to y = 270 px; primary action is hidden two steps away; every step change reflows | Replace the wizard with one scrolling workspace with a sticky action rail (see 5). Keep `?step` as a tolerated legacy param that maps to a scroll anchor. |
| 4 plain underline tabs (Analyze run / Diagnosis / Rules / Documents), one row | Segmented "Analyze run / Project guidance" above the stepper, then another Tabs row inside guidance | Two switch levels for one idea; segmented control also looks like a toggle, not navigation | Use one `Tabs` row (PageHeader tabs slot): Analyze run, Diagnosis categories, Production rules, Documents, with a live-job dot on the tab if a job runs. Drop SegmentedControl. |
| Results appended into the same page where the user is looking | Job bar pushes page down 60 px; results on a separate step; summary shown in bar, toast and Review card | Visible jump on click; same message in 3 places | Reserve a fixed job slot in the sticky rail (always mounted, collapsed state = the action buttons); results render in a reserved Results section. Toast only for failures; the rail shows success. |
| Filter & Items list collapsible, 10 per page, inline | Target list on Configure below filters, plus extra hint line | Fine, but long cards | Keep list; make it a compact table-like list (one row per target, 36-40 px). |
| Context toggles in a Settings popover | 3 Switches always visible in Preview toolbar | +3 controls and +3 inputs visible; more chrome | Move to a single "Context" popover/menu button with a count ("Context: 3 on"). |
| Preview card with 498 px inner scroller | 358 px inner scroller, auto-scrolls to bottom on every update | Nested scroll; text jumps under the cursor | Preview is a collapsed section "Prompt preview . 8,837 chars"; open it in a Drawer (reuse `Drawer`) with a fixed-height sticky header; do not auto-scroll except when the mapping that changed lives in the last message and the user is editing it. |
| Input mapping tucked behind a dialog button | Fields card always open on Preview step with 3 selects + 3 Full-value + 3 switches + metadata button | Densest screen (29 controls) | Move "Fields" into a collapsed "Input mapping" disclosure inside Targets, closed by default, with a one-line summary ("Default fields" / "2 variables"). |
| Action footer: LLM connection + 2 buttons, one accent | Same controls on Run step; plus "Testing: chips", "Change targets", hint lines, "Next: Review" accent button | Two accent buttons on one screen; label thrash | One accent button per state (see 5.4); stable labels. |
| Skeleton cards on load | Skeleton after 300 ms | Equal | Keep. |
| Banner: none (status text only) | Persistent info banner for no LLM / read-only above the stepper | Pushes content down; reappears every step | Inline in the action rail next to the disabled buttons ("No connection: set one up in project settings"), no banner. |
| Page height collapses at completion (legacy) | Page height depends on step (1834 / 957 / 850) | Scrollbar flips, width shifts, scroll position lost | Single page, `scrollbar-gutter: stable` on main (verify the shell scroller), min-heights on result slots, never remove the target list when a job completes (mark rows "analyzed" and let the filter apply on the next explicit change). |
| Polling text in place | Same, progress width changes by a few px on every poll | Minor jitter | tabular-nums on counts, fixed-width counter, `transition: width` already present. |

## 5. Redesign spec

### 5.1 Principles
1. One page, one primary action. The wizard becomes a single workspace with three sections (Setup, Targets, Results) and a sticky action rail.
2. Chrome budget above the fold: PageHeader (title + one-line description) + one tab row + first content section. No stepper, no second switcher, no banner. First control reachable by y = 180 px at 1280x900 (today 270).
3. Borders budget: at most one bordered surface per section; inner groups use spacing and hairline dividers (`--border-subtle`), never nested cards. Target at most 4 bordered regions visible above the fold at 1280 (today 8).
4. Chips budget: no more than 2 status chips at once on the page (job status, and one data tag); metric chips are selectable controls, counted separately.
5. Stable layout: every region that can appear later has a reserved slot with a fixed or min height; nothing inserts above existing content.

### 5.2 Page structure (run scope)

```
PageHeader: "Auto-analysis"   description: "Diagnose failed metric targets of one run."   meta: Project x . run name
Tabs: [Analyze run] [Diagnosis categories] [Production rules] [Documents]     (live-job dot on Analyze run)

SECTION 1  Setup  (one bordered card, three hairline-separated groups)
   Run:   name   task . model . dataset                [Sample 2 v] [View run]
   Metrics: (exact_match) (execution_accuracy)  2 of 2   [All] [None]
   Instructions: textarea (3 rows, grows)            {vars} -> inline mapping rows appear in a reserved collapse
   > Input mapping   Default fields                  (disclosure, closed)
   > Prompt context  rules, documents, trace on      (disclosure / popover)

SECTION 2  Targets  (one bordered card)
   header: "Targets  22"   Filters: Max score [-----o--] 80%  Skip analyzed (o)  Human labels ( )   [More options v]
   list/table (36 px rows): [ ] item-2  exact_match 0.00  failed   input preview ...      pagination
   footer hint: "Check up to 3 to test them together"

SECTION 3  Results  (reserved slot; min-height = 160 px; skeleton -> content)
   idle:     EmptyState compact "Test or analyze to see results here"
   testing:  skeleton rows for the checked targets
   running:  progress + live counts (same slot), last item text
   done:     summary (counts, categories, error groups), test cards below

ACTION RAIL (sticky bottom, 56 px, always mounted)
   [LLM connection v]   Prompt preview . 8,837 chars (button -> Drawer)   ....   [Test selected (1)]   [Analyze 22 items]
   running:  [LLM connection (disabled)]  7/34 targets  [=====    ]  ....   [Cancel analysis]
   done:     34 of 34 succeeded  ....  [View run] [Analyze again]
```

- Single scroll container is main; rail is `position: sticky; bottom: 0` inside the page container (as `.nav` already is), so no extra scrollers. The target list does not become a second scroller: it paginates (10/20) as legacy did.
- Primary action: exactly one `variant="accent"` button visible at a time: `Analyze N items` (idle), `Cancel analysis` (danger, running), `View run` (done). "Test selected" is a secondary button.
- Prompt preview moves out of the flow into a `Drawer` (right, 560 px) opened from the rail ("Preview prompt") and from a target row action ("Preview"). The Drawer holds: previewed-target `Select`, context switches (Production rules / Project documents / Trace evidence), char tag, messages (single scroller, fixed height, no auto-scroll unless the user changed a mapping while the drawer is open), copy. Input mapping disclosure remains in Setup so the fields and the prompt are edited in different places, but the Drawer shows the "Fields sent" tags read-only. (Alternative considered: two-column Setup + Preview on 1920; rejected as it adds a second simultaneous bordered region.)
- Project guidance: the three tabs become top-level tabs (no SegmentedControl, no inner Tabs); panels unchanged. A running job shows its dot on "Analyze run" and the rail is also mounted on the guidance tabs only when a job is live (compact one-line state, same 56 px slot), so switching tabs does not move the page.

### 5.3 Responsive

| Width | Rules |
|---|---|
| 1920 | Container capped at the existing `fullWidth` token max or 1440 px content width, centered; Setup groups in a 2-column grid (Run+Metrics left, Instructions right) at >= 1500 px; targets list full width. |
| 1280 | As wireframe: single column, rail sticky. |
| 768 | Single column; the Setup groups stack; the rail wraps to two rows (connection select + preview button / buttons), still fixed 2-row height (min-height reserved); Drawer becomes a full-height sheet. |
| 390 | Tabs scroll horizontally (existing `Tabs` behaviour); target rows become two-line; rail shows only the primary button plus an overflow `DropdownMenu` (Test selected, Preview prompt, connection). |

### 5.4 Motion and loading model

- Rule: nothing pushes existing content. Mount order is skeleton -> content in the same box; transitions only on opacity/transform/width, 150-200 ms (`--transition-fast`, `ARRIVE_FADE_MS`), none under `prefers-reduced-motion` (use the existing global handling in `tokens.css`; add the same guard to any new keyframes).
- Load: page shell (header, tabs) renders immediately; Setup and Targets render `Skeleton` blocks with the real card heights (Setup 220 px, Targets 10 rows x 40 px) after `--skeleton-wait` (300 ms), held `--skeleton-min` (400 ms). Replace the current `kind="cards"` skeleton with `kind="rows"` shaped like the real layout. `scrollbar-gutter: stable` on the main scroller to remove width shifts when content height changes.
- State machine for the rail and Results slot (one `useAnalysisPhase()` derived from `runner` + `ws.test`): `idle -> testing -> idle(with test results)`, `idle -> starting -> running -> done | failed | cancelled`. Each state renders into the same two slots (rail, results) with fixed heights; button widths are fixed (`min-width` on the primary: 168 px) so label changes ("Analyze 22 items" / "Analyzing" / "View run") do not move neighbours.
- Starting: the primary button shows `loading` (already supported) until the first poll returns; do not move focus to a new region. Announce with `role="status"` text in the rail only.
- Running: poll every 1 s (as now) but render from a derived, memoized view (`completed`, `total`, `phase`, `retryNote`); progress width animated by CSS `transition: width 150ms linear`; counts use `font-variant-numeric: tabular-nums` and a fixed min-width so digits do not shift neighbours. No remount of the Results card per poll (key by job id only).
- Done: the target list stays as it was; rows analysed in this job get an "analyzed" tag via optimistic update from the job result; the list re-filters only when the user changes a filter or presses "Refresh targets" (so the 22 -> 0 collapse on completion disappears). Results slot swaps progress for summary in place. Toast only for failure/cancel; success is the rail text.
- Test: the targeted result cards render into the Results slot with skeleton rows for each checked target (max 3), replacing the "No test run yet" EmptyState in place; scroll the Results slot into view with `scrollIntoView({block:'nearest'})` only if it is off-screen, no focus steal (keep the aria-live announcement).
- Preview Drawer: opens instantly with skeleton lines; while `preview.pending` the message block gets `opacity: .6` (no text swap), char tag keeps its slot (fixed width 96 px).
- Sample switch: keep the previous rows dimmed (`keepPreviousData`) instead of replacing with a skeleton.

### 5.5 Primitives and API

Reuse: `PageHeader` (tabs slot), `Tabs`, `Skeleton`, `EmptyState`, `ErrorState`, `Drawer`, `Popover`/`DropdownMenu`, `Switch`, `Chip`, `Slider`, `Select`, `Button`, `Tag`, `Pagination`, `useDelayedPending`.
New / changed:
- `ui/Disclosure` (new primitive; none exists today): props `{ title: ReactNode; summary?: ReactNode; defaultOpen?: boolean; open?; onOpenChange?; children }`. Built on React Aria `Disclosure` (already a dependency via react-aria-components), height animation via `grid-template-rows: 0fr -> 1fr` 150 ms, none under reduced motion. Gallery entry in `/__ui`; add to DESIGN_LANGUAGE.md section 3 (tabs/disclosure line) and the design-language test allow list.
- `features/analyzer/blocks/ActionRail.tsx` (new): `{ ws, config, runner, onPreview }`; renders connection select, preview button, secondary test button, primary action by phase; replaces `RunBar` and the `.nav` footer and the sticky `JobStatus mode=bar`.
- `features/analyzer/blocks/ResultsSlot.tsx` (new): `{ runner, ws }` composing `TestResults` and `JobStatus mode=card` (card variant kept, bar variant deleted).
- `features/analyzer/blocks/PreviewDrawer.tsx` (new): wraps `PromptPreview` (keep `maxHeight` prop false) and the three switches.
- `features/analyzer/useAnalysisPhase.ts` (new hook, described above).
- `Skeleton` gains `kind="rows"` with `rows` and `rowHeight` props if not present (check `ui/Skeleton`); otherwise compose.
- `useTargets`: add `freeze` option so the list does not re-filter on job completion (in `useRunWorkspace.ts`).
- `Card` stays; add `variant="flat"` (no border, bottom hairline) for groups inside Setup to avoid card-in-card.

### 5.6 URL / state
`?run`, `?pass`, `?metric` unchanged. `?scope=run|categories|rules|documents` maps one to one to the tabs (aliases kept). `?step=` is accepted and ignored except `step=preview` opens the Drawer and `step=review|run` scrolls to the Results section, so old links keep working. Preview drawer open state: `?preview=1`. Draft Setup edits stay in component state (as now).

## 6. Work plan

| # | Task | Est. h | Files | Tests | Independent? |
|---|---|---|---|---|---|
| 1 | `ui/Disclosure` primitive + gallery + design-language doc/test updates | 4 | `frontend/src/ui/Disclosure/*`, `ui/index.ts`, gallery page, `docs/DESIGN_LANGUAGE.md` | Vitest primitive test (open/close, aria-expanded, reduced motion); `design-language.test.ts` | Yes |
| 2 | `useAnalysisPhase` + `ActionRail` + `ResultsSlot`, delete stepper/footer/bar wiring | 8 | `RunShell.tsx`, `RunAnalyze.tsx`, new blocks, `blocks.module.css`, `analyzer.module.css`, `steps.ts` | Vitest for phase derivation (idle/testing/running/done/failed/cancelled, reconnecting); update `workspace.spec`, `run.spec` selectors (`step()` helper in `e2e/analyzer/helpers.ts`, `waitWorkspace`) | After 1 (uses Disclosure only for mapping; can start in parallel with a stub) |
| 3 | Single-page Setup + Targets layout (Setup card with flat groups, compact target rows, "More options" for timeout/retries/max issues, Input mapping disclosure) | 8 | `RunAnalyze.tsx`, `blocks/Targets.tsx`, `blocks/Instructions.tsx`, `blocks/FieldsMapping.tsx`, `blocks/RunHeader.tsx`, css | `workspace.spec` (variable mapping, metric chips, targets), Vitest `targets.test.ts` unchanged | Yes (with 2 only sharing `RunAnalyze.tsx`; split by file ownership or sequence) |
| 4 | Preview Drawer (move `PromptPreview`, switches, target select, remove auto-scroll jump) | 5 | `blocks/PreviewDrawer.tsx`, `PromptPreview.tsx`, route `?preview` | e2e: open from rail, edit mapping, preview updates; a11y spec (focus trap, return focus) | Yes |
| 5 | Top-level Tabs for the four views; remove SegmentedControl and inner guidance Tabs; live-job dot; compact rail on guidance tabs | 4 | `AnalyzerPage.tsx`, `RunShell.tsx`, `GuidanceArea.tsx`, `ProjectLanding.tsx`, `useAnalyzerRoute.ts` | `cutover-routes.test.ts`, `guidance.spec`, `a11y.spec` | Yes |
| 6 | Motion/loading pass: skeleton rows, `scrollbar-gutter`, freeze target list on completion, optimistic "analyzed" tags, keepPreviousData on sample switch, tabular-nums, fixed widths, reduced-motion | 6 | `api/analysis.ts` (placeholderData), `useRunWorkspace.ts`, css, `useRunData.ts` | New Playwright spec `frontend/e2e/analyzer/smoothness.spec.ts`: asserts (a) no element above the Results slot changes `top` between idle, running and done states (probe `getBoundingClientRect` of header, tabs, Setup, rail), (b) accumulated `layout-shift` (user input excluded) < 0.01 during a stub job, (c) rail height constant, (d) target list row count unchanged at completion; Vitest for freeze logic | After 2 and 3 |
| 7 | Remove banner; move no-connection / read-only notices into the rail | 1.5 | `RunAnalyze.tsx`, `ActionRail.tsx` | `workspace.spec` no-connection test | After 2 |
| 8 | Metrics regression test of clutter budget (controls/borders above the fold at 1280) and visual QA at 390/768/1280/1920 incl. RTL | 3 | `e2e/analyzer/clutter.spec.ts`, screenshots | the spec itself: first control y <= 200, <= 4 bordered regions in the first 900 px, <= 2 status chips | Last |
| 9 | Docs: `ANALYSIS.md` in the feature folder, `qa/analyzer.md` update, DESIGN_LANGUAGE (Disclosure, rail) | 1.5 | docs | - | Last |

Total about 41 hours (about 5 working days, 3 agents in parallel after task 1: [2,7], [3,4], [5,6] with 8-9 last).

Risks: (1) existing e2e specs depend heavily on the stepper (`step(page,'Run')`, `waitWorkspace`, `Analysis steps` list); budget 3-4 h inside tasks 2 and 3 to port them, change `helpers.ts` once and have all specs use it. (2) Preview Drawer changes the mapping edit loop (edit on page, read in drawer): if testers find that awkward, fall back to an inline two-column split at >= 1500 px (only at 1920). (3) Freezing the target list means "Analyze N" count must come from the frozen set vs the live set: define N as the live matching count and show "(n analyzed this session)". (4) Optimistic "analyzed" tags need the job result item ids; verify `job.result.results[].item_id` is present for partial failures. (5) `scrollbar-gutter` support is fine in current browsers but must be set on the shell scroller (outside this feature), a one-line change in `features/shell` css.

## 7. Open questions (recommended defaults are used by implementation)

1. Is a guided stepper desired for non-technical users of this page (it was added in the React rebuild, UX_DECISION winner C)? Default: no; one page with a sticky action rail, as legacy.
2. Should finishing a job keep the analysed targets visible (greyed, tagged) instead of removing them via "Skip analyzed"? Default: yes, keep visible; re-filter on next explicit filter change or "Refresh targets".
3. Prompt preview: Drawer on demand, or always-visible second column on wide screens? Default: Drawer at all widths (fewer simultaneous borders).
4. Should success after Analyze still raise a toast? Default: no toast on success; toast only on failure/cancel.
5. Should the four views be one tab row (Analyze run / Diagnosis categories / Production rules / Documents) as in legacy? Default: yes.
6. "Test selected" limit (3) and the auto-test of the previewed target when nothing is checked: keep? Default: keep as is.
7. Cap content width on 1920 (1440 px) or full width as legacy? Default: cap at 1440 px, 2-column Setup at >= 1500 px.

## 8. Summary for the orchestrator

1. "Analysis page" = `/projects/:slug/analysis` workspace; run-detail Root cause tab is a results viewer and out of scope.
2. Legacy was one long single-column page (3274 px for 22 targets) with a footer action bar; it was linear but also jumpy (page shrank 1700 px at job completion).
3. React turned it into a 4-step wizard: area switcher + 4-tile stepper + sticky job bar + sticky Back/Next footer put the first control at y = 270 px; primary action is on step 3 of 4.
4. Measured: Configure fold 20 controls / 7 bordered boxes / 3 chips; Preview 29 controls / 12 boxes / 8 chips (worst); legacy 13 / 9 / 2.
5. Not smooth, concretely: job start inserts a 60 px bar that pushes everything down (stepper 205 -> 265), page height flips 1834 / 957 / 850 between steps (scrollbar and width shift), button labels thrash ("Analyze 22 items" -> "Analysis running" -> "Analyze 0 items"), outcome announced in three places, prompt scroller auto-jumps. Polling itself is fine (CLS 0.0011 for a full 34-target job, 1 poll/s).
6. Redesign: one page (Setup, Targets, Results slot) + sticky action rail with a single accent button per state, one tab row, prompt preview in a Drawer, input mapping in a Disclosure, no stepper/banner/segmented switch.
7. Motion model: nothing inserts above content, reserved slots, skeleton rows after 300 ms, `scrollbar-gutter: stable`, fixed-width counters, target list frozen on completion, reduced-motion respected.
8. New: `ui/Disclosure`, `ActionRail`, `ResultsSlot`, `PreviewDrawer`, `useAnalysisPhase`; every capability in 3.4 is kept.
9. Estimate: about 41 h (9 tasks; after the Disclosure primitive three agents can split tasks 2+7, 3+4, 5+6).
10. Defaults: no stepper; keep analysed targets visible; preview in a Drawer; no success toast; single tab row; keep Test limit of 3; cap width at 1440 px.
