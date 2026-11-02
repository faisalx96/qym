# Experiments launch + queue: design notes

Mocks live at `/app/__mock/experiments/<variant>`. They share `useLaunch.ts` (state, derived changes,
issues, run count), `LaunchParts.tsx` (every field group, review pieces, launch bar), `QueueParts.tsx`
and `fixtures.ts`, so the variants differ only in layout and navigation. All issues carry a human
field label with the JSON pointer as secondary mono text; clicking one reveals the section and focuses
the field (`data-field-id`). Pain points refer to brief 06 section 7.

Fixture state to try: initial "4 changes on top", judge slot empty (1 error), 5 runs (cap 8). Add a
temperature value to exceed the cap (10 runs, second error).

## A. wizard

Refined six-step wizard on the shared Tabs (arrow keys work, fixing the tabs-without-keys a11y pain).
Every step has a count badge (what you changed there; danger tone when it has a problem); each step starts
with its own problem summary; the last step lists changes per step with Edit links, so the review replaces
"Skip to review" and nothing hides. Addresses: lost Evaluation config (always a visible tab with a count),
JSON pointers (labels first), Raw JSON (drawer from the launch bar, reachable on review).
Trade-offs: still six screens (most steps to complete), Sweeps share the Environment step, the user sees
the live run count only on review/settings, so mistakes surface late. Closest to current mental model.

## B. scroll

One page, left outline of anchors with live badges (changes, run count, red problem count), right sticky
review with summary, problems and launch bar. Addresses: hidden steps (everything visible), skip-to-review
(no such concept), pointers (clickable problems scroll to the field), Raw JSON no longer far from fields
(drawer opens beside the form without leaving it). Trade-offs: long page (about 3 screens) so mobile gets
very long and the outline collapses to chips; three columns are tight under 1200px; relies on scroll-margin
and IntersectionObserver for active section in the real build.

## C. twopane

Entry choices (environment, dataset, start-from, base status) become a compact header block; the form
below is collapsible sections (models, config, sweeps, evaluation, raw JSON) with "N changed" badges; the
right pane is always the live review (big run count, validation, launch). Addresses: pointers (focus
reveals the collapsed section), three model concepts (global control sits at top of Models, each slot
shows Follow / Custom / Temporary explicitly), Raw JSON as a section next to the fields. Trade-offs:
collapsed sections can hide work (mitigated by badges and auto-reveal on problems); the entry block adds
height before the first section; a11y relies on disclosure buttons, not tabs.

## Model concepts (all variants)

Global model card on top; each slot is a three-way segmented control (Follow global / Custom / Temporary)
with a tag stating the current source, so the "later global change overwrites custom" rule is
visible: only Follow-global slots move. Temporary models show a chip that the key lives in memory only.

## Queue variants

queue-table: env summary cards on top, then one flat table in dispatch order (position, job, env, state,
progress, wait reason inline under the job). Best for answering "what runs next overall". Cost: env
health/blocked context is detached from the rows.
queue-grouped: one section per environment with health, in-flight/limit, queued, blocked in the group
header, each with its own table. Best for "why is my job blocked in this environment"; loses a single global
dispatch order and doubles the vertical space when an environment is idle.
Both: bulk bar when rows are selected, split cancel dialog (Queued here / Submitted or running on the
service / Not allowed, with the reason why running jobs are excluded), HIGH tag, progress bars.
Known mock gap: DataTable selects by row click and shows no checkbox column.
