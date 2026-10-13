# Auto-analysis workspace

`/projects/:slug/analysis?run=ID` is ONE page: PageHeader, one tab row (Analyze run, Diagnosis categories,
Production rules, Documents), then Setup, Targets, Results and a sticky action rail. No stepper.

- **Setup** (one card, hairline groups): run header + sample select + metrics, instructions with `{variable}`
  mapping rows, and a closed `Disclosure` "Input mapping" (INPUT / EXPECTED / OUTPUT, include toggles).
- **Targets**: max score, Skip analyzed, Re-analyze human labels, a closed "More options" Disclosure (timeout,
  limit, max issues), compact one-row-per-target list (10 per page), per-row Preview.
- **Results**: reserved slot (`--results-slot-min-height`); job card (progress, then summary) and test cards
  render into it. Nothing above it ever moves.
- **Action rail** (`blocks/ActionRail.tsx`, `--action-rail-height`): connection, "Prompt preview . N chars"
  (opens `PreviewDrawer`), Test selected, and exactly one primary per phase: Analyze N items (accent) /
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
