# Analyzer design notes (three variants)

Mocks: `/app/__mock/analyzer/{tabs,rail,flow}` (dev only, no network). All three render the same
state hook (`shared/state.ts`), the same blocks (`shared/*.tsx`) and the same Diagnosis / Rules /
Documents tabs (`shared/Guidance.tsx`); only the composition differs, so the comparison is about
layout, not feature coverage. Fixtures (`fixtures.ts`) follow brief 08 section 4 and include one Arabic item (#3).

What every variant fakes so it can be judged:
- The preview is built from the real mapping: changing a source, ticking JSON paths, toggling
  Error / Scores / Metric metadata, or typing `{rubric}` changes the prompt text and flashes an "Updated" badge.
- Test selected (1 to 3 checked targets, else the previewed one) takes 1.4 s and has a Cancel test button.
- Analyze N items starts a timer-driven job (1.4 s per item, a 2.2 s "retrying" window at item 3,
  then aggregating, then completed with error-code groups). Cancel works. The job lives in
  `sessionStorage`, so a reload resumes it ("resumed after reload" tag). Completion marks the
  targets analyzed, so "Skip analyzed" removes them.
- Diagnosis: Hallucination starts without "Use when" (Taxonomy required). Fill it, press Save: the
  first save always returns a fake 409 (banner: Reload latest / Overwrite with my edits).
- Rules: v5 is an editable draft (700 ms autosave cue, Publish dialog with "Set as production");
  v3 can be promoted; Generate rules runs a timed progress card.
- A "Run scope / Project scope" toggle in each page header shows the no-run landing.

## Common decisions (all variants)

- Fields mapping always shows a one-line summary of its current state and never lives in a modal.
- "Fields sent" chips appear under the preview and in each test result (derived from the request
  config, not regexes on the prompt; OPEN_QUESTIONS Q6).
- Target rows: the checkbox picks up to 3 items for Test; the per-metric button picks the previewed
  target. Root-cause chips use the Tag primitive with text, never colour alone.
- Categories without approved examples carry a "Needs examples" badge (OPEN_QUESTIONS Q3).
- Logical CSS everywhere that can matter (`inline-start`, `text-align: start`); user text blocks get
  `dir="auto"`, the Arabic item gets `dir="rtl"`.
- No `window.confirm`/`prompt`; publish uses a Dialog.

## A. Tabs (`tabs/`)

Four top tabs (Analyze run / Diagnosis categories / Production rules / Documents). Analyze run is one
column of cards: Run, Instructions, Targets, then a collapsible **Fields** panel directly above the
**Prompt preview**, then Test results, the job card, and a sticky footer holding the job bar
(only while a job exists) plus the run bar (connection, Test selected, Analyze N). When Fields is
opened at 1100px or wider the two sit side by side (Fields left, preview right), so a mapping edit
and its effect are on screen together. The tab label shows a live "3/25" badge while a job runs.

- Pain points solved: Input mapping modal far from the preview (inline panel, summary when
  collapsed, side by side when open); `<details>` nesting; progress bar moved between cards
  (job bar and rule-generation card are separate components); sample-switch guard (select disabled
  with a reason while a job runs); Test with no cancel; "Fields:" regex badges.
- Not solved: Fields still requires scrolling past the Targets list in the single column unless
  the user knows to open it; the job is only globally visible as the tab badge, so on Diagnosis /
  Rules / Documents the progress itself is hidden.
- Closest to the vanilla page and to every other area of the app (cards in a 1120px column), lowest
  re-learning cost, lowest implementation risk.
- 760px: content is already one column. The sticky footer wraps to two rows (select above actions);
  the side-by-side Fields/preview collapses to stacked below 1100px of viewport (the sidebar leaves ~600px).
  Tabs scroll horizontally.
- RTL: tab list and cards mirror via flex/logical properties; the sticky footer is symmetric; mono
  JSON path names stay LTR inside `unicode-bidi: plaintext` blocks.

## B. Rail + results (`rail/`)

Left configuration **rail** (Run + metrics, Instructions, Fields, Target filters collapsed with a
summary, and a pinned footer with connection, Test selected and Analyze N) beside a **results**
column (Targets list, Prompt preview, Test results, job card). Diagnosis / Rules / Documents are
secondary tabs of the same page. A **persistent job status bar** (phase badge, "3 / 25 items", retry
line, progress, Cancel; after completion View run / Dismiss) is sticky under the tabs and stays
visible on every tab.

- Pain points solved: Fields next to the preview with no scrolling (both always on screen at
  1440px, rail scrolls on its own); the run action is always visible (pinned rail footer); job
  visibility on every tab (Rules generation vs analysis no longer compete for one DOM node because each
  has its own component); the target count and filters are one click from the preview.
- Tradeoffs: densest layout and the biggest departure from the rest of the app; the rail is 340-400px,
  so the Fields rows and JSON-path tree wrap; two scroll regions (rail and page); the rail is long,
  so Fields sits below Run and Instructions; Targets list competes with the preview for the same column.
- 760px: below 1100px of viewport (sidebar included) the grid becomes one column, the rail stays
  first as a static stack of disclosure sections and the pinned footer becomes a normal block; the
  job bar stays sticky. A real implementation should make the rail a "Configuration" drawer here.
- RTL: the rail flips to the right (grid + logical padding); the sticky bar and tabs mirror.

## C. Guided flow (`flow/`)

"Analyze run" has a four-step stepper: **Configure** (run, metrics, instructions, targets),
**Preview** (Fields left, prompt right, a "Previewed target" select above), **Run** (connection,
Test selected, results, job card), **Review** (completion card, error groups, View run). Steps are
buttons (not locked) with state notes ("25 targets", "1,496 chars", "3/25", "Complete") and Back /
Next in a sticky footer. Diagnosis / Rules / Documents are under a "Project guidance" segmented area
with their own tabs. The compact job bar shows on every step and (as a badge) on the guidance area.

- Pain points solved: Fields and preview are paired in one dedicated step (no scrolling between them);
  the page stops being a 6-card wall; "what next" is explicit; the review step gives the completion
  summary a home.
- Tradeoffs: the most clicks for the J1 happy path (4 steps) and for expert users who tweak and
  re-run; hides the targets list from the Preview step (so a target is chosen via a Select), and
  the Test results live on the Run step rather than beside the preview; a stepper implies an order
  that the data model does not enforce; the most new UI.
- 760px: the stepper becomes a 2x2 grid, Fields/preview stack (below 1100px), footer stays sticky.
- RTL: stepper order and Back / Next mirror with the document direction (icons are `prev`/`next`
  glyphs; a real implementation must swap them under `dir=rtl`).

## Open items for the implementer

- The mock chrome (`shared/MockChrome.tsx`) is a static stand-in for `AppShell`; the real page uses it.
- `Tabs` vertical orientation leaks its styles into a nested horizontal `Tabs` (descendant
  selector `.tabs[data-orientation='vertical'] .list`); the Diagnosis category sidebar therefore
  uses a button list. Fix in the primitive or keep the list.
