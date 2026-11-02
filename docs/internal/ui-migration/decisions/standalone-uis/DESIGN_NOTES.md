# SDK viewer: design notes

Mocks: `/app/__mock/sdk-viewer/{stats-table,split,timeline}`; add `?state=error|empty|loading|file` (default = live run, 48 rows incl. running, pending, failed, Arabic, one very long output, metrics with "n/a" / "computing...").
All three share `shared/` (state hook, parts, CSS), so the variants differ only in layout. Only RAC-free code is imported: `@/ui/Badge` and `@/lib/text`; everything else is native `<table>`, `<input>`, `<select>`, `<button>`, `<aside>` with CSS modules and tokens.

Reusable in any winner (`shared/`): `useViewer` (filter/sort/selection/focus-return, to be replaced by the real snapshot + SSE store), `RowTable` (sortable `aria-sort` headers, roving arrows, Enter opens, 2-line clamp, `dir` per cell), `Detail` (RTL blocks, error callout, metric list, file-mode score edit inputs), `Toolbar` (search, status select, Export CSV, row count live region), `ErrorBanner`, `Waiting` (empty and loading), `ProgressBar`, `Percentiles`, `ViewerHeader` (wordmark + dataset/run/model chips + Live/Disconnected/Completed badge), `exportCsv`.

## stats-table
- Layout: header; optional banner; summary row (6-cell stat strip, stacked completion bar, P50/P90/P99/min/max); toolbar; full-width table with Input/Output/Expected/metrics/Latency; row detail as a right overlay (560px, scrim, Escape or scrim closes, focus returns to the row).
- Rationale: matches the legacy mental model and the "is it done, how did it go" journey at a glance; the widest table shows output and expected side by side, best for scanning many rows (compare answers).
- Density: highest table density (about 14 rows at 900px after the 120px summary), costs the context of the row while reading detail (overlay hides the right columns).
- Bundle: smallest layout code (~1 KB beyond shared). Shared total estimate: ~9 KB JS + ~6 KB CSS gzip-free raw ~25 KB.
- Reusable: summary strip markup, overlay panel.

## split
- Layout: one compact stats line (counts as inline text, thin bar, percentiles), table left (1.25fr), detail pane always visible right.
- Rationale: reading and comparing rows one after another (arrow, Enter) never loses table context; no open/close step. Weak on narrow screens (table loses Expected/Output width) and the pane is empty until a row is chosen.
- Density: highest information per screen at 1440px; stats are least prominent.
- Bundle: same as stats-table.
- Reusable: the two-column grid, empty-pane hint.

## timeline
- Layout: ribbon with one coloured cell per row (done, failed, running pulsing, pending hollow; filtered-out rows dimmed; selected outlined), a large "n / total finished" count and legend + percentiles; toolbar; compact list (index, status, input, metrics) left and detail pane right.
- Rationale: failures and the progress front are visible without scrolling or filtering; the ribbon is navigation (a `role=toolbar` with arrow keys). Scales to a few hundred rows, degrades past about 1000 (cells wrap to many lines).
- Density: list is compact (output/expected only in the detail), so scanning answers is slower than in the other two.
- Bundle: ~1.5 KB more than the others (ribbon + keys).
- Reusable: ribbon (could be added to any variant as the progress indicator).
