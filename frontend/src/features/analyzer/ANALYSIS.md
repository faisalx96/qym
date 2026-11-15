# Auto-analysis workspace

`/projects/:slug/analysis?run=ID` is ONE page in the shared constrained (centred) container: PageHeader, one tab row
(Analyze run, Diagnosis categories, Production rules, Documents), then Setup, Targets, Results (framed
`ReportSection`s, as on the run page) and a sticky action rail. No stepper.

- **Setup** (one `ReportSection`, four `Subsection`s in reading order, cv4 D4): **Run and metrics** (Task, Model,
  Dataset, Run ID as a `KeyValueGrid`; Pass select and View run in the head; one `MultiSelect` "Metrics"),
  **Input mapping** (INPUT / EXPECTED / OUTPUT rows, always shown; item bodies load when a JSON field picker opens or a
  `{variable}` exists), **Prompt contents** (Item data: Error, Scores, Metric metadata; Context: Rules, Project
  documents, Trace evidence; one switch per line), **Instructions** (textarea and `{variable}` rows).
- **Targets** (`ReportSection`): max score, Skip analyzed, Re-analyze human labels, a closed "More options" Disclosure
  (timeout, limit, max issues), then a `DataTable`: check (max 3, for Test), Item, Metric, Score, Diagnosis (only
  while a target has one), Input, Preview row action; 10 per page with the shared pager in the footer. A row click
  opens the prompt preview of that target.
- **Results**: reserved slot (`--results-slot-min-height`); job card (progress, then summary) and test cards
  render into it. Nothing above it ever moves.
- **Action rail** (`blocks/ActionRail.tsx`, `--bar-action-h`): connection, "Prompt preview . N chars"
  (opens `PreviewDrawer`, 760 px; its Context switches are the same `ws.settings` as Prompt contents), Test selected, and exactly one primary per phase: Analyze N items (accent) /
  Cancel analysis (danger) / View run (accent) / Analyze again (accent after a failure). Notices (no connection,
  view only) are text in the rail. At 390 px Test and Preview move to an overflow menu.
- **Phase**: `useAnalysisPhase` derives idle | testing | starting | running | cancelling | done | failed |
  cancelled (+ reconnecting) from the runner and the test; rail and Results both read it.
- **Target list freeze**: when a job starts the list keeps its rows (`useRunWorkspace.frozen`); rows analysed
  in the job get an optimistic "analyzed" tag. It re-filters on a filter change or "Refresh targets".
  "Analyze N" always counts the live matches.
- **Toasts**: only failure, partial failure and cancel. Success is shown in place.
- **URL**: `run`, `pass`, `metric`, `scope` unchanged; `preview=1` opens the drawer. Legacy `step=preview` opens
  the drawer, `step=run|review` scroll to Results; the param is then dropped.
- **Guidance tabs** keep the run workspace mounted (hidden); a live job shows a dot on "Analyze run" and a
  compact rail (`CompactJobRail`) in the same fixed-height slot.

## What the redesign does and does not claim

The 1280x900 fold is not numerically lighter than the old Configure step (about 50 controls, 11 bordered elements
with hairlines, versus 20 / 7). `e2e/analyzer/clutter.spec.ts` pins the measured numbers as a regression guard only.
The gain is structural (one tab row, one accent action per state, prompt in a drawer, advanced fields in
disclosures, no stepper, job bar or footer) and smoothness (nothing above Results moves; layout shift about 0.003
over Test then Analyze).
