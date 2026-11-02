# Datasets / reviews / trash — design variants

Three variant families, each one combined mock route with an in-mock view switcher:

| Route | (a) Dataset item editing | (b) Reviews triage | (c) Trash |
|---|---|---|---|
| `/app/__mock/datasets/pane` | **A. Table + docked pane** | **A. Compact rows + detail pane** | shared `TrashView` (full width) |
| `/app/__mock/datasets/page` | **B. Page per item, improved** (mini-list, guard, revert) | **B. Cards, tightened** (diff block, two-row toolbar) | shared `TrashView` (full width) |
| `/app/__mock/datasets/focus` | **C. Inline cells** (popover editor per cell) | **C. Focus mode / queue** (rail + one correction, filters in a drawer) | shared `TrashView` (constrained 1120 px) |

Views: `?view=dataset` (draft v3 of "Support QA"), `?view=item` (the edit state with the
`string → number` type change on `q-004`), `?view=reviews`, `?view=trash`;
`?view=dataset&ds=private` shows the private test set locked state (non-admin). Every
screen uses static fixtures (`fixtures.ts`, brief §4 shapes, Arabic items/findings rendered
RTL with `textDirAttrs`). Mock chrome is a flat topbar (`shared/MockFrame.tsx`) because
`AppShell` needs the auth context; the content region is what is being judged.

Shared across all three: `DatasetHero` (identicon, rename, private tag, meta pills,
version switcher popover, state-driven actions, overflow menu, tabs), `itemColumns`
(`#`, ID, Input, Expected, Metadata, Runs, one `ScoreValue` column per metric, Latency,
Edits, ⋮), `FieldEditor` (the type-explicit Text/JSON editor: textarea, type tag,
`string → number` warning tag, live status "unchanged / edited / will be saved as number /
Not valid JSON"), `useItemsState` (search, label chip, multi-select, bulk Delete N /
Add label dialogs), the reviews state machine (`useReviewState`, `useTriageKeys`:
`j k a r e o x / ? Shift+A`, ↑/↓, Enter, Esc) and its pieces (status tabs with counts,
priority tag, context chips, AI-vs-Human issue renderers, decision buttons with a
`review_block` reason marker, bulk bar with partial-fit count badges, comment dialog with
Ctrl+Enter, the 409 conflict alertdialog "The list changed — reload and select again"
(the first bulk action in every variant simulates the 409), shortcuts dialog, inline edit
form with Esc/Cancel/Save), and `TrashView`.

## (a) Dataset item editing

### A. `pane` — table + docked side pane
- The items table stays the overview (selection checkboxes, metric columns, ⋮). Clicking
  the `#` cell, pressing Enter on a row, or `j`/`k` sets the current item and docks a
  460 px editor pane on the right (sticky, non-modal, the table stays interactive; three
  less important columns hide while it is open). Pane: id + copy, index/updated/edits,
  ↑/↓ prev-next, close; Input / Expected / Metadata `FieldEditor`s; footer with "Open item
  page" (the `?item=` page stays for Runs/History and deep links), Delete, Save changes
  (disabled until dirty + valid, Ctrl+Enter). Navigating away while dirty opens a
  "Discard unsaved changes?" ConfirmDialog.
- Pain points answered: inline-ish editing without leaving the list; multi-select + bulk
  delete/label; one dialog for N deletes; unsaved-changes guard; save patches the row
  (no full reload); no hover-only popovers (the pane shows the full value).
- Trade-offs: the table loses ~460 px while editing (columns hide); two places to edit
  (pane + item page) must share the editor component; `j`/`k` compete with table focus
  (implemented as page-level keys that skip inputs).
- Primitive gap: `Drawer` is modal (backdrop, focus trap) — a docked non-modal mode is
  needed; this mock builds the pane with plain CSS around primitives.

### B. `page` — page per item, improved
- The table is unchanged except `#` is a link, Enter opens the item page, and multi-select
  gives Delete N / Add label. The item page gains a persistent 240 px mini-list that
  follows the table's search/sort (current item marked, ↑/↓ via `j`/`k` or
  Previous/Next), "N of M in the current list", an "Unsaved changes" badge, a guard
  dialog with "Save and continue" / "Discard", Ctrl+Enter save, and History revisions
  with "Revert to this" (ConfirmDialog, full-body PATCH).
- Pain points answered: one editor instead of two; guard; revert; bulk delete; Prev/Next
  no longer blind (the list is visible).
- Trade-offs: still a navigation per item (table ↔ page); the mini-list duplicates the
  table filter; largest editors but the lowest "items visible while editing".

### C. `focus` — inline cells
- Input / Expected / Metadata cells are buttons; click or Enter opens an anchored popover
  with a compact `FieldEditor` (Text/JSON toggle, type tag, status), "one PATCH for this
  field only", Esc cancels, Ctrl+Enter / Save commits. Multi-select + bulk bar as above;
  the item page is unchanged (reached from `#` or ⋮ → "Open item page").
- Pain points answered: the fastest single-field fix (no navigation at all), bulk
  delete/label, no hover popovers (a click shows the full value in the editor).
- Trade-offs: no cross-field view while editing (metadata vs expected), small editor for
  long RAG contexts, three focus targets per row (a11y cost: 3 × 50 tab stops), the
  popover closes on outside click (guard must be "Discard?" inside the popover — not
  mocked). Keyboard users still need the item page for multi-field edits.

## (b) Reviews triage

### A. `pane` — compact rows + detail pane
- 56 px rows: checkbox, `#id`, item id, priority tag, dataset · model · task line, the
  first human issue as `Category · subcategory — finding (+n)`, confidence tag, compact
  decision buttons (✓ ✗ ✎; disabled with an "ⓘ" reason marker when `review_block`). The
  current row (`j`/`k`, click, Enter/Space) fills a sticky right pane: header
  (status, priority, by/when, decisions, expand), context chips, AI-vs-Human columns
  (changed human issues accent-bordered, dropped AI issues red-bordered, empty AI column
  stated), previews or, after `o`, the lazy detail (full snapshots, revision history,
  metric scores, item metadata). `e` swaps the columns for the edit form.
- Toolbar: select-all, search (`/`), sort, one "Filters" button (count badge) opening a
  popover with the four facet multiselects, source segmented and confidence min/max,
  active-filter chips with × and "Clear filters", bulk bar, live count; status tabs are
  underline tabs with counts under the page header.
- Density: 7 rows + the full current card per 800 px (vs ~2 cards today).
- Trade-offs: two reading positions (row list vs pane); a 44 % pane at 1280 px leaves
  ~700 px for rows (meta line truncates); `o` only changes the pane.

### B. `page` — cards, tightened
- Keeps the card list. Each card: one header line (checkbox, id, item, status, priority,
  "AI 41 %", by/when, ✓ ✗ ✎ 🗑 ▾), one chip line, a single **diff-style** issue block
  ("Both" / struck-through "AI" / accent "Human" rows) instead of two columns; previews
  and the lazy detail only after `o`/▾. The current card has an accent ring and
  `aria-current`. Toolbar split: primary row (select-all, search, sort, bulk bar, count,
  ?), secondary row (facets, source segmented, confidence min/max sliders, Clear).
- Density: ~4 collapsed cards per 800 px (≈110 px each).
- Trade-offs: 15 controls are still visible (two rows); the diff block hides AI
  confidence per issue (moved to the header tag) and "Why this category" (only in detail).

### C. `focus` — focus mode / queue
- Left 330 px rail: underline status tabs, search, select-all + sort, active filter chips,
  the queue (id, item, first finding, priority; `x` checkbox), bulk bar in the footer.
  Right: one large correction — header with position "n / N", ↑/↓, chips, AI-vs-Human
  columns, previews + revision history + scores + metadata always visible (no `o`
  needed), and a big action row "Approve a · Reject r · Edit diagnosis e · Select x"
  with the `review_block` reason inline. Filters live in the `Drawer` (button in the
  page header with a count badge).
- Density: 1 correction per screen by design; 8 queue rows visible.
- Trade-offs: no scanning across corrections; mouse users do more clicks; the drawer hides
  filter state (chips in the rail compensate).

## (c) Trash
One shared `TrashView`: PageHeader (retention / total / admin note), search + project
facet (`Name (archived) · count`) + live selection label + "Restore N selected"; DataTable
with selection (archived rows cannot be restored and are excluded from the count),
Run (name + mono id), Project (+ "Project archived" tag), Purges (warning tone and ⚠ under
3 days, danger under 1 day / due now, "Paused — purge paused while the project is
archived"), Deleted (date + by), Status badge, Model (+ reasoning), Task, Dataset, and a
**sticky Restore column** (CSS on the last column — primitive gap: `DataTable` has no
pinned-column option). Purge-soon rows get a warning left edge. URL state (`?q=&project=
&page=`) is the implementation's job (noted, not mocked). The `focus` route shows it in the
1120 px constrained container, the others full width, so the UX agent can judge which fits.

## Primitive gaps hit (described, not added)
- `Drawer` non-modal / docked mode (variant A editor pane).
- `DataTable`: pinned (sticky) column; `aria-current`/"current row" styling hook; a way to
  make a cell a pressable without nesting a button in the row link.
- A two-thumb `RangeSlider` (confidence band) — two `Slider`s are used.
- `VersionSwitcher` (combobox-over-listbox with search) — a mock-local popover is used.
- `Tooltip` cannot attach to a disabled button; `HelpMarker`/inline reason used for
  `review_block`.
- `Tabs` in a narrow rail: four tabs with counts need ≥ 300 px.
- Mock-local custom controls use a plain `24px` height (the design test forbids
  `--control-height` outside `src/ui`): version pill, `#` open button, cell buttons.
