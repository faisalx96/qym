# Experiments launch + queue: UX decision

Method: Playwright on all 5 variants at 1360x900 and 390x800 (shots `/tmp/claude-1000/shots/ux-*`), plus
keyboard and mouse scripts. Brief 06 journeys 4 (launch), 5 (retry/temp key), 7 (queue), 8 (cancel) and
section 7 pain points. Scores 1-5, higher is better.

## Scores

| Criterion                             | wizard | scroll | twopane | queue-table | queue-grouped |
| ------------------------------------- | ------ | ------ | ------- | ----------- | ------------- |
| Task success (J4 / J7)                | 4      | 5      | 5       | 5           | 4             |
| Steps to complete                     | 2      | 4      | 5       | -           | -             |
| Discoverability (lost Evaluation tab) | 5      | 4      | 4       | 4           | 3             |
| a11y                                  | 5      | 4      | 4       | 4           | 3             |
| Density                               | 2      | 3      | 4       | 4           | 3             |
| Mobile (390)                          | 3      | 2      | 3       | 3           | 3             |
| Consistency with app                  | 5      | 3      | 4       | 5           | 4             |
| Pain points (sec 7) addressed         | 4      | 4      | 5       | 4           | 4             |
| J8 cancel dialog                      | -      | -      | -       | 5           | 5             |
| **Total launch / queue**              | **30** | **29** | **34**  | **31**      | **28**        |

## Findings

**wizard.** Tab and arrow keys work (Left/Right/End move between tabs, panel is the next Tab stop). Enter on a
start card selects it. Clicking a problem on Review jumps to Models and focuses the judge Select (ok).
Over cap: the Environment step shows a callout, 15 runs in red and the badge turns red, but the run count
and launch button are only visible on Review, so the mistake shows late. Launch disabled correctly. At
390px the tablist is 911px wide inside 362px: Review is off screen (reachable only by Next). Count badges
are hardcoded (where=2, start=1), so they carry no information.

**scroll.** Fix flow works: clicking the problem scrolls to and focuses the judge Select, and fixing it clears
the problem. Outline links are `<a>` anchors (Tab order good), badges live. Launch bar sticky at 1360 but at
390 the Launch button is at y=2729 (end of the page) with no sticky bar. Page is 2174px tall at 390 and
three columns are cramped. Raw JSON drawer opens with focus on the dialog, Escape returns focus to the
trigger button (correct). Subtitle truncates at 390.

**twopane.** Best live feedback: 15 runs and both problems appear in the right pane while you edit the
sweep, and launch is disabled with "Fix 2 problems". Problem click focused the judge field with the
section already open. Entry block costs 270px before models but is the whole "start" journey on one screen.
Raw JSON is an inline section (no focus trap needed, no dialog). The "Raw JSON" button in the launch bar
only expands that section, no scroll or focus move (it appeared to do nothing when off-screen). At 390 the
review pane (and Launch, y=2222) is last in the DOM and far below. "1 runs" plural bug in the bar.

**queue-table.** One dispatch order with a `#` column, global filters and an experiment Select (Tab goes
Select, status filter, then rows; each row is one Tab stop, Space selects, arrows move). Bulk bar appears
on selection. Wait reasons are inline under the job, which answers "why blocked" in place. At 390 the
State and Progress columns are cut off by a horizontal scroll inside the table (page itself does not
scroll; no page-level overflow at any width).

**queue-grouped.** Same table API, but two tables each with their own head, so the experiment filter and
global order are gone, and each table needs its own horizontal scroll at 390 (State clipped as "RUNN").
Group header counts are clearer for "is this environment healthy" but cost vertical space.

**Cancel dialog (both queues).** Focus moves into the dialog, Tab is trapped (Close, Reason, Keep, Cancel
cycles), Escape closes and returns focus to "Cancel selected". Split sections work. Title says "Cancel 3
job(s)" but the button cancels 1: confusing; the button should name the count and mention that the other 2
were left alone. No checkbox column: selection works by row click, Space and arrows but nothing visually
signals that rows are selectable (discoverability 3/5; the highlight is faint, the bulk bar is the only cue).

No console errors, no page-level horizontal overflow, no unlabeled controls detected in any variant.

## Verdict

- **Launch: twopane (C).** Highest steps-to-complete and live run count and problems while editing; it
  satisfies pain points on JSON pointers (label first), three model concepts (segmented control) and Raw JSON
  proximity. Add the wizard's strengths below to cover its a11y and mobile weaknesses.
- **Queue: queue-table (A).** Keeps the experiment filter (pain point: select an experiment with no live
  job still needs a real list, see hazards), the global dispatch order, and one table on mobile.

## Borrow from the losers

- From wizard: per-section problem summary at the top of each open section, and the "Changes by step" list with
  Edit links as the review (a "Changes" block in the right pane). Arrow-key tab semantics are not needed, but keep
  count badges with real values.
- From scroll: the left outline with live badges as a sticky section index above 1200px; sticky mobile
  launch bar; drawer-style Raw JSON for mobile (focus trap, returns focus).
- From queue-grouped: the health badge and "in flight / limit" as a header chip on each row group in the
  table (show the env name column, but sort by dispatch order); the idea of a per-environment filter.

## Hazards for the real build

1. Mobile: review pane must become a sticky bottom bar (run count, first problem, Launch); currently Launch
   is 2200px down. Wizard-style tablists need horizontal scroll-into-view of the selected tab.
2. Problem click must reveal (expand) the section, scroll (use scroll-margin) and focus the field; fall back
   to the section heading when the pointer maps to a container (current dry-run pointer prefix matching).
3. Make Raw JSON button in the bar expand, scroll to and focus the section. Raw edits and form edits must
   share one state or edits are lost when collapsing; validate JSON before replacing the form.
4. DataTable has no checkbox column: add a visually-hidden or real checkbox column (or visible selected
   state + "Select all"), and mark rows with `aria-selected`; the selected highlight needs more contrast.
5. Cancel dialog: label counts consistently, disable cancel when nothing is cancellable, handle the
   "not allowed" live jobs with a link-like action, and verify focus returns to a surviving element after the
   rows disappear on success.
6. Pluralise ("1 run"), do not hardcode step badges, and keep run-count debounce (dry-run POST every 600 ms)
   without dropping focus when sections re-render.
7. Experiment filter must come from the experiments list, not from returned jobs.
8. Temp-model key re-entry (`temporary_key_required` 422) is still unmodelled: reserve a place in the Models
   section and the launch bar for it.
