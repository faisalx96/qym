# Shared UI primitives and the design system — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
**foundation agent** that builds `frontend/src/ui/` (the primitive library) and
`frontend/src/styles/` (tokens), and every area agent that consumes them. Be
concrete; no marketing language.

Scope of this brief: everything under
`packages/platform/qym_platform/_static/dashboard/` that more than one page uses:

| File | LOC | Role |
|---|---|---|
| `ui_components.js` | 1514 | `window.QymUIComponents` — behavior layer (dialogs, pagination, tooltips, tabs, segmented, dropdowns, scroll mirror, scroll hold, error state, `fetchJson`) |
| `ui_components.css` | 4046 | canonical `qym-*` recipes **plus ~150 legacy alias selectors** (`:is(.qym-control, .filter-select, .multi-select-btn, …)`) |
| `qym_table.js` | 237 | `window.QymDataTable` — sortable, resizable, width-persisting `<table>` |
| `json_viewer.js` / `.css` | 319 / 173 | `window.QymJsonViewer` — preview button, lazy tree, modal |
| `dashboard.css` | 11998 | `:root` tokens (lines 8–137), base/reset (160–211), `.qdt-table` (212–318), then page CSS for runs/charts/models/playground/trace viewer |
| `shell.css` / `shell.js` | 1028 / 2950 | shell chrome tokens, `.shell-modal`, `.shell-btn`, `.shell-toast`, `.shell-drawer`, skeleton/arrival animation, `QymShell.toast/openConfirmDialog/openFormDialog/openDrawer/skeletonHTML` (owned by brief 01, listed here because the primitives depend on them) |
| `qym_safe.js` | 265 | `QymSafe.escapeHtml/textDirAttrs/applyTextDir/textBlock/renderMarkdown` (owned by brief 01) |
| `docs/DESIGN_LANGUAGE.md` | 449 | rules; enforced by `tests/platform/test_design_language.py` (493 lines) |

Important context found during analysis: `packages/platform/qym_platform/_static/app/`
is a **built React bundle with no source in the repo** (`git ls-files | grep -c '\.tsx$'`
= 0). Its chunk names (`Button`, `Dialog`, `DataTable`, `Toast`, `Tooltip`, `Popover`,
`StatStrip`, `Skeleton`, `DeferredSegmentedControl`, `RunStatusBadge`, …) show an
earlier attempt at exactly this library. The playbook says delete it and never
reference it; this brief agrees — nothing in it is recoverable.

---

## 1. Primitive inventory

"Callers" were found with `grep -rl` over `_static/dashboard/*.{js,html}` excluding
`ui_components.js` itself. File counts are exact; the named files are the main ones.

### 1a. Behavior primitives (`window.QymUIComponents`, `ui_components.js`)

| Primitive | file:line | Props / options | Who uses it (file count) | A11y status today |
|---|---|---|---|---|
| `openDialog(panel, opts)` / `releaseDialog(panel, opts)` / `handle.close()` | `ui_components.js:1059-1120` (focusables list `:980`, stack `:981`, `topDialog` `:1002`, keydown `:1017`, focus-recapture `:1052`) | `opts: { role?='dialog', initialFocus?: string\|Element\|(dialog)=>Element, labelledBy?, label?, onEscape?(e), preventScroll?=true, returnFocus?: Element }`; release `opts: { restoreFocus?=true, returnFocus?, fallbackFocus? }`. Returns `handle {dialog, active, close()}` | 8 files: `shell.js` (confirm/form/create-project/drawer), `dashboard.js`, `trace_viewer.js`, `json_viewer.js`, `run.html`, `compare.html`, `reviews.html`, `datasets.html`, `project_settings.html` | Good: sets `role`, `aria-modal`, `aria-labelledby` (auto-ids the first `[data-qym-dialog-title], h1, h2, h3, .shell-modal-title, .modal-title`), `tabindex=-1`, Tab loop, Escape via `onEscape`, focus return, stack-aware, releases dialogs removed from DOM via MutationObserver (`:948`). Portals exempt from recapture: `[role=menu], [role=listbox], [role=dialog], [role=alertdialog], [data-qym-dialog-portal], .root-cause-dropdown, .shell-toast-container` (`:1051`). Gap: nothing sets `inert` on the page behind; backdrop click-to-close is the caller's job |
| `renderPagination(host, opts)` | `:71-168`; legacy variants `renderLegacyPagination` `:34-69` | `opts: { total, pageSize, page (1-based), pageCount?, start?, end?, noun?='items', showSummary?=true, pageSizeOptions?: number[], onPageChange(page), onPageSizeChange(size), scrollHost?: id\|Element, variant?: 'run'\|'compact' }` (variants are 0-based `page`, prev/next only) | 5 direct: `dashboard.js`, `experiments.js`, `playground.js`, `trash.html`, `datasets.html`; `.qym-pagination` markup in 7 files | `role=navigation` + `aria-label="<noun> pagination"`, buttons have `aria-label` + `title`, page `<input type=number>` with `aria-label`, size `<select aria-label>`. Gap: no `aria-live` on the summary in the main variant (legacy variants have it) |
| `renderErrorState(host, opts)` + `classifyError(err)` + `requestError(status, detail)` + `fetchJson(url, init)` | `:1393-1492` | `opts: { error, title?='Couldn’t load this', message?, notFoundMessage?, onRetry?(), compact? }`. Kinds: `abort\|auth\|forbidden\|not_found\|server\|client\|network\|unknown`; copy table `:1393`. `fetchJson` throws `Error{status, kind, detail}` on non-2xx | `renderErrorState`: `compare.html`, `datasets.html`; `classifyError`: `datasets.html`; `fetchJson`/`requestError`: **no external callers** (pages use their own fetch) | `role=alert` on the container; action is a real `<button>`/`<a>`; `data-error-kind` attr for tests |
| Help marker / tooltip (`ensureHelpMarker`, portal `showHelpPortal`) | `:311-383`, event wiring `:791-821`, `:879-889`; CSS `ui_components.css:2212-2300` | Markup contract: `<button class="qym-help-marker" aria-label="Explain X">i<span class="qym-help-tooltip" role="tooltip">…</span></button>`; optional `.stat-info-icon/.stat-info-tooltip` aliases. Portal copies `textContent` to a fixed `div.qym-help-tooltip-portal` on `<body>` | 6 files via `.qym-help-marker` (`overview.html`, `models.html`, `run.html`, `compare.html`, `dashboard.js`, `playground.js`) + 4 via `.stat-info-icon` | Assigns `id` + `aria-describedby`, keeps `aria-expanded`; hover/focus shows, click/Enter/Space pins, Escape/outside-click/scroll/resize closes. Gap: portal is `aria-hidden=true` so SR users get the hidden inline copy via describedby only; `cursor: help` on a button |
| Tabs (`syncTablist`, roving focus) | `:385-401`, keyboard `:891-925`, click `:823-828`; CSS `ui_components.css:1073-1290` | Markup: `.qym-tabs[role=tablist][aria-label]` > `button.qym-tabs__tab[role=tab][aria-selected][aria-controls]`; `.active` class is an accepted alias for `aria-selected` | 9 files (`admin.html`, `project_settings.html`, `analyzer.html`, `datasets.html`, `experiments.js`, `eval_queue.js`, `trace_viewer.js`, `dashboard.js`, `playground.js`) | Roving `tabindex`, Left/Right/Home/End with wrap, re-finds the tablist by id/aria-label after a re-render. Activation is "focus + click" (automatic activation) |
| Segmented control (`setupSegmented`, sliding indicator) | `:403-523`, observer `:942-971`; CSS `ui_components.css:1293-1540` | Markup: `.qym-segmented[role=group][aria-label][data-qym-segmented-key]` > `button.qym-segmented__option[aria-pressed]` (or `aria-selected`/`.active`). Sets `--qym-segment-x/--qym-segment-width`, `.qym-segmented--ready`; remembers position per key in a `Map` across re-renders; `ResizeObserver` per option; honours `prefers-reduced-motion` | 15 files (`index.html`, `overview.html`, `charts.html`, `models.html`, `run.html`, `compare.html`, `reviews.html`, `datasets.html`, `analyzer.html`, `dashboard.js`, `playground.js`, `step_latency.js`, `latency_traces.js`, `experiment_launch.js`, `qym_safe.js`) | Relies on the caller for `aria-pressed`; no arrow-key navigation between options (each is a plain button, Tab moves through all) |
| Structured dropdown (`toggleStructuredDropdown`, `filterStructuredDropdown`) | `:525-562`, wiring `:748-760`, Escape `:852-858`; CSS `ui_components.css:3732-3825` | Markup: `.qym-dropdown` > `button.qym-dropdown__trigger[aria-expanded]` + `.qym-dropdown__menu` > `input.qym-dropdown__search`, `.qym-dropdown__actions`, `label.qym-dropdown__option` (checkbox inside), `[data-qym-dropdown-search-text]` for filtering | 7 files (`reviews.html`, `run.html`, `compare.html`, `analyzer.html`, `insights.js`, `dashboard.js`, `playground.js`) | `aria-expanded` on trigger; focuses search on open; Escape closes and restores focus; outside click closes. Gap: no `aria-controls`, no listbox semantics, no arrow-key option navigation |
| Legacy multi-select (`ensureDropdownButton`) | `:564-581`, Escape `:860-876`, post-click resync `:837-841`; CSS `ui_components.css:871-990` + `dashboard.css:1076-1275` | Markup: `.multi-select-wrapper` > `button.multi-select-btn` + `.multi-select-dropdown.open` > `.model-search-box input[data-ms-search]`, `.ms-actions` (`.ms-action-btn` Select all / None), `label.multi-select-option` (`input[type=checkbox]`, `.ms-only-btn` "Only") | 8 files (`index.html`, `charts.html`, `models.html`, `run.html`, `compare.html`, `reviews.html`, `analyzer.html`, `dashboard.js`) — the runs filter bar is the heaviest user | Sets `aria-haspopup=dialog\|listbox`, `aria-controls`, `aria-expanded`, `role` + `aria-label` on the panel; Escape closes even when focus fell to `<body>`. Open/close toggling itself lives in each page (`dashboard.js`) |
| `enhanceSelect(select, cfg)` / `enhanceSelects(root, selector, cfg)` (single-select mirror of a native `<select>`) | `:600-716`; CSS `ui_components.css:993-1072` | `cfg: { placeholder?, label?, search?: boolean (auto when >8 options), highlightSelection?, className?, placement?: 'top' }`. Hides the native select (`hidden`, `tabindex=-1`, `aria-hidden`), builds `.qym-review-selector` with `role=listbox` panel and `button[role=option][aria-selected]` rows, dispatches `change` on the native select | `analyzer.html`, `playground.js` | listbox/option roles, `aria-label` "Select: value", Escape restores focus. Gap: no typeahead, no arrow keys inside the list |
| Scroll mirror (`setupScrollMirror`) | `:202-309`; CSS `ui_components.css:621-742` | Markup: `.qym-scroll-mirror[data-qym-scroll-mirror-for=<scrollHostId>][tabindex=0][role=scrollbar]` > `.qym-scroll-mirror__track` > `.qym-scroll-mirror__thumb`; hides the target's native scrollbar (`.qym-scroll-mirror-target`), fixed above `--status-bar-height` | `index.html` + `dashboard.js` (runs table only) | Sets `aria-valuenow/max`; keyboard Home/End/Arrow; wheel and drag. Tied to `QymShell.pageSignal()` for cleanup |
| Scroll hold | `:1130-1386` | Global: on `pointerdown`/`keydown` records the pressed element's viewport top and, for 4 s, undoes browser scroll clamping while the page re-renders. **Monkey-patches `Element.prototype.scrollTop/scroll/scrollTo/scrollBy/scrollIntoView` and `HTMLElement.prototype.focus`.** Opt-out `data-qym-scroll-hold="off"` | Implicit for every page; `run.html` opts a scroller out | n/a (invisible) — see §7 |
| `alignMetricColumns(root, opts)` | `:170-200` | Measures `[data-qym-metric-column]` cells inside `[data-qym-metric-grid]` groups and writes `--qym-item-metric-columns` so sibling grids share a column template | Attribute appears in `run.html`, `compare.html`; no direct `QymUIComponents.alignMetricColumns(` call found (likely called through a local alias in those pages' inline scripts) | n/a |
| `refresh(root)` + document-wide `MutationObserver` | `:718-746`, `:939-972` | Re-applies all the above to new DOM; observes `childList` + `attributes: aria-selected, aria-pressed, class` on the whole body | `playground.js` calls it; everyone else relies on the observer | — |

### 1b. Data table (`window.QymDataTable`, `qym_table.js`)

| Primitive | file:line | Props / options | Who uses it | A11y status |
|---|---|---|---|---|
| `QymDataTable.render(opts)` → `{table, columns, widths}` | `qym_table.js:69-234`; CSS `dashboard.css:212-318` (`.qdt-table`) | `opts: { host, columns: [{ id, label, key?/sortKey?, width?, minWidth?/min? (default 44), flex?, className?/cls?, resizable?=true }], rows, storageKey? (localStorage `qym:data-table:widths:<key>`), minWidth?, tableClass?, renderRow?(row, {columns,rowIndex}) → <tr>, onSort?(column, 'asc'\|'desc', sortKey), sortState?(sortKey, column) → 'ascending'\|'descending'\|'none', scrollLeft? }`. Fixed `table-layout` + `<colgroup>` widths; flex columns absorb leftover host width (`:88-119`); drag-resize on `.qdt-col-resize` (mouse only, `:140-174`) | `eval_queue.js`, `experiments.js`, `trash.html`, `datasets.html`; `.qdt-table` class also hand-written in `experiment_matrix.js`, `compare.html`, `eval_queue.html`, `experiments.html` | Sortable `<th role=button tabindex=0>` with Enter/Space; inner `<button aria-sort>` is `pointer-events:none` and `tabindex=-1` (so `aria-sort` sits on a button, not the `th` — wrong element). Resize handle is `mousedown` only (no touch/keyboard). Sticky header. No `aria-rowcount`, no caption |

### 1c. JSON viewer (`window.QymJsonViewer`)

| Primitive | file:line | Props / options | Who uses it | A11y status |
|---|---|---|---|---|
| `parse(value)`, `preview(data, max=80)`, `summary(data)` | `json_viewer.js:42-67` | pure helpers; `parse` returns `null` for scalars/empty/invalid JSON strings | `run.html` via `previewHtml` | — |
| `previewHtml(value, {title, className})` | `:73-86`; CSS `json_viewer.css:5-45` | returns `<button class="qjv-preview" data-qjv-json data-qjv-title aria-haspopup=dialog aria-label="View <title> as JSON (3 keys)">` — a document-level click delegate (`:301-309`) opens the modal, so it survives `innerHTML` re-renders | `run.html` | good label; focus ring; `unicode-bidi: plaintext` on preview |
| `createTree(data, {expandDepth=2})` | `:185-191` (`buildNode` `:115-183`) | lazy child build on first expand; `role=tree` / `treeitem` / `group`; chevron toggle button with `aria-label` = key | internal | `aria-expanded` on both row and toggle. Gap: no arrow-key tree navigation; punctuation spans read aloud |
| `open(value, {title, expandDepth, trigger})` → `{element, tree, close}` | `:236-299` | mounts `.shell-modal-backdrop.qjv-modal` with Expand all / Collapse all / Copy / Close, uses `openDialog` (`initialFocus` = close button, `returnFocus` = trigger); copy with clipboard fallback `:212-232` | internal | inherits dialog contract; copy button swaps `aria-label` to "Copied" for 1.5 s |

### 1d. CSS-only recipes (canonical `qym-*` classes in `ui_components.css`)

| Primitive | file:line | Variants / modifiers | Who uses it (files) | A11y notes |
|---|---|---|---|---|
| `.qym-control` (+ `.qym-input`, `.qym-select`, `.qym-search`) | `ui_components.css:14-245` | one density: 24 px, radius 5, `--font-sm`, elevated bg, `--border-default`; hover `--border-strong`/`--bg-hover`; focus accent border + `0 0 0 2px rgba(0,212,170,.15)`; selects get the chevron data-URI (`:8-12`) that flips on `:open`/`[aria-expanded=true]`; ~25 legacy aliases in the `:is()` list | 25 files | focus ring is a box-shadow not an outline (fine on dark); placeholder color `--text-muted` (`dashboard.css:835`) |
| `.qym-inline-action` (`--neutral`, `--accent`, `--danger`, `.qym-trace-action`, brand `--langfuse`) | `:247-363` | 24 px, borderless, 600 weight, padding `--space-md`; neutral = `--bg-active`, accent = `rgba(0,212,170,.14)`, danger = `color-mix(error 12%)` | 29 files — the de-facto Button | `:focus-visible` 1 px accent outline, offset 2 |
| `.qym-icon-action` (`--danger`, `.copied`, `.btn-approve`, `.btn-reject`) | `:365-475`, `:721-740`, `:3911` | 24×24, transparent, glyph-only hover to accent (no tile), ~16 legacy aliases | 17 files | needs caller-provided `aria-label`; focus outline 1 px |
| `.qym-clear-action` | `:743-818` | 24 px, red-tinted destructive filter clear | runs/charts/reviews toolbars | — |
| `.qym-search-wrap` | `:820-870` | input with leading icon, `padding-left: 26px` | runs search, trace search, datasets | — |
| `.qym-pagination` (`__summary`, `__controls`, `__button`, `__page`, `__input`, `__total`, `__size`; `--compact`, `--run`) | `:476-620`, `:3826-3910` | icon buttons 24 px; input width `max(28px, digits*1ch+8px)` via `--qym-page-digits` | 7 files | focus outline inset |
| `.qym-dropdown` (+ `.multi-select-dropdown` alias) `__search`, `__actions`, `__action`, `__option`, `__only`, `__trigger`, `__menu`, `__option-label/-text` | `:871-990`, `:3732-3825` | absolute panel, `--dropdown-radius` 7, 32 px options, "Only" revealed on hover/focus (always on `(hover: none)`) | 7 + 8 files | — |
| `.qym-review-selector` / `.qym-review-select__*` | `:993-1072` | the `enhanceSelect` output; `--dropup` | 2 files | — |
| `.qym-tabs` / `.qym-tabs__tab` (aliases `.admin-tabs`, `.settings-tabs`, `.dsx-*-tabs`, `.chart-dataset-tabs`, `.tv-tabs`) | `:1073-1290` | underline-only active (`--accent-primary`), `--tab-height` 34, `--font-base`/600; `.chart-dataset-tabs` exception (elevated strip, mono, `.tab-count` tile) | 9 files | disabled → `opacity .45` |
| `.qym-segmented` / `.qym-segmented__option` (10 aliases: `.time-filter`, `.view-toggle`, `.metric-tabs`, …) | `:1293-1540` | 24 px inset box, selected option filled accent with `--bg-void` text; `::before` sliding indicator when `--ready` | 15 files | selected via `.active`, `[aria-selected=true]` or `[aria-pressed=true]` |
| `.qym-badge` (`--success`, `--info`, `--danger`, `--warning`, `--neutral`) + status aliases (`.status-badge.status-COMPLETED`, `.completed`, `.improved`, `.regressed`, `.draft`, …) | `:1544-1708` | 20 px, pill (999), 1 px tinted border, `rgba(color,.09)` bg, sans `--font-xs`/650 | 16 files | `.hero-status-dot` 6 px dot |
| `.qym-tag` (`--role`, `--accent`, `--count`, `--data`, `--version`, `--success/--info/--warning/--danger`) + 10 legacy aliases (`.role-badge`, `.version-badge`, `.tab-count`, `.meta-badge`, …) | `:1710-1848` | 20 px, borderless, `--control-radius`, elevated/tinted fill, `--font-xs`/650; mono for role/count/data/version | 26 files | — |
| `.qym-chip` (`__count`, `__remove`; aliases `.filter-chip`, `.category-chip`, `.compare-chip`) | `:1850-1907` | 26 px, pill outline, `--font-sm`/600; active = accent tint; `[aria-pressed=true]` | 8 files | buttons must stay real buttons |
| `.qym-stat-strip` / `__item` / `__label` / `__value` (+ 9 aliases) | `:1909-2027`, responsive `:2300-2352` | connected band: 1 px gap on `--border-subtle`, radius 8, 72 px min; label `--font-md`/650 muted; value mono `--font-xl`/700 | 10 files | — |
| `.qym-score-value.score-1..5` (+ `.metric-score`, `.metric-score-value` in `dashboard.css:3794-3812`) | `:2028-2034` | color only; class from `QymMetrics.getMetricColorClass(value, type, direction)` | `run.html`, `compare.html` (+ runs table via `.metric-score`) | colour-only encoding; no text/shape fallback |
| `.qym-help-marker` / `.qym-help-tooltip` / `.qym-help-tooltip-portal` | `:2212-2300` | 12 px circle, accent; tooltip 240 px, `--bg-elevated` | 6 files | see 1a |
| `.qym-text` (`--prose`, `--code`, `__code`, `__pre`, `__heading`, `__link`) | `:2420-2451` | output of `QymSafe.textBlock` | run/compare/reviews item views | `pre-wrap`, `overflow-wrap: anywhere` |
| `.qym-output-*`, `.qym-metric-compare__*`, `.qym-metric-edit-*`, `.qym-item-*` (control center, popover, builder `.fb-*`, threshold slider) | `:2353-3731` | item-by-item shells shared by run/repeat/compare | run, compare, repeat views | owned by brief 04 (run detail); listed so the foundation agent does **not** port them as primitives |
| `.qym-error-state` (`__title`, `__body`, `__detail`, `__actions`, `--compact`) | `:3966-4015` | centered, `--font-xl` title, `--font-md` muted body | `compare.html` + `renderErrorState` | `role=alert` |
| `.qym-stale-banner` / `.qym-is-stale` | `:4016-4040` | warning left border 3 px; `opacity .55` on stale rows | `dashboard.js` | banner has no role (should be `status`) |
| `[aria-modal=true][tabindex=-1]:focus { outline: none }` | `:4041-4046` | — | all dialogs | intended: container focus draws no ring |

### 1e. Recipes that live in `dashboard.css` / `shell.css` but are cross-page

| Primitive | file:line | Notes | Who uses it |
|---|---|---|---|
| `.qdt-table` | `dashboard.css:212-318` | reference table: sticky `th` `--font-sm` muted uppercase 650 on `--bg-elevated`; `td` `--font-base` secondary, ellipsis; row hover `--bg-hover`; sort arrow `--text-dim` 9 px; resize handle 13 px hit area with accent bar | 7 files |
| `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger` | `dashboard.css:4401-4430`, `:4639-4647` | padding `--space-sm/md`, radius 6, `--font-sm`/500; primary = accent bg + `--bg-void` text, hover `#00e6b8` (hardcoded); danger hover `#dc2626` (hardcoded); `.btn-danger { color: white }` | runs page modals, shortcuts |
| `.shell-btn(-primary/-secondary/-danger)` | `shell.css:743-765` | identical recipe to `.btn` (duplicate) | shell dialogs, datasets, eval pages |
| `.modal`, `.modal-content`, `.modal-header/-body/-footer`, `.modal-close`, `.modal-small/-medium/-large` | `dashboard.css:4311-4400`, `:5249-5270` | page-level modal (runs page: delete-run, create-task, run selection); `z-index` 1000/1200; close glyph 20 px (hardcoded, in the frozen allowlist) | `index.html`/`dashboard.js`, `models.html` |
| `.shell-modal-backdrop`, `.shell-modal`, `-header/-title/-close/-body/-description/-note/-detail-*`, `-footer`, `.shell-form-group/-label/-input/-checkbox/-error` | `shell.css:582-741` | body-mounted modal, 440 px, radius 10, fade+slide animations; title `--font-md`/600 | `shell.js` builders, `json_viewer.js`, `eval_*.js`, `datasets.html`, `project_settings.html` |
| `.shell-drawer-backdrop`, `.shell-drawer`, `-header/-title/-subtitle/-actions/-header-action/-close/-body/-footer` | `shell.css:823-900` | right-side panel, width from `openDrawer({width=480})` | `QymShell.openDrawer` callers |
| `.shell-toast-container`, `.shell-toast(.success/.error/.info, --action)`, `.shell-toast-action` | `shell.css:767-820`; `QymShell.toast(message, type, {action:{label,onClick}})` `shell.js:2300` | top-right, `role=alert` for errors else `status` | 15 files |
| `.toast-container`, `.toast(.toast-success/.toast-error)`, `-icon/-content/-title/-message/-close` | `dashboard.css:4653-4757` | **second, older toast system** (top-center) used by the runs page | `dashboard.js` |
| `.loading`, `.loading--skeleton`, `.loading-spinner` | `dashboard.css:1509-1537` | spinner 24 px, 2 px border, `spin .8s` | many pages |
| Skeleton / arrival: `.qym-skeleton`, `__bone`, `__row`, `__card`, `--inline`, `.qym-arriving(--fade)`, `data-qym-skeleton="value\|lines\|chart\|cards"`, `data-qym-arrive` | `shell.css:905-1028`; `QymShell.skeletonHTML(kind, {width,rows,height,count})` `shell.js:2609`, `arrive/arriveWith/liftSkeleton` | shimmer keyframes, skeleton shows after `--qym-skeleton-wait` 0.3 s | `dashboard.js`, `datasets.html`, every page via `data-qym-skeleton` |
| `.empty`, `.empty-state`, `.empty-icon`, `.empty-state h2/p`, `.empty-state-link` | `dashboard.css:1540-1600` | icon 48 px `--text-dim`; title `--font-xl`/650; body `--font-md` muted; CTA filled accent | 12 files |
| `.status-badge.status-*` (legacy) | `dashboard.css:4759-4781` | overridden by the `.qym-badge` alias block; still carries hardcoded `#94a3b8`, `#a855f7`, `#f59e0b` | 5 files |
| `.tag`, `.tag.model`, `.tag.task` | `dashboard.css:3615-3700` | runs-table model/task tags; `.tag.qym-tag` alias | runs table, charts |
| `.kbd` | `dashboard.css:840-852` | 18 px keycap, mono | shortcuts dialog, search hint |
| `.stat-label` / `.stat-value` | `dashboard.css:732-745` | topbar stat cells (`--font-lg` mono accent) | topbar |
| `.form-group/-row/-select/-input/-textarea/-hint` | `dashboard.css:4569-4637` | `.form-input/-select` are re-densified to 24 px by the `:is()` alias in `ui_components.css:14`; textarea stays roomy; `.form-hint` is 10 px (violates the floor, grandfathered) | runs page modals |
| Base/reset | `dashboard.css:160-211` | `* { box-sizing: border-box; margin:0; padding:0 }`, body `--font-sans`/`--font-base`/`--bg-void`/1.4, custom scrollbars (10 px, gradient thumb, accent-gradient on hover), `@font-face 'Qym Arabic'` (`:143-147`), `[dir=rtl] { line-height: 1.7 }` (`:154-157`) | everything |

---

## 2. Interaction contracts

What each primitive guarantees today. The React library must reproduce the rows
marked **keep**; rows marked *fix* are known gaps the port should close.

### Dialog (`openDialog`)
- **keep** `role="dialog"` (or `alertdialog` for destructive confirms), `aria-modal="true"`, `aria-labelledby` pointing at the title, container `tabindex=-1`.
- **keep** Initial focus order: `opts.initialFocus` → `[data-autofocus], [autofocus]` → first focusable → the container; retried on the next frame because callers reveal after opening (`:1097-1101`).
- **keep** Tab/Shift+Tab wrap inside; focus that lands outside (not in a portal) is pulled back (`:1052`).
- **keep** Escape calls `onEscape` only if the caller passed one (confirm dialogs always do; the trace viewer and drawers do).
- **keep** Focus returns to the element that was active before open (or `returnFocus`) if it is still connected and visible; else `fallbackFocus`.
- **keep** Stack: nested dialogs (JSON viewer over a drawer, create-task over run-select) — only the top dialog traps.
- **keep** Removing an open dialog from the DOM releases it (focus still restored).
- **keep** Destructive confirms start focused on Cancel; `requireText` confirms disable the primary until the text matches (`shell.js:964-1116`).
- *fix* The page behind is not `inert`; closed drawers that stay mounted must be `inert` + `aria-hidden` (DESIGN_LANGUAGE §3 "Modal" says so; `openDialog` does not do it).
- *fix* Backdrop click handling is per caller.

### Tooltip / help marker
- **keep** Trigger is a `<button>` with `aria-label="Explain <label>"`, `aria-expanded`, `aria-describedby=<tooltip id>`; tooltip has `role="tooltip"`.
- **keep** Open on hover and on focus; **pin** on click / Enter / Space (stays open after mouseout); close on Escape, outside click, scroll (capture), resize; only one pinned at a time.
- **keep** Positioned above the marker, centered, flipped below when there is no room (`:356-359`); clamped to the viewport with 8 px margin; width 240 px (`--help-tooltip-width`).
- **keep** Content is plain text (`textContent` copy).

### Tabs
- **keep** `role=tablist` + `aria-label`; tabs `role=tab`, `aria-selected`, `aria-controls` → panel id; panels `role=tabpanel` (callers do this in HTML).
- **keep** Roving tabindex (selected = 0, others = -1); ArrowLeft/Right wrap; Home/End; arrow key **activates** (automatic activation) and keeps focus on the newly active tab even if the tablist re-rendered.
- **keep** Disabled tabs skipped.
- **keep** Horizontal overflow strips scroll with a thumb shown only on hover (`ui_components.css:1265-1290`).

### Segmented control
- **keep** Container `role=group` + `aria-label`; each option a `<button aria-pressed>` (some pages use `aria-selected`).
- **keep** One sliding indicator; position remembered per `data-qym-segmented-key` (or `id`) so a keyed re-render animates from the previous option instead of jumping; re-measured on resize and content change; no motion under `prefers-reduced-motion`.
- *fix* Arrow-key movement between options (radio-group semantics) — today every option is a Tab stop.

### Dropdown / multi-select
- **keep** Trigger `<button aria-haspopup="dialog" aria-expanded aria-controls>`; panel `role=dialog` with `aria-label="<trigger text> options"` (single-select: `role=listbox` + `role=option`/`aria-selected`).
- **keep** Fixed panel anatomy: search (autofocused on open) → sticky actions row (Select all / None) → 32 px option rows, each a `<label>` with a native checkbox, optional "Only" button revealed on hover/focus, always visible on touch.
- **keep** Live filtering on `input` against `data-qym-dropdown-search-text` or text content; hidden options get `hidden`.
- **keep** Escape closes and returns focus to the trigger even when focus has fallen to `<body>` after a re-render; outside click closes; opening one closes the others.
- *fix* Arrow-key navigation and typeahead inside the list; `aria-activedescendant` or roving focus.

### Pagination
- **keep** `nav[aria-label="<noun> pagination"]`; First/Prev/Next/Last icon buttons with `aria-label` + `title`, disabled at the edges; direct page entry (`input[type=number] min max`, selects all on focus, commits on Enter/change, snaps back if unchanged); "of N" total; optional per-page `<select aria-label="<noun> per page">`.
- **keep** Every page change scrolls `scrollHost` to top first (`resetPaginationScroll`); DESIGN_LANGUAGE §3 "Pagination" adds: in item detail views scroll to the start of the Items section after layout settles.
- **keep** Summary "start–end of total noun" in mono tabular-nums, 160 px min width so it does not jitter.

### Data table
- **keep** Sortable headers reachable by keyboard (Enter/Space), `aria-sort` reflecting state, arrow glyph `↑/↓`, accent colour on the sorted column.
- **keep** Column resize by drag with a 13 px hit area, min width per column (default 44), persisted to `localStorage['qym:data-table:widths:<storageKey>']` as `{columnId: px}`; flex columns absorb leftover width unless the user resized them; sort click suppressed for 350 ms after a resize.
- **keep** Sticky header, row hover, ellipsis cells, `title` on labels.
- *fix* `aria-sort` must be on the `<th>`; resize needs keyboard (Arrow keys on a focusable handle) and pointer events (touch).

### JSON viewer
- **keep** Preview button labelled "View <title> as JSON (<n> keys)", `aria-haspopup=dialog`; opens a dialog (inherits the dialog contract, focus returns to the preview button).
- **keep** Tree: `role=tree/treeitem/group`, `aria-expanded`, lazy children, default depth 2, Expand all / Collapse all (root never collapses), copy pretty JSON with clipboard fallback and a 1.5 s "Copied" state.
- *fix* Arrow-key tree navigation (Up/Down/Left/Right per WAI-ARIA tree pattern).

### Error state / toasts / stale
- **keep** `role=alert` region; copy by kind (`:1393`); Sign in link for 401 (`QymAuth.loginUrl()`), Retry for server/network/unknown/client, no action for 403/404; never shows a create action.
- **keep** Toast: errors `role=alert`, others `role=status`; optional single action button; auto-dismiss (shell: timing in `shell.js:2300+`).
- **keep** Stale refresh: rows dimmed `.qym-is-stale` under a banner that says how old the data is and whether the latest filter change applied.

### Icon action / inline action / chip
- **keep** All are real `<button type=button>` (or `<a>` with href); icon-only ones carry `aria-label` and `title`; copy actions share one SVG (`json_viewer.js:25`) and flip to "Copied" for 1.5 s.
- **keep** Hover changes only the glyph colour (no tile); keyboard focus shows a 1 px accent outline at 2 px offset.

### Scroll hold (global)
- Not a contract to keep as-is; see §3 and §9.

---

## 3. Functional inventory

| Feature | Verdict | Justification |
|---|---|---|
| Design tokens in `:root` (colours, type scale, spacing, control geometry) | MUST-KEEP | playbook decision: "keep tokens, free the layout"; the CI test pins 13 of them by value |
| `color-scheme: dark` + dark-only theming, no raw white surfaces | MUST-KEEP | CI-enforced (`test_root_declares_the_dark_color_scheme`, `test_no_stylesheet_paints_a_surface_raw_white`) |
| `'Qym Arabic'` `@font-face` (unicode-range local faces) + `[dir=rtl] { line-height: 1.7 }` + `textDirAttrs` behaviour | MUST-KEEP | Arabic output is a first-class use case; DESIGN_LANGUAGE §1 "Text direction" |
| System-only font stacks with Menlo in mono | MUST-KEEP | CI bans webfonts; Chrome/macOS fallback documented |
| Dialog focus contract (trap, return, stack, Escape, title labelling) | MUST-KEEP | a11y baseline; every modal/drawer/trace viewer goes through it |
| Toast (one system, `role=status/alert`, optional action) | MUST-KEEP | 15 pages; consolidate the two toast systems into one |
| Error state with kind classification + Retry / Sign in | MUST-KEEP | C038 rule "a failed load is never an empty state" |
| Stale banner + dimmed rows after failed refresh | MUST-KEEP | runs list polling semantics (brief 03) |
| Pagination (icon buttons + direct page input + per-page select) | MUST-KEEP | approved option A; 7 pages |
| Data table: sort, resize, persisted widths, flex columns, sticky header | MUST-KEEP | 7 pages; `docs/internal/QYM_DATA_TABLE.md` documents it |
| Tabs with roving focus, automatic activation | MUST-KEEP | 9 pages |
| Segmented control with Qym-green selection | MUST-KEEP | 15 pages |
| Segmented sliding indicator that survives keyed re-renders | NICE | pure polish; React keeps the element so "position memory" becomes trivial (`layoutId`-style or a ResizeObserver hook); keep reduced-motion |
| Multi-select dropdown anatomy (search → Select all/None → options with "Only") | MUST-KEEP | DESIGN_LANGUAGE §3 fixes the order explicitly; runs filter bar depends on it |
| Single-select mirror (`enhanceSelect`) | DROP-CANDIDATE | exists only to restyle native `<select>` for 2 pages; in React use one `Select` primitive everywhere |
| Help marker: hover/focus open, click to pin, Escape/outside close, viewport flip | MUST-KEEP | §3 "Explanations"; 10 files |
| Badge / tag / chip silhouettes (pill-outline vs flat-square vs rounded-outline) | MUST-KEEP | CI test `test_badges_tags_and_icon_actions_keep_distinct_silhouettes` |
| Stat strip (connected band) | MUST-KEEP | 10 pages |
| Score colour classes `score-1..5` via `QymMetrics.getMetricColorClass` | MUST-KEEP | data encoding used everywhere; add a non-colour cue (see §7) |
| Icon action "glyph only changes on hover" | MUST-KEEP | CI-pinned |
| `.qym-control` single 24 px density; 42 px auth fields and composite pickers exempt | MUST-KEEP | CI-pinned (`--control-height: 24px`, `.field-input min-height: 42px`) |
| Skeleton kinds (`value`, `lines`, `chart`, `cards`) + arrival fade timing | NICE | keep the visual (shimmer bones, 0.3 s wait); the `arrive/liftSkeleton` choreography is a page-shell concern (brief 01) |
| Scroll mirror (fixed horizontal scrollbar for the runs table) | NICE | only the runs table; in React prefer a table container whose native horizontal scrollbar is always visible (height-constrained scroll host) — decide in brief 03 |
| Scroll hold (prototype monkey-patching) | DROP-CANDIDATE | fixes a symptom of imperative `innerHTML` re-renders clamping scroll; React keyed reconciliation + `overflow-anchor` + stable layout removes the cause. Log in OPEN_QUESTIONS; re-add as an opt-in hook only if Playwright shows jumps |
| `alignMetricColumns` (measure-and-share column template) | NICE | becomes a CSS `grid-template-columns: subgrid` or a `useSharedColumnWidths` hook in brief 04 |
| JSON viewer: preview → modal tree, expand/collapse all, copy | MUST-KEEP | run page outputs; also reusable for config/versioning details |
| `fetchJson`/`requestError`/`classifyError` | MUST-KEEP (as a TS module) | nobody calls `fetchJson` today, but the classification table is the single source of error copy; TanStack Query `queryFn`s should throw the same shaped error |
| Legacy aliases (`.filter-select`, `.multi-select-btn`, `.status-badge`, `.tv-*`, `.dsx-*`, `.pg-*`, 150+ selectors) | DROP | migration shims; the new app uses one class/component per primitive |
| Two button recipes (`.btn` and `.shell-btn`, 8 px/14 px padding, radius 6) vs 24 px `.qym-inline-action` | consolidate | one `Button` with `size: 'sm' (24px) \| 'md' (32px)`; `--font-sm` both; keep variant colours |
| Two modal recipes (`.modal*` page-level, `.shell-modal*` body-level) | consolidate | one `Dialog` (440 px default, `size: 'sm'\|'md'\|'lg'\|'data'(760)`) |
| Two toasts | consolidate | one `Toaster` top-right |
| `.kbd` | NICE | keyboard-help dialog; trivial |
| Hardcoded `#00e6b8` (primary hover), `#dc2626` (danger hover), `#94a3b8`, `white`/`#fff` text on danger buttons | DROP | replace with `color-mix(in srgb, var(--accent-primary) 90%, white)` or new tokens `--accent-primary-hover`, `--error-hover` (see §4 additions) |

---

## 4. Design tokens (verbatim from `dashboard.css` `:root`, lines 8–137)

Roles are taken from the inline comments and `docs/DESIGN_LANGUAGE.md`. Values must
be carried over unchanged; the test asserts the first 13 text/type tokens by exact
string.

| Token | Value | Role |
|---|---|---|
| `color-scheme` | `dark` | property, not a custom property: tells the browser all native UI is dark (CI: `test_root_declares_the_dark_color_scheme`) |
| `--bg-void` | `#101018` | page ground (body background) |
| `--bg-base` | `#14141e` | content area |
| `--bg-surface` | `#1a1a28` | cards, panels, dialogs, dropdown panels |
| `--bg-elevated` | `#222232` | table headers, inputs, nested surfaces, tags |
| `--bg-hover` | `#2a2a3c` | hover state of rows/options/buttons |
| `--bg-active` | `#323244` | active/pressed, neutral inline action, readonly inputs |
| `--text-primary` | `#ededf0` | titles, key values, table content that matters (14.7:1 on surface) — CI-pinned |
| `--text-secondary` | `#a8a8ba` | body copy, table cells, descriptions (7.3:1) — CI-pinned |
| `--text-muted` | `#9a9ab2` | labels, meta, captions, table headers; minimum readable colour (6.3:1) — CI-pinned |
| `--text-dim` | `#6b6b80` | placeholders, disabled, decorative glyphs only; never readable text (3.3:1) — CI-pinned |
| `--accent-primary` | `#00d4aa` | Qym green: selection, focus ring, links, primary action |
| `--accent-secondary` | `#00a8ff` | blue: info/running, JSON keys, secondary focus ring |
| `--accent-tertiary` | `#a855f7` | purple: analysis/AI surfaces, task tags |
| `--accent-tertiary-soft` | `#c084fc` | soft purple: booleans in JSON, purple text on dark — CI-pinned |
| `--success` | `#10b981` | completed/approved/improved |
| `--success-dim` | `#064e3b` | success background (toast icon) |
| `--warning` | `#f59e0b` | draft/stopped/stale |
| `--warning-dim` | `#78350f` | warning background |
| `--metric-error` | `#eab308` | ⚠ for metric (scorer) failures |
| `--error` | `#ef4444` | task failure, danger action, rejected |
| `--error-dim` | `#7f1d1d` | error background |
| `--info` | `#3b82f6` | ↻ retry counts, info |
| `--score-1` | `#ef4444` | 0–39 %: red |
| `--score-2` | `#f97316` | 40–59 %: orange |
| `--score-3` | `#eab308` | 60–74 %: yellow |
| `--score-4` | `#84cc16` | 75–89 %: lime |
| `--score-5` | `#10b981` | 90–100 %: green |
| `--chart-1` | `#00d4aa` | chart series 1 |
| `--chart-2` | `#00a8ff` | chart series 2 |
| `--chart-3` | `#a855f7` | chart series 3 |
| `--chart-4` | `#f472b6` | chart series 4 |
| `--chart-5` | `#fbbf24` | chart series 5 (also JSON numbers) |
| `--border-subtle` | `#252536` | default hairlines, row dividers, stat-strip gaps |
| `--border-default` | `#333348` | inputs, popovers, badges, cards |
| `--border-strong` | `#4a4a60` | emphasis, hover border, dividers |
| `--space-xs` | `4px` | spacing step 1 |
| `--space-sm` | `8px` | spacing step 2 |
| `--space-md` | `14px` | spacing step 3 |
| `--space-lg` | `20px` | spacing step 4 |
| `--space-xl` | `32px` | spacing step 5 |
| `--control-height` | `24px` | the one control density (inputs, selects, inline/icon actions, segmented, pagination) — CI-pinned |
| `--control-radius` | `5px` | control/tag/icon-action radius |
| `--analysis-action-gap` | `5px` | gap in analysis toolbars |
| `--analysis-icon-optical-offset` | `0.25px` | optical nudge for toolbar icons |
| `--analysis-action-padding-start` | `9px` | toolbar action inline padding |
| `--analysis-action-padding-end` | `11px` | toolbar action inline padding |
| `--dropdown-radius` | `7px` | dropdown panel radius |
| `--dropdown-option-height` | `32px` | dropdown option row |
| `--tab-height` | `34px` | tab min-height |
| `--segment-height` | `24px` | segmented control height (declared; CSS actually uses `--control-height`) |
| `--badge-height` | `20px` | badge/tag min-height |
| `--chip-height` | `26px` | chip min-height |
| `--stat-strip-min-height` | `72px` | stat strip item |
| `--overview-summary-max-width` | `660px` | overview summary band |
| `--analysis-matrix-max-width` | `720px` | analysis matrix |
| `--info-marker-size` | `12px` | help marker circle |
| `--help-tooltip-width` | `240px` | help tooltip |
| `--status-bar-height` | `38px` | runs status bar (scroll mirror sits above it) |
| `--dropdown-width` | `240px` | structured dropdown menu width |
| `--dropdown-max-height` | `320px` | structured dropdown max height |
| `--example-filter-range-width` | `88px` | analyzer example filter range input |
| `--radius-md` | `8px` | card/stat-strip radius |
| `--radius-pill` | `999px` | pill radius |
| `--transition-fast` | `150ms ease` | hover/colour transitions |
| `--page-constrained-width` | `1120px` | constrained page container |
| `--settings-prompt-rail-width` | `200px` | settings prompt rail |
| `--settings-prompt-tab-width` | `240px` | settings prompt tab |
| `--settings-prompt-editor-min-height` | `280px` | settings prompt editor |
| `--font-xs` | `10px` | badge/pill chrome only — CI-pinned |
| `--font-sm` | `11px` | meta / caption / label / table header — CI-pinned |
| `--font-base` | `12px` | body / table cell / code — CI-pinned |
| `--font-md` | `13px` | card title / sub-header / form input — CI-pinned |
| `--font-lg` | `15px` | section header — CI-pinned |
| `--font-xl` | `18px` | modal / empty-state title, mid-tier value — CI-pinned |
| `--font-title` | `22px` | page title (one per page) — CI-pinned |
| `--font-stat` | `26px` | stat / hero value — CI-pinned |
| `--chart-first-col-width` | `320px` | charts view label/control column |
| `--font-mono` | `'Qym Arabic', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', monospace` | data only (IDs, numbers, JSON, timestamps). Menlo must stay |
| `--font-sans` | `'Qym Arabic', -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif` | everything humans read |

Companion declarations that are part of the token layer and must travel with it:

| Where | Declaration | Role |
|---|---|---|
| `dashboard.css:143-147` | `@font-face { font-family: 'Qym Arabic'; src: local('Geeza Pro'), local('Segoe UI'), local('Tahoma'), local('Noto Sans Arabic'); unicode-range: U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF; }` | Arabic glyphs render in a real Arabic face in both stacks |
| `dashboard.css:154-157` | `[dir="rtl"], [dir="rtl"][lang="ar"]:not(#qym-rtl-leading) { line-height: 1.7; }` | Arabic leading that page rules cannot override |
| `ui_components.css:8-12` | `--qym-chevron-down-muted`, `--qym-chevron-down-accent`, `--qym-chevron-up-accent` (data-URI SVGs with `#9a9ab2` / `#00d4aa` strokes) | select chevrons; in React replace with an inline `<Icon name="chevron">` using `currentColor` |
| `shell.css:12-21` | `--sidebar-w: 192px; --sidebar-collapsed-w: 56px; --topbar-h: 50px; --shell-font-xs: 12px; --shell-font-sm: 13px; --shell-font-base: 14px; --shell-font-md: 15px; --shell-font-lg: 17px` | shell chrome only (brief 01); `--shell-font-sm`/`--shell-font-md` are CI-pinned |
| `shell.css:920-932` | `--qym-skeleton-wait` (0.3 s), `--qym-arrive-wait`, keyframes `qym-arrive`, `qym-arrive-draw`, `qym-arrive-grow`, `qym-skeleton-shimmer` | skeleton/arrival motion |
| runtime-only vars | `--qym-segment-x`, `--qym-segment-width`, `--qym-page-digits`, `--qym-item-metric-columns`, `--qym-select-chevron-image`, `--empty-state-width` (fallback 460px), `--motion-fast` (referenced with fallback `0.14s`, never defined) | set by JS; in React set via `style={{'--qym-…': …}}` on the component |

Tokens the new app should **add** (log them in OPEN_QUESTIONS; they replace hardcoded
hex in the old CSS): `--accent-primary-hover: #00e6b8`, `--error-hover: #dc2626`,
`--focus-ring: 0 0 0 2px rgba(0, 212, 170, 0.15)`, `--shadow-popover: 0 12px 28px rgba(0,0,0,.38)`,
`--shadow-dialog: 0 20px 60px rgba(0,0,0,.5)`, `--z-dropdown: 100`, `--z-dialog: 9998`,
`--z-toast: 9999`, `--z-tooltip: 10000`.

---

## 5. Shared dependencies

What the primitives themselves depend on (so the foundation agent sequences work):

| Dependency | Used by | For |
|---|---|---|
| `QymSafe.escapeHtml` (`qym_safe.js:43`) | `renderErrorState`, `json_viewer.js` (hard requirement: "qym_safe.js loads before this file") | HTML escaping — disappears in React (JSX escapes) |
| `QymSafe.textDirAttrs / applyTextDir / textBlock` (`qym_safe.js:195-222`) | every output block, `.qym-text` recipe | `dir="rtl" lang="ar"` vs `dir="auto"` → becomes a `useTextDirection(text)` hook + `<TextBlock>` primitive in the foundation |
| `QymShell.pageSignal()` (`shell.js:1612`) | scroll mirror cleanup | per-page `AbortSignal` → React effect cleanup replaces it |
| `QymAuth.loginUrl()` (`auth.js`) | `renderErrorState` auth kind | Sign-in link target; keep as `auth.loginUrl()` in the API client module |
| `QymMetrics.getMetricColorClass(value, type, direction)`, `metricDirection(spec)`, `getRowScore` (`metrics.js`) | `.qym-score-value` users | score band selection; port as pure TS in `frontend/src/lib/metrics.ts` (brief 03/04 need it; foundation should own it because `ScoreValue` is a primitive) |
| `QymShell.toast`, `openConfirmDialog`, `openFormDialog`, `openDrawer`, `skeletonHTML` (`shell.js:2300, 964, 1230, 1401, 2609`) | 15+ files | these are *built on* `openDialog`; in React they are `useToast()`, `<ConfirmDialog>`, `<FormDialog>`, `<Drawer>`, `<Skeleton>` in the primitive library, not in the shell |
| `localStorage['qym:data-table:widths:<key>']` | `QymDataTable` | persisted column widths — keep the exact key format so existing users keep their widths |
| `document`-level MutationObserver (`ui_components.js:942`) | everything | the "auto-enhance" mechanism. Has no equivalent and must not be ported; React components own their behaviour |

Things the primitive layer **defines** that other areas import: all of §1. Brief 04
(run detail) also imports `.qym-output-*`, `.qym-metric-compare__*`, `.qym-item-*`
from `ui_components.css:2353-3731`; those are feature components, not primitives.

---

## 6. How to carry the tokens into the new app

Decision frame: "keep tokens, free the layout". Tokens are already CSS custom
properties, the CI test greps CSS text for them, and dark-only `color-scheme` is a
document-level property. Any approach that compiles tokens into something else
(JS objects, utility classes) adds a translation layer the lint has to see through.

### Recommendation: `tokens.css` + CSS Modules (+ a generated `tokens.ts` for charts)

1. `frontend/src/styles/tokens.css` — the `:root` block from §4 **verbatim** (same
   names, same values, same comments), plus `color-scheme: dark`, the `@font-face`,
   the `[dir=rtl]` leading rule, and the added tokens listed at the end of §4.
   Imported once in `frontend/src/main.tsx` before anything else.
2. `frontend/src/styles/base.css` — reset (`* { box-sizing }`), `body` font/colour/
   line-height, scrollbar styling (`dashboard.css:160-211`), `[aria-modal][tabindex=-1]:focus`.
3. Every primitive in `frontend/src/ui/<Name>/<Name>.module.css` uses only
   `var(--…)` values. Vite supports CSS Modules with zero config; class names are
   scoped so the 150 legacy alias selectors and the specificity wars
   (`.role-badge.role-badge`, `:not(#qym-rtl-leading)`) do not come back.
4. `frontend/src/styles/tokens.ts` — generated by a 30-line script (`scripts/gen-tokens.mjs`,
   run in `prebuild`) from `tokens.css`: `export const tokens = { textPrimary: 'var(--text-primary)', … } as const` and `export const tokenValues = { textPrimary: '#ededf0', … }` for canvas/SVG charts that cannot read `var()`. The script fails if a value in `tokens.ts` drifts from `tokens.css`, which replaces `test_root_tokens_present` for the JS side.
5. Data attributes for state (`data-selected`, `data-variant="danger"`, `data-size`), not class concatenation, so one module rule per state and no `clsx` soup.

Why not Tailwind (even with tokens mapped into `theme.extend`): the design language is
a *role* system (eight type roles, four text greys with usage rules). Utility classes
make it trivial to write `text-[11.5px]` or `text-dim` on readable content, and the
lint would have to parse class strings in TSX to catch it. Tailwind also brings its
own preflight/colour palette that the "no raw white surface" test would have to
exclude. The gain (speed for layout) is real but it undermines the thing this repo
has spent the most effort enforcing.

Why not vanilla-extract: it gives typed tokens and zero-runtime CSS, but the styles
live in `.css.ts` files, so the existing regex-based rules (`font-size:\s*\d+px`,
`color: var(--text-dim)` in a `th` block, raw white backgrounds) need a different
parser, and it adds a Vite plugin plus a mental model (sprinkles/recipes) every area
agent must learn. CSS Modules keep the rules greppable and the CSS readable by the
same reviewers who read `ui_components.css` today.

Why not styled-components/Emotion: runtime CSS-in-JS, no static text to lint, and
the RTL/`unicode-bidi` rules get buried in template strings.

Shell chrome keeps its own `--shell-font-*` tokens in `frontend/src/shell/shell.css`
(brief 01), still never redefining `--font-*`.

---

## 7. UX pain points observed

Accessibility and interaction problems in the current primitives, in priority order:

1. **Score is colour-only.** `.qym-score-value.score-N` encodes band by hue alone;
   red/green colour-blind users get nothing (no icon, no underline, no text label).
   Add a `data-band` attribute and an optional leading glyph or a 2 px left bar.
2. **`aria-sort` is on a hidden button** (`qym_table.js:197`), not the `<th>`; screen
   readers announce the header as a plain button with no sort state. Resize is mouse-only.
3. **Dropdown and multi-select have no arrow-key navigation**; Tab walks through
   every checkbox and every "Only" button (2 stops per option, 30+ stops for a
   model list). No typeahead, no `aria-activedescendant`.
4. **Segmented options are separate Tab stops**; a 5-option control costs 5 Tabs.
   Should be one stop with arrow keys (radiogroup pattern).
5. **Page behind a dialog is not inert**; the focus-recapture hack (`:1052`) pulls
   focus back after the fact, which screen readers experience as a jump. `.modal`
   (page-level) dialogs on the runs page do not use `openDialog` consistently.
6. **Two toast systems, two button recipes, two modal recipes** with slightly
   different padding (8/14 vs 24 px), radius (6 vs 5 vs 10) and z-indexes
   (1000 vs 9998). Users see three button heights on one page (24 px inline
   actions, ~30 px `.btn`, 42 px auth fields).
7. **Help tooltip portal is `aria-hidden`**; the visible tooltip is never the one
   announced, and `cursor: help` on a button suggests it is not clickable.
8. **Tooltip copies `textContent` only** — any formatting in the inline tooltip is lost in the portal.
9. **Scroll hold** patches `Element.prototype`; it interferes with any library that
   scrolls programmatically (virtualizers, CodeMirror) and is invisible to debug.
10. **Pagination input** snaps to the current page silently when the entry is out
    of range or unchanged (no feedback); the summary in the main variant is not
    `aria-live`, so SR users do not hear the new range.
11. **Hardcoded hover colours** (`#00e6b8`, `#dc2626`) and `color: white` on danger
    buttons bypass tokens; `.form-hint` is 10 px readable text (grandfathered).
12. **Legacy alias explosion**: `:is()` lists with 25 selectors per rule make the
    cascade unpredictable (`.form-input` is roomy in `dashboard.css:4594` and 24 px in
    `ui_components.css:14`; which wins depends on load order, which DESIGN_LANGUAGE §3
    has to spell out: "load the stylesheet after page-local styles").
13. **JSON tree** has no keyboard navigation beyond Tab to each toggle; punctuation
    spans are read aloud ("comma", "open brace").
14. **Empty-state icons are emoji/text glyphs at 48 px `--text-dim`** — low contrast by design, but some pages put instructions in the icon slot.
15. **Focus rings are 1 px** (`outline: 1px solid var(--accent-primary)`); on `--bg-elevated` controls this is at the edge of visibility. 2 px with 2 px offset is safer; keep it uniform.
16. **Stale banner has no live region role**.

---

## 8. Migration notes

### 8.1 Proposed React primitive library (`frontend/src/ui/`)

Headless base: **React Aria Components** (`react-aria-components`), styled with CSS
Modules via its `className`/`data-*` state attributes. Reasons:

- It covers every behaviour in §2 that the old code hand-rolled: `Dialog`/`Modal`
  (focus scope, restore, stack, `inert` outside), `Tabs` (roving focus, automatic
  activation, RTL-aware arrow keys), `ToggleButtonGroup` (segmented with arrow keys),
  `Tooltip` (hover + focus, delay, positioning/flip), `Popover`, `ListBox`/`Select`/
  `ComboBox` (typeahead, multi-select, `aria-activedescendant`), `Table` with
  **built-in column resizing** (keyboard + pointer) and sortable `aria-sort` on the
  column header, `Checkbox`, `Slider` (threshold control), `Tree` (JSON viewer),
  `Toast` queue (`useToastQueue`).
- Its state is exposed as `data-selected`, `data-pressed`, `data-focus-visible`,
  `data-hovered`, `data-disabled`, which maps 1:1 onto one CSS-module rule per state
  and keeps the "focus-visible outline only, glyph-only hover" rules lintable.
- RTL: `I18nProvider` + logical properties; Arabic content blocks already need `dir`.
- Alternative considered: Radix UI. Strong `Dialog`/`Tabs`/`Tooltip`/`Popover`/
  `ToggleGroup`, but no listbox/combobox/multi-select or table resizing, so three
  of the hardest primitives (multi-select dropdown, data table, JSON tree) would
  still be hand-rolled. Pick Radix only if bundle size proves decisive (React Aria
  Components tree-shakes per component; expect ~60–90 kB gzip for the full set).

Component list (names are the public exports; props sketches are TypeScript):

```ts
// Layout & text
export function Stack(props: { gap?: 'xs'|'sm'|'md'|'lg'|'xl'; direction?: 'row'|'column'; align?: ...; children })
export function Text(props: { role: 'title'|'stat'|'xl'|'lg'|'md'|'base'|'sm'|'xs'; tone?: 'primary'|'secondary'|'muted'; mono?: boolean; as?: keyof JSX.IntrinsicElements; children })
export function TextBlock(props: { text: string; mode?: 'raw'|'rendered'; code?: boolean })   // QymSafe.textBlock: sets dir/lang, pre-wrap, safe markdown subset
export function useTextDirection(text: string): { dir: 'rtl'|'auto'; lang?: 'ar' }
export function PageHeader(props: { title: string; description?: string; meta?: ReactNode[]; actions?: ReactNode; tabs?: ReactNode })
export function SectionHeader(props: { title: string; description?: string; aside?: ReactNode; level?: 'lg'|'xl' })  // run-section-head uses 'xl'
export function Eyebrow(props: { children })   // uppercase --font-sm label

// Actions
export function Button(props: { variant: 'neutral'|'accent'|'danger'|'ghost'|'primary'; size?: 'sm'|'md'; icon?: ReactNode; loading?: boolean } & AriaButtonProps)
export function IconButton(props: { label: string; icon: IconName|ReactNode; tone?: 'default'|'danger'|'approve'|'reject'; size?: 24 } & AriaButtonProps)
export function CopyButton(props: { text: string | (() => string); label?: string })   // shared SVG, 1.5 s "Copied"
export function LinkButton(...)  // <a> styled as Button, for Sign in / hrefs
export function Icon(props: { name: 'chevron-down'|'chevron-right'|'copy'|'first'|'prev'|'next'|'last'|'close'|'expand'|'external'|'trash'|'warning'|'retry'|...; size?: 12|14|16 })  // all stroke="currentColor"

// Inputs (24 px density)
export function TextField(props: { label?: string; hideLabel?: boolean; size?: 'sm'|'auth'; mono?: boolean; prefixIcon?: ReactNode } & AriaTextFieldProps)
export function SearchField(props: TextFieldProps & { onClear?: () => void })
export function NumberField(...), Textarea(...), Checkbox(...), Switch(...), Slider(props: { unit?: string })
export function Select<T>(props: { label: string; items: T[]; value: Key|null; onChange(key): void; searchable?: boolean|'auto'; placement?: 'bottom'|'top'; renderItem?(item: T) })
export function MultiSelect<T>(props: { label: string; items: T[]; value: Set<Key>; onChange(keys: Set<Key>): void; searchable?: boolean; onlyAction?: boolean /* "Only" */; selectAll?: boolean; renderItem?; emptyOption?: { key, label } })
export function SegmentedControl<K extends string>(props: { label: string; options: { value: K; label: ReactNode; disabled?: boolean; title?: string }[]; value: K; onChange(v: K): void; storageKey?: string /* indicator memory */ })
export function Chip(props: { selected?: boolean; count?: number; onRemove?(): void; children } & AriaToggleButtonProps)

// Navigation
export function Tabs(props: { label: string; items: { id: string; label: ReactNode; count?: number; disabled?: boolean }[]; selected: string; onSelect(id): void; variant?: 'underline'|'dense'; children /* <TabPanel id> */ })
export function Pagination(props: { total: number; page: number; pageSize: number; pageCount?: number; noun?: string; showSummary?: boolean; pageSizeOptions?: number[]; onPageChange(p: number): void; onPageSizeChange?(s: number): void; scrollTarget?: RefObject<HTMLElement> })

// Status & data display
export function Badge(props: { tone: 'success'|'info'|'danger'|'warning'|'neutral'; dot?: boolean; children })
export function RunStatusBadge(props: { status: 'PENDING'|'SUBMITTED'|'RUNNING'|'COMPLETED'|'FAILED'|'STOPPED'|'APPROVED'|'REJECTED' })  // maps status → tone
export function Tag(props: { kind?: 'role'|'accent'|'count'|'data'|'version'; tone?: 'success'|'info'|'warning'|'danger'; children })
export function ScoreValue(props: { value: number|null; type?: MetricType; direction?: 'higher'|'lower'|'none'; error?: 'task'|'metric'; retries?: number; ci?: [number, number] })  // band class + ⚠/↻ glyphs + data-band
export function StatStrip(props: { items: { label: ReactNode; value: ReactNode; sub?: ReactNode; help?: string; icon?: ReactNode }[]; variant?: 'band'|'compact-header' })
export function KeyValueGrid(...)  // versioning details etc.
export function Kbd(props: { children })
export function DataTable<Row>(props: { columns: Column<Row>[]; rows: Row[]; storageKey?: string; sort?: { key: string; direction: 'asc'|'desc' }; onSortChange?; rowKey(row): Key; renderRow?; onRowAction?; stickyHeader?: boolean; minWidth?: number; frozenColumns?: string[]; hiddenColumns?: string[]; selection?: {...}; emptyState?: ReactNode })
//   Column<Row> = { id; label; sortKey?; width?; minWidth?; flex?; align?: 'start'|'end'; mono?: boolean; cell?(row): ReactNode; resizable?: boolean }
//   persists widths under localStorage 'qym:data-table:widths:<storageKey>' in the same {id: px} shape
export function JsonPreview(props: { value: unknown|string; title?: string })          // button → JsonDialog
export function JsonTree(props: { data: unknown; expandDepth?: number })
export function JsonDialog(props: { value; title; open; onClose })
export function Skeleton(props: { kind: 'value'|'lines'|'chart'|'cards'; width?; rows?; height?; count?; label?: string })
export function EmptyState(props: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode })
export function ErrorState(props: { error: unknown; title?: string; notFoundMessage?: string; onRetry?(): void; compact?: boolean })
export function StaleBanner(props: { since: Date; filtersApplied: boolean; onRetry?(): void })

// Overlays
export function Dialog(props: { open: boolean; onOpenChange(o: boolean): void; title: string; size?: 'sm'|'md'|'lg'|'data'; role?: 'dialog'|'alertdialog'; initialFocus?: RefObject; dismissOnBackdrop?: boolean; children; footer?: ReactNode })
export function ConfirmDialog(props: { title; description: string|string[]; warning?: string; confirmLabel; tone?: 'danger'|'accent'; requireText?: string; onConfirm(): Promise<void>|void })  // starts focused on Cancel
export function FormDialog(...)   // shell.js openFormDialog fields → controlled form
export function Drawer(props: { open; onOpenChange; title; subtitle?; width?: number; actions?: ReactNode; children; footer? })  // stays mounted → inert + aria-hidden when closed
export function Popover(props: { trigger: ReactNode; placement?; children })
export function DropdownMenu(props: { trigger; items: { id; label; icon?; tone?: 'danger'; disabled? }[]; onAction(id) })
export function HelpMarker(props: { label: string; children: ReactNode /* tooltip body */ })   // hover/focus open, press to pin, Escape closes
export function Tooltip(props: { content: ReactNode; delay?: number; children })
export function Toaster()  and  useToast(): { show(message, { tone?: 'success'|'error'|'info'; action?: { label; onClick }; timeout? }) }
export function ScrollMirror(props: { target: RefObject<HTMLElement> })   // optional, see §3

// Lib (no DOM)
export { classifyError, QymRequestError, fetchJson }  from '@/lib/http'   // same kinds + copy table
export { getMetricColorClass, metricDirection, getRowScore } from '@/lib/metrics'
```

Module layout: `frontend/src/ui/<Name>/{<Name>.tsx, <Name>.module.css, <Name>.stories.tsx?, index.ts}` and `frontend/src/ui/index.ts` barrel. Each `.module.css` starts with a one-line comment naming the DESIGN_LANGUAGE recipe it implements.

Placement of behaviours that today are global:
- Document-level click delegation (`[data-qjv-json]`, `.qym-dropdown__trigger`, help markers) → gone; components own handlers.
- `MutationObserver` auto-enhance → gone.
- Scroll hold → not ported (OPEN_QUESTIONS).
- `alignMetricColumns` → brief 04, as a hook.

### 8.2 Porting the design-language test

Current test → what it checks → how to re-target it to `frontend/`:

| Current test (`tests/platform/test_design_language.py`) | Rule it enforces | Port |
|---|---|---|
| `test_no_hardcoded_font_sizes` + `test_frozen_inventory_not_stale` (`:33-36` regexes `font-size:\s*([\d.]+)px` in CSS and `fontSize:\s*['"]([\d.]+)px['"]` in JS; `FROZEN_HARDCODED_SIZES` per file `:67-77`) | tokens-only typography; frozen glyph allowlist with a ratchet | Same regexes over `frontend/src/**/*.{css,tsx,ts}`; add `fontSize:\s*[\d.]+` (numeric JSX style) and `font-size:\s*[\d.]+px` inside template literals. Allowlist keyed by path relative to `frontend/src`, start **empty** (the only legitimate hardcoded sizes are decorative glyphs; give them a token `--glyph-lg: 48px` instead). Keep the ratchet test |
| `test_root_tokens_present` (`:80-101`, 13 dashboard + 2 shell declarations by exact string) | token vocabulary cannot drift | Same strings asserted in `frontend/src/styles/tokens.css` and `frontend/src/shell/shell.css`; plus `tokens.ts` ↔ `tokens.css` equality (generator check) |
| `test_no_scoped_font_token_forks` (`:103-113`) | `--font-*` defined only in the token file | Regex `^\s*--font-(xs\|sm\|base\|md\|lg\|xl\|title\|stat):` must match only in `tokens.css`; extend to `--text-*`, `--bg-*`, `--control-height` |
| `test_banned_patterns` (`:117-135`: `#7a7a90`, `#50505e`, `DM Sans`, `Georgia`, `fonts.googleapis.com`) | no old greys, no webfonts | Same list over `frontend/` (including `index.html`, `package.json` deps: ban `@fontsource/*`); add `#00e6b8`, `#dc2626`, `#94a3b8` once they become tokens |
| `test_dim_not_on_table_headers` (`:137-148`) | `--text-dim` never on `th` | Same regex over `.module.css`; broaden: `--text-dim` allowed only in rules whose selector contains `placeholder`, `disabled`, `[aria-disabled]`, `glyph`, `icon`, `arrow`, `sep`, or has a `/* decorative */` comment on the same declaration — else fail |
| `test_shared_ui_primitives_are_on_spec` (`:152-240`: ~35 `qym-*` selectors and ~25 declaration strings must exist in `ui_components.css`) | the shared layer stays centralized | Replace with a **module-existence and contract test**: for each primitive in §8.1, `frontend/src/ui/<Name>/<Name>.module.css` exists and contains the declarations that encode the recipe (`height: var(--control-height)` in Button/TextField/Select/SegmentedControl/IconButton/Pagination; `border-radius: var(--radius-pill)` + `border: 1px solid` in Badge; `border: 0` + `border-radius: var(--control-radius)` in Tag; `min-height: var(--chip-height)` in Chip; `min-height: var(--dropdown-option-height)` in MultiSelect/Select; `min-height: var(--tab-height)` in Tabs; `background: var(--accent-primary)` for the selected segmented option; `width: var(--info-marker-size)` in HelpMarker; `min-height: var(--stat-strip-min-height)` + `align-items: flex-start` in StatStrip). Drop every legacy-alias assertion (`.reviews-search input`, `.pg-mapping-key-select`, `--dsx-action-h`, `padding-left: 26px`, `.field-input`, `.pg-connection`) — they are migration shims |
| `test_badges_tags_and_icon_actions_keep_distinct_silhouettes` (`:242-290`, slices the CSS by section comments) | pill-outline vs flat-square vs glyph-only hover | Per-module: `IconButton.module.css` hover/focus/copied rules contain `background: transparent` and no `box-shadow`/`color-mix`; `Badge.module.css` has `border: 1px solid` + `border-radius: var(--radius-pill)`; `Tag.module.css` has `border: 0` + `border-radius: var(--control-radius)` |
| `test_compact_control_exceptions_and_alignment_are_preserved` (`:292-358`) | 42 px auth field, composite pickers, inline companions at 24 px, specific page markup counts | Keep only: `TextField[size=auth]` rule has `min-height: 42px` + `font-size: var(--font-md)`; everything else was page-coupling and is dropped |
| `test_shared_ui_behavior_is_accessible_and_exportable` (`:360-372`, greps JS for `aria-describedby`, `aria-expanded`, `'ArrowLeft', 'ArrowRight', 'Home', 'End'`, `MutationObserver`) | behaviour is wired | Replace string-greps with **Vitest + Testing Library behaviour tests** per primitive (Tabs arrow keys, Dialog focus trap/return, HelpMarker pin/Escape, MultiSelect Escape-restores-focus, Pagination Enter-in-input) and **axe** (`vitest-axe`/`@axe-core/playwright`) on each primitive's story. These are the real contract; greps were a proxy |
| `test_qym_component_rules_are_not_forked` (`:374-391`) | canonical component CSS in one file | CSS Modules make forks structurally impossible across modules; keep a lint that feature modules (`frontend/src/features/**/*.module.css`) never declare `height: var(--control-height)`, `border-radius: var(--radius-pill)` on a button-like selector, or any `--font-xs` usage (badge chrome is a primitive) — i.e. features compose primitives instead of re-styling them |
| `test_auto_analysis_component_compatibility_uses_upstream_layer` (`:393-414`) | analyzer adapters extend, not replace | Drop (legacy shim) |
| `test_qdt_table_reference_implementation` (`:416-426`) | `th` = `--font-sm` muted, `td` = `--font-base` secondary | Same assertions on `DataTable.module.css` |
| `test_design_language_doc_exists_and_wired` (`:428-443`) | doc exists, AGENTS.md points at it | Keep; add: `frontend/README.md` points at `docs/DESIGN_LANGUAGE.md` |
| `test_root_declares_the_dark_color_scheme` (`:467-469`) | `color-scheme: dark` in `:root` | Same on `tokens.css`; also `<meta name="color-scheme" content="dark">` in `frontend/index.html` |
| `test_no_stylesheet_paints_a_surface_raw_white` (`:447-491`, regex `background(-color)?:\s*(#fff\|#ffffff\|white)` with a 2-entry allowlist) | surfaces always themed | Same regex over `frontend/src/**/*.css` and over `background(Color)?:\s*['"]…` in TSX; allowlist empty |

Where to put it: `frontend/src/__tests__/design-language.test.ts` (Vitest, Node
environment, `fast-glob` + `fs`), run by `npm test` and by the UX-test agent. Keep
`tests/platform/test_design_language.py` unchanged and pointed at the legacy
dashboard until the cutover deletes `_static/dashboard/`; then delete it too. Add a
Stylelint config (`stylelint-config-standard` + `declaration-property-value-disallowed-list`
for `font-size: /px$/`, `color: /^#/`, `background: /^#|white/`) for editor feedback;
the Vitest file remains the gate because it also lints TSX and checks module contracts.

Additional TSX-only lints worth adding (ESLint `no-restricted-syntax`): inline
`style={{ fontSize: … }}`, `style={{ color: '#…' }}`, `<div onClick>` without a role
(use `Button`), `dangerouslySetInnerHTML` outside `TextBlock`.

### 8.3 Backend changes
None for the primitives themselves. (SPA fallback / CORS belong to brief 01.)

### 8.4 Risks / gotchas
- `--font-xs` (10 px) is CI-pinned and must stay badge-only; `Text role="xs"` should not exist as a free prop — expose it only inside `Badge`/`Tag`.
- `QymDataTable` width persistence key must stay `qym:data-table:widths:<storageKey>` with the same `{id: px}` JSON, and `storageKey`s must match the old pages (`experiments`, `eval-queue`, `trash`, `datasets` — confirm per area brief).
- React Aria `Table` resizing requires `ResizableTableContainer` and `allowsResizing` on columns; its persisted widths are its own shape — adapt in `DataTable`.
- Focus-ring rule: React Aria exposes `data-focus-visible`; do not style `:focus` (the dialog container focus must draw no ring).
- Tooltips/popovers portal to `<body>`; the Dialog must mark them as allowed (React Aria handles this through its own focus scope; do not add a manual recapture).
- `prefers-reduced-motion` must disable the segmented indicator, toast slide, dialog slide, skeleton shimmer.
- Arabic: `TextBlock` must set `dir` on the block element, `text-align: start`, `unicode-bidi: plaintext` for code; `tokens.css` carries the 1.7 leading rule.
- `color-mix()` and `:has()` are already relied upon; target browsers are current evergreen only.

### 8.5 Suggested Playwright scenarios (foundation `frontend/e2e/ui/`)
1. Open `ConfirmDialog` from a button; focus lands on Cancel; Tab cycles inside; Escape closes; focus returns to the trigger.
2. Nested dialog: open `JsonDialog` from inside a `Drawer`; Escape closes only the top one; focus returns to the preview button.
3. `Tabs`: ArrowRight from the last tab wraps to the first and activates it; Home/End work; disabled tab skipped.
4. `SegmentedControl`: one Tab stop; ArrowLeft/Right moves selection; indicator has no transition under reduced motion.
5. `MultiSelect`: open focuses search; typing filters; ArrowDown moves through options; Space toggles; "Only" clears others; Escape closes and restores trigger focus; outside click closes.
6. `HelpMarker`: hover shows tooltip; click pins; scroll closes; Enter on focused marker pins; Escape unpins; `aria-describedby` resolves to the tooltip text.
7. `Pagination`: Enter in the page input navigates; out-of-range snaps back; First/Last disabled at edges; `scrollTarget` scrolled to top.
8. `DataTable`: Enter on a header sorts and `th[aria-sort]` updates; drag a resize handle and reload → width persisted under the localStorage key; keyboard resize via Arrow keys on the focused handle.
9. `ErrorState`: 401 renders "Sign in" link to `loginUrl`; 500 renders Retry; 404 renders no action.
10. axe scan of a page that renders every primitive once (`/app/__mock/ui/kitchen-sink`): zero serious/critical violations.

---

## 9. Open questions

1. **Scroll hold**: not porting it. Verify in brief 03/04 Playwright runs that toggling a filter or expander does not move the pressed control; if it does, add an opt-in `useScrollHold(ref)` hook rather than global patching.
2. **Headless library**: React Aria Components recommended; if the foundation agent measures >120 kB gzip for the primitive bundle, fall back to Radix + hand-rolled `MultiSelect`/`DataTable` resize and log it.
3. **Button sizes**: the old app has 24 px (inline action), ~30 px (`.btn`/`.shell-btn`) and 42 px (auth). Proposal: `sm`=24 (default in toolbars/tables), `md`=32 (dialog footers, page actions), `auth` only inside `TextField`. The 32 px value is new; log it.
4. **Score non-colour cue**: which secondary cue (left bar vs glyph vs `data-band` text in a tooltip)? Design agent decision; must not add readable text below 11 px.
5. **Segmented indicator memory** (`storageKey`): is cross-render position memory worth keeping once React keeps the DOM node? Default: drop; keep the transition only.
6. **Legacy `.status-badge` colours** (`#94a3b8` SUBMITTED grey, purple COMPLETED) differ from the `.qym-badge` alias block (COMPLETED = success). The alias block wins today (loaded later). Keep the `.qym-badge` mapping: COMPLETED→success, RUNNING→info, FAILED/REJECTED→danger, STOPPED→warning, PENDING/SUBMITTED→neutral, APPROVED→success.
7. **Toast placement**: shell toasts are top-right, runs-page toasts top-center. Pick top-right (shell) for all.
8. **`--segment-height`, `--radius-md`, `--analysis-*`** tokens are declared but either unused or used once; keep them in `tokens.css` verbatim (cheap) and let the ratchet remove them after cutover.
9. **Chevron data-URIs**: replaced by `<Icon>` with `currentColor`; confirm no test pins the data-URI strings (none does today).
10. **JSON viewer**: should `JsonPreview` also serve versioning details / config blobs on runs list rows (brief 03)? If so it needs a compact size prop.
