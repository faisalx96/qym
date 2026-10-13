# Review: redesign `tables` (branch ui/redesign-tables)

Reviewer run against worktree `qym-wt-redesign-tables` (platform 8854, Vite 5854), dark theme, 402 runs, 3 datasets
(25/40/300 items, one with a 90-character name), experiments, queue, environments, admin, trash. Screenshots (1440 and
390): `/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/tables-review/shots/`.

## Verdict: DOES NOT MEET THE STANDARD

The primitive (`ui/DataTable`) is genuinely richer and the gallery proves it (score bars, row rails, two-line cells,
grouping with aggregates, card mode, column menu, density). But the shipped pages use little of it: the flagship runs
list has no score bars, no chips, a Date column that is off screen on first paint, truncated headers everywhere, and
clicking or selecting text in a row navigates away. A product owner who said "too simplistic" will see a table that is
about as dense and as plain as before on the runs list, queue, admin and environments, and a visibly richer table
(Charts) that was not migrated. Fix list is a focused implementation pass of about 2-3 days (not a re-run), mostly
column definitions and three primitive fixes, plus the Charts adoption (6 h).

## Evidence

| Check | Result | Evidence |
|---|---|---|
| `npm run check` (typecheck, eslint, stylelint, Vitest, design test) | PASS, 119 files / 1110 tests, design-language 35 | `tables-review/check.log` |
| `npm run build`, `npm run build:sdk` | PASS | `build.log`, `buildsdk.log` |
| Full Playwright `npm run e2e` | PASS, 880 passed, 11 skipped, 0 failed (25.2 min; the earlier failure is fixed) | `e2e-full.log` |
| `npm run e2e:sdk` | PASS, 42 passed | `e2e-sdk.log` |
| axe (wcag2a/aa, 21a/aa, best-practice), 14 pages x 1440 and 390 incl. gallery, runs, queue, experiments, envs, datasets, admin x4, settings, profile, trash | 0 serious/critical; moderate only: `heading-order` on admin and profile, gallery `region`/`landmark` | script output in review session |
| Roles | `<table role=grid>` (`treegrid` when rows expand so `aria-expanded` is valid), `row`, `columnheader` with `aria-sort`, `gridcell`; `aria-rowcount`/`aria-rowindex`; `aria-selected` only with selection; scroll region labelled `(scrollable)` | `DataTable.tsx:1086-1105`, `:775-790`, `:1055-1067`, `:1206` |
| Spike decision (own markup over RAC `Table`) | Accepted. The four reasons in `## Decisions` hold; roles/axe are clean. Residual: the header band row is `aria-hidden` (`DataTable.tsx:1101`) so screen-reader users never hear the column groups ("Scores", "System"). | |
| Single-click opens row vs select mode | Select mode OK: with Select active, clicking a cell toggles, shift-click ranges (1 then 3 rows), no navigation (`DataTable.tsx:590`). | `shots/runs-select.png` |
| Single-click opens row vs text selection | BROKEN, see M1. | |
| Keyboard | Arrows, j, Home/End, PageDown (+10), Enter open row: work. Header Tab stops: see M3. | |
| Cards at 390 | Work on runs, experiments, datasets items, admin, trash; queue card is broken, see M5. | `shots/*-390.png` |

## Feedback point: "table design is too simplistic and not user friendly"

Partly answered, in the primitive and the gallery (`shots/gal-1.png`, `gal-2.png`: score bars with direction colours,
rails, two-line run cell, group rows with `avg`, pinned columns, edge shadow). Not answered where the owner works:

- Runs list (`shots/runs-1440.png`): 32 px rows, plain text for Task/Model/Dataset (legacy had chips, see
  `scratchpad/tables/l-runs.png`), metric cells are a 2 px tick plus coloured number (`ScoreValue`,
  `features/runs-list/cells.tsx:318`), not the 6 px `ScoreBar` of the spec wireframe and the gallery. Row hierarchy is
  unchanged from the previous React table.
- Queue, environments, admin, experiments: header recipe plus rows, an empty trailing actions column (about 90 px of
  nothing at 1440), truncated headers. Better chrome (Columns, Density, footer count) but the same plain look.
- The one table that does look rich (Charts, `shots/charts-1440.png`) is exactly the one deferred, so the app now
  has two table languages, and the better one is the page-private one.

"One system" test: 22 tables share chrome, hover, selection and menus (good, consistent card, footer, tokens). They do
not share content richness (scores, chips, progress) and the runs list keeps its own toolbar, selection bar and status
bar outside the primitive (`DataTable.Toolbar/Footer` deferred), so it sits visually apart from the other tables
(`runs-select.png` shows two stacked bars under the table).

## Fix list

### Blockers
None as defined (no feature lost), but M1 and M2 together keep the feedback point from being met.

### Major
- **M1 Row click destroys text selection.** Drag-selecting or double-clicking a word in a runs row navigates to the run
  (verified: URL changes, selection empty). `onRowClick` (`DataTable.tsx:589`) never checks
  `window.getSelection()?.toString()` nor the drag distance. Fix: ignore the click when the selection is non-empty
  and inside the row, or when pointer moved more than 4 px between down and up; also stop shift-click leaving native text
  selection (blue highlights in `runs-select.png`; `preventDefault` on mousedown with shift in select mode). Add a spec.
- **M2 Runs list metric cells are not score bars; Task/Dataset not chips; Date off screen.** Spec 5.4/5.9/5.10 and brief
  Q3: use `ScoreBar` (type `score`) for percentage metrics (`cells.tsx:296-330`, `RunsTable.tsx`), `Tag`-style chips for
  task and dataset, and make Date visible on first paint: at 1440 the table is 3250 px wide and Date starts at x=1489
  of 1218 visible px, the default sort column is invisible. Reorder (Run, Status, scores, Date, Task, Model) or give the
  second "Run" band group a default narrower set. Also the band row reads "Run | Scores | Run" because Signals..Version
  reuse group `run` (`columns.ts:4`); rename groups (Run, Scores, Context, System, Trace).
- **M3 Header tab stops: 3 per column.** Sort button, column-menu button and focusable resize separator
  (`DataTable.tsx:852-856`) are all tab stops; the runs table has 33 columns, about 100 Tab presses to reach the first
  row, against spec 5.7 "Tab enters the table once". Fix: roving tabindex across headers (arrows move between header
  cells, Enter sorts, Shift+F10 or ContextMenu menu, Alt+Arrow resizes) with one tab stop for the header row.
- **M4 Truncated headers.** Spec 5.10 explicitly promised "column minWidth from header text length, header tooltip"
  to fix `EXACT_MA...`. Still truncated: `ANSWER ...`, `CONTEXT...`, `SIG...`, `FAITHFUL...`, `EXECUTI...`, `⚡ AVG...`,
  `PRIO...`, `ELAP...`, `DEFAULT PRE...`, `PRIORITY C...`, `PROG...`, `UPDAT...`, `CREAT...`, `R..`, `LAT...` on
  runs, queue, environments, admin, dataset items. Fix in the primitive: derive default `minWidth` from header text
  (plus sort glyph and kebab) and let the metric columns in `columns.ts:146-153` start wider than 124 px.
- **M5 Queue card mode leads with the empty Position column.** At 390 each queue card starts with "☐ —" and
  the experiment name sits on the second line (`shots/q390-cards.png`). Cause: `pos` is `pin: 'start'`, `priority: 1`
  (`QueuePage.tsx:204-210`) so card mode puts it on line 1. Fix: card mode should lead with the first column that has
  content and a title (add a `cardTitle` flag, or make `pos` priority 2), and queue should show position in the card body.
- **M6 Charts page tables not adopted (6 h)** (`runs-list/ChartsPage.tsx`, 914 lines, own raw `<table>` and its own
  local `ScoreBar` at `:889` that shadows the `ui` primitive). The brief included it (5.10) and nothing blocks it: the
  primitive already has `groupBy`, `summary`, relative `ScoreBar` (gallery `gal-2.png`). No good reason to defer; it is the
  proof of "one system". Keep `charts.spec.ts` and `ux-charts.spec.ts` green.
- **M7 Empty trailing column on every table with a hover-only actions cell.** 90-110 px of dead space at the right of
  experiments, queue, environments, admin users and others (`experiments-1440.png`, `envs-1440.png`). Either auto-size
  that column to its content (zero width when no row has actions, as users with only one self row) or move actions to
  an overlay on hover. Row actions exist (`EnvironmentsList.tsx:164`, `UsersTable.tsx:134`) but are hover-only, so at rest the column reads as a
  rendering gap and the actions are undiscoverable by keyboard-less touch-free users; show a faint kebab at rest.

### Minor (8)
1. Sort click cycles asc, desc, asc on the runs list (URL sort has no "none"); spec says asc, desc, none.
2. Queue "Position" column header renders as a tiny unlabeled glyph, cells "—" for running jobs (`q-selected.png`).
3. Header band is `aria-hidden` (`DataTable.tsx:1101`); expose group names via `aria-label` on the first header of a group.
4. Trash at 1440: Dataset column clipped behind the pinned Restore column with no scroll cue visible
   (`trash2-1440.png`); the mirrored rail only appears when the page can scroll.
5. Elapsed value in the queue is vertically 2 px off the other cells (`queue2-1440.png`), numeric cell baseline.
6. Runs list has no Density control and no page size; spec wireframe has both. Density is page-level default only.
7. `design-language.test.ts` does not gain the planned rule "raw `<table` only in `ui/DataTable`"; 18 other files
   still use raw tables (RepeatTab, MatrixCard, compare tabs, ...). Add the rule with an allow-list so the debt is visible.
8. Selection bar replaces the whole toolbar on queue (filters vanish while rows are selected), the 40 px stays but the
   Environment/Status/Experiment selects are the user's context; consider keeping them.

## Deferred list, reviewed critically

| Deferred item | Verdict |
|---|---|
| A2 run-detail items and A3 compare matrix, T7 virtualization | Acceptable for this pass (the report-pages area owns those pages). The primitive must keep `virtualize` on the plan; note it blocks the 3,000-item case which I could not test. |
| A7 Charts adoption (6 h) | Not acceptable, see M6. |
| `?` shortcut sheet, Ctrl+A in the primitive | Acceptable as minor; trash already has a local Ctrl+A which is a duplicate of the planned primitive behaviour. |
| Runs toolbar/status bar into `DataTable.Toolbar/Footer` (4 h) | Should be done: it is why the runs list looks different from the other 21 tables and why selection state shows as two bars. |
| Dataset items preview, Cancel row action, experiments search, `RowAction.hint` (3 h) | Acceptable except `RowAction.hint` which affects discoverability of icon-only row actions (the "x" cancel icon on the queue has no label). |
| `test.fail` in `cutover-navigation.spec.ts` | Fine, belongs to run-detail. |

## Code notes
- `DataTable.tsx` is 1446 lines in one file with a file-level eslint-disable of four jsx-a11y rules (reasoned, line 1)
  and one `react-hooks/exhaustive-deps` at `:351`; split render parts (cards, header, body) into `parts.tsx` to keep it
  maintainable. No `any` found in `ui/DataTable`.
- Dead code check: `SelectionBar.tsx` (runs-list) is still used by `RunsPage`; `RunsTable.module.css` is 9 lines; no
  leftovers of the v1 shim found.
- Tests: `ui/DataTable/__tests__` and page specs updated; no spec covers drag-selecting text in a clickable row.
