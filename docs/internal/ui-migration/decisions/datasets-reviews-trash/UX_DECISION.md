# UX decision: datasets / reviews / trash

Method: Playwright at 1280x800 and 1440x900 (dark), every view of `pane`, `page`, `focus`;
keyboard flows run; axe-core per view (1280, serious+critical); compared with `/app/projects/acme/settings`.

## Scores (1-5, higher is better)

| Criterion | A pane | B page | C focus |
|---|---|---|---|
| (a) Item edit: task success (type change, save, guard) | 5 | 5 | 3 (no cross-field view, no guard in popover) |
| (a) steps to fix one field | 3 (row, edit, save) | 2 (open page, edit, save, back) | 5 (cell, edit, Enter) |
| (a) discoverability | 4 | 4 | 3 (hint line only) |
| (a) a11y | 4 | 5 | 2 (106 table tab stops vs 58) |
| (a) density / context kept | 4 (table stays) | 2 | 5 |
| (b) Reviews: task success | 5 | 4 | 4 |
| (b) steps (decide + advance) | 5 | 4 | 4 (a/r work, but buttons below fold) |
| (b) discoverability | 4 | 3 (15 controls, 2 toolbar rows) | 3 (filters hidden in drawer) |
| (b) a11y (axe serious/critical) | 3 (nested-interactive 7, contrast 3) | 4 (contrast 1) | 3 (same as pane) |
| (b) density per 800 px | 5 (7 rows + full detail) | 2 (3 cards) | 3 (7 queue rows, 1 correction; actions at y=802) |
| Consistency with settings | 5 | 3 (mono, boxed Tabs differ) | 4 |
| Total (a) / (b) | 4.0 / 4.4 | 3.6 / 3.2 | 3.6 / 3.4 |

Axe per view (serious/critical rule ids): `aria-valid-attr-value` (1) and `link-in-text-block` (3) appear in
every mock view (mock chrome, ignore). Real findings: pane/focus dataset `label-content-name-mismatch`
(16 / 48 cell and row buttons); pane/focus reviews `nested-interactive` (7) + `color-contrast` (3);
page reviews `color-contrast` (1); trash `color-contrast` (1, disabled Restore). page/item and focus/item
are clean.

## Winners
- (a) Item editing: **A pane** (docked editor), with B's additions: unsaved-changes guard with
  "Save and continue / Discard", History "Revert to this", and the `?item=` page kept for Runs/History and deep links.
  Reason: fixes both pain points (no inline edit, silent discards) without navigation; the table stays for multi-select and bulk delete/label.
  C is fastest for one field but loses cross-field context, doubles tab stops, and has no guard.
- (b) Reviews triage: **A pane** (56 px rows + sticky detail pane). Decision buttons, the AI-vs-Human diff and
  a single Filters popover with chips are all visible at once; 7 rows per viewport vs about 2 cards today.
  Steal from C: show position "n / N" and keep revision history/scores in the pane after `o`.
- (c) Trash: shared `TrashView`, full width. The 1120 px container in `focus` hides the Dataset column; do not use it.

## Must-fix for implementation
1. Keyboard keys must survive: `j k a r e o x / ? Shift+A`, Up/Down, Enter, Esc, Ctrl+Enter. Verified working in all variants
   (j/k move, `?` opens shortcuts, `e` swaps to the edit form and Esc cancels, `r` opens the comment dialog, `a` approves and advances,
   `x`/`Shift+A` select and bulk approve, `/` focuses search). Keep them skipping inputs; add tests.
2. Reject comment dialog: pressing Esc did not close it in 300 ms in any variant. Verify it closes (and returns focus to the row).
3. Bulk 409: keep the alertdialog "The list changed" with a single "Reload and select again" action; it must refetch counts and
   clear the selection, and say who changed it. Bulk bar appearing shifts the list down about 40 px: reserve its height.
4. Private locked state: keep the shield empty state. Hide "Create draft" and Add item/Import for non-admins, because they imply content access.
5. Pane footer is clipped at 1280x800 (Save changes at y>=790). Make the pane scroll inside with a sticky footer; Save and Delete must stay visible.
6. Pane: Esc while the editor is dirty must trigger the discard guard (it currently does nothing). Row-click or j/k while dirty must hit the same guard.
7. Type change: keep the `string -> number` tag plus "will be saved as number"; add `aria-live="polite"` on the status text and confirm it on Save.
8. a11y: no buttons inside clickable rows (`nested-interactive`): make the row a listbox option or use one link/button with a sibling actions cell;
   raise contrast on the dim decision icons and the disabled Restore; give cell buttons accessible names that start with their visible text.
9. Use the shared `Tabs` (sans, underline) for review status; the `page` variant's boxed mono tabs differ from the settings page.
10. Trash: URL state (`?q=&project=&page=`), sticky Restore column, warning/danger purge states with the icon (already good), pass the Dataset column at all widths.
11. Primitive gaps to add in `src/ui`: docked non-modal Drawer, DataTable pinned column and current-row hook.
