# Datasets, reviews, trash — migration brief

Written by an analysis agent for the React/TypeScript/Vite migration. Audience: the
component agent that will rebuild this area from scratch in `frontend/`. Be concrete:
file paths with line numbers, API routes with methods and response shapes, exact
behaviors. No marketing language.

All paths below are relative to `packages/platform/qym_platform/` unless stated.
`D` = `_static/dashboard/datasets.html`, `R` = `_static/dashboard/reviews.html`,
`T` = `_static/dashboard/trash.html`, `API-D` = `api/datasets.py`,
`API-A` = `api/analysis.py`, `API-R` = `api/runs.py`.

## 1. Surface inventory

| Page / route | HTML file | JS/CSS it loads | Entry function(s) | approx LOC |
|---|---|---|---|---|
| `/projects/{slug}/datasets` (catalog), `?view=deleted` (deleted datasets) | `D` (served by `API-R:2372 project_datasets`) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `qym_table.js`, `metrics.js`, `trace_viewer.js`, `ui_components.js` (deferred); ~675 lines of inline `<style>` (`D:16-690`) | IIFE at `D:701`; boot `D:5618` (`QymAuth.requireAuth().then(route)`); `route()` `D:1409`; `renderCatalog` `D:1501`; `deletedCatalogView` `D:1815` | HTML 5627 total; JS 4925 (`D:700-5625`) |
| `/projects/{slug}/datasets/{ref}` (detail: Items / Runs / Lineage / Settings tabs; item page when `?item=`) | `D` (served by `API-R:2385 project_dataset_detail`, `dataset_ref:path`) | same | `renderDetail` `D:1521`, `detailView` `D:2889`, `renderTabContent` `D:3283`, `renderItemPage` `D:3674` | included above |
| `/projects/{slug}/datasets/{ref}/compare?base=&head=` | `D` (same route, path suffix `compare`) | same | `renderCompare` `D:1554`, `compareView` `D:5232` | included above |
| `/reviews` (cross-project) and `/projects/{slug}/reviews` | `R` (served by `API-R:2300 reviews_index`, `API-R:2311 project_reviews_index`, archived projects refused) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `ui_components.js` (deferred); ~1445 lines inline `<style>` (`R:16-1460`); static HTML skeleton `R:1464-1649` | IIFE at `R:1652`; `init()` `R:3960` | HTML 3975; JS 2320 (`R:1651-3973`) |
| `/trash` (deleted runs, admin only, no project prefix) | `T` (served by `API-R:2288 trash_index`; note `./static/` relative asset URLs, see `shell.js:1945`) | `dashboard.css`, `shell.css`, `ui_components.css`; `qym_safe.js`, `auth.js`, `shell.js`, `qym_table.js`, `ui_components.js` (deferred); ~100 lines inline `<style>` (`T:14-113`) | IIFE at `T:147`; `init()` `T:632` | HTML 646; JS 500 (`T:146-644`) |

Shell routing for these pages: `shell.js:109-123` (SPA-handled path patterns), `shell.js:160-172, 195-200` (page detection), `shell.js:553-554, 578` (sidebar nav items: Reviews, Datasets, Deleted Runs — the latter has `nav-item-role-admin`, hidden for non-admins `shell.js:813`).

`dashboard.js` (the runs-list page) only references this area through URL patterns (`dashboard.js:31-41`) and a dataset-version filter key helper (`dashboard.js:79-100`); nothing in this area imports from it.

## 2. User journeys (as-is)

### Datasets

1. **Browse the catalog.** Entry: sidebar "Datasets" or `/projects/{slug}/datasets`. The page draws a skeleton grid (`D:696`, `D:1638`), fetches `GET /v1/datasets?project_slug=`, and renders one card per dataset (`catalogCard` `D:1742`): identicon (`Shell.identicon`), creator pill, name, "Private test set" tag, a mono state line (`v3 prod · v4 draft` / `v2 draft · never published` / `empty`), 2-line clamped description, stats (items, versions, runs), created/updated dates. Cards are real `<a>` links (middle-click works). Header: title, live count sub-line ("N datasets · M runs"), search box (debounced 180 ms, client-side filter on name/slug/description, mirrored to `?q=` via `replaceState` `D:1695`), sort select (`updated_desc | name_asc | items_desc | runs_desc`, client-side, in-memory only, not persisted), "Deleted datasets" link, "+ New dataset" menu (Start blank / Import CSV-TSV-JSON-JSONL). Empty project: controls hidden, single "+ Create your first dataset" CTA (`D:1714-1733`). Load failure: shared error state with Retry (`renderDatasetLoadError` `D:797`), never the empty CTA. Archived project (`project.is_active === false`): no create controls (`projectReadOnly()` `D:1352`).

2. **Create a blank dataset.** "+ New dataset → Start blank" opens `Shell.openFormDialog` (`D:1900`): Name (required), Slug (optional, auto), Description. `POST /v1/datasets`; on success toast + navigate to the detail page. 409 on slug clash surfaces as a toast with the server detail.

3. **Import a file as a new dataset / new version / into a draft** (3-step wizard, `openUploadWizard` `D:2054-2884`). Modes: `new` (catalog), `new-version` (hero overflow "Upload file as new version…" `D:3031`, or auto-switched from `new` when the name clashes with an existing dataset `D:2297`), `add-to-draft` (hero "Import" on a draft, or empty-draft CTA).
   - Step 1 "Source": Name (mode `new` only; prefilled from the file name; live slug preview via `slugifyDatasetName` `D:1995`; live clash check against the loaded catalog with an inline "Upload as a new version of X" link `D:2273-2296`), Description, file drop zone (`.csv,.tsv,.txt,.jsonl,.ndjson,.json`). The file is read fully client-side with `FileReader.readAsArrayBuffer` (`D:2408`). CSV: BOM/UTF-8/legacy encoding detection (`detectCSVEncoding` `D:1981`, Arabic-aware score mirroring the server's `_legacy_text_score`), encoding `<select>` (UTF-8, UTF-16 LE/BE, Windows-1256, ISO-8859-6, Windows-1252), delimiter detection (`, ; \t |` `D:2517`), RFC-4180-ish parse (`D:2532`), warnings for garbled text. JSON/JSONL: must be UTF-8; `.json` with a top-level array is JSON, else JSONL; every record must be an object; errors list the first 8 bad lines and block Continue (`D:2016-2052`, `D:2313`). Validation errors appear inline (`role="alert"`), "Choose a file" only after Continue.
   - Step 2 "Map columns" (CSV only, skipped for JSON): table of column → sample value → role select (`Input | Expected output | Metadata | Item ID | Ignore`), auto-detected by header names (`autoMap` `D:2555`: input/question/prompt/text; expected_output/expected/answer/output/target/label; id/item_id/example_id; everything else → Metadata). Only one Item ID column (previous one demoted to Metadata). Several Input (or Expected) columns combine into one JSON object keyed by column name. Must have ≥1 Input column. Live summary line (`aria-live`), "Auto-detect columns" button.
   - Step 3 "Review": Version name (optional free text), "Publish immediately" checkbox (default on for `new`, off for `new-version`), "Set as production alias" (only when publishing; disabled with tooltip `PRODUCTION_RULE` when `permissions.can_set_production === false`; warning banner when moving production), file summary (format · encoding · N rows · preview first 10), "Not imported" warning listing ignored CSV columns or unknown JSON keys, 6-column × 10-row preview table.
   - Submit: `new`/`new-version` → one multipart `POST /v1/datasets:upload` (`D:2786-2813`); `add-to-draft` → client builds upserts and calls `POST …/items:bulk` in chunks of 1000 (`D:2815-2863`). Button shows a spinner "Working…"; **no byte-level upload progress** (single fetch). Server error re-renders step 3 with an inline `role="alert"` plus toast. Closing (Esc, ×, backdrop, Cancel) after a file is loaded asks "Discard this upload?" (`requestClose` `D:2172`). Focus is trapped (`D:2191-2215`) and returned to the opener.

4. **Open a dataset (detail).** Entry: card click, deep link `?tab=&v=`. Loads `GET /v1/datasets/{ref}` then `GET …/versions`; the breadcrumb shows a remembered name while loading (`sessionStorage` `qym:dataset-name:{slug}/{ref}` `D:1515`). Active version resolution (`resolveActiveVersion` `D:1574`): `?v=` as alias, then as label, else the `production` alias, else newest published, else newest. The URL is normalised to always carry `?v=` (`D:1458`). Hero (`buildHero` `D:3070`): identicon, name with hover ✎ rename, "Private test set" tag, description (click to edit) or "+ Add a description", meta row (versions · runs · items · "forked from vN" link · source · Published By / Drafted By pills · updated), right side: **version switcher pill** (combobox-over-listbox popover with search, ↑/↓/Home/End/Enter/Esc, rows are real links `D:3146-3254`) and state-driven actions (`fillHeroActions` `D:2975`): no versions → "+ Create first draft"; draft → "+ Add item", "Import", "Publish"; published non-prod → "Set as production" (disabled w/ tooltip when not allowed) + "+ Create draft"; production → "+ Create draft"; overflow menu (⋮): Name version…, Compare…, ↓ Download JSONL (opens `…:download` in a new tab), ↑ Upload file as new version…. Tabs: Items, Runs, Lineage, Settings (`?tab=`; legacy `?tab=versions` redirects to lineage `D:1221`). Tab switches within the same dataset re-render only the tab panel (`switchDetailTabFromRoute` `D:1465`); shell `qym:popstate` is intercepted for Back/Forward (`D:1316`).

5. **Browse / search / sort items (Items tab, `renderItemsTab` `D:3317`).** Private test set for a non-admin → locked empty state (`D:3309`), no fetch. Otherwise: toolbar with search (debounced 200 ms, server-side `?search=`, rows kept on screen with `aria-busy` while loading `D:3360-3372`), optional `label:` chip (from `?label=`), a `QymDataTable` (column widths persisted under `datasets.items.v2`) with columns `#`, `ID` (only when any item has a user-provided id `hasUserProvidedItemId` `D:1058`), `Input`, `Expected`, `Metadata`, `Runs`, one column per metric (`metric_names`, coloured via `QymMetrics`), `Latency`, `Edits`, ⋮. Header click sorts server-side (`sort=index_asc|…|metric:<name>:desc`, mirrored to the URL silently, page reset `D:3510`). Cells are read-only mono previews with a 700 ms hover popover showing the full value (`D:1093-1127`); the `#` cell is the row's link (one tab stop per row). Row ⋮ menu: Copy as JSON; on drafts also Delete (confirm dialog → `DELETE …/items/{id}` → full reload). Footer "+ Add new item" on drafts. Fixed bottom pager (`QymUIComponents.renderPagination`, page sizes 25/50/100/250, `?page=` 0-based in URL, page size not persisted). Empty states: "This draft is empty" (with Add item / Import file CTAs), "This version has no items", "No items match these filters". Page size default 50 (`D:719`).

6. **Add an item** (`openNewItemFlow` `D:5097`): form dialog with Item ID (auto if blank → `item-{index+1}`), Input (required, textarea), Expected output, Metadata (JSON, validated). Input/Expected are JSON-sniffed (`tryParseJSON` `D:5129`: `{`, `[`, `"`, true/false/null, numbers). `POST …/items` runs inside the dialog (`onSubmit`), so a 409 keeps the user's input. Success → toast + full reload.

7. **Open / edit an item (item page, `renderItemPage` `D:3674`).** URL `?item=<item_id>&tab=details|runs|history` (same `v`, `search`, `sort`, `label` carried so Prev/Next follow the list order via `GET …/items/{id}/neighbors` `D:3793`). Header: title (user id or `Item #index`), copy-ID button, meta (index, updated, created, id), actions: "Create draft to edit" (published versions), Delete (draft), Previous / Next, Save changes (draft). Tabs: Details, Runs, History.
   - Details (`itemPageJSONPanel` `D:3827`): three panels (Input, Expected output | Metadata) each with a stored-type tag (`string|number|boolean|object|array|null`), expand and copy buttons. Read-only → syntax-highlighted `<pre>` (max 55vh, expand toggles). Draft → a transparent auto-growing `<textarea>` over a highlighted `<pre>` overlay (`.dsx-code`), a Text/JSON segmented toggle (not for metadata, which is always JSON object), live validation dot and status text ("unchanged" / "will be saved as number" / "Not valid JSON. Switch to Text…"), type-change warning shown in the tag (`string → number`). Save sends only touched fields (`collectItemPageValues` `D:3926`) via `PATCH …/items/{id}`; server returns `{item}`; page re-renders. **No dirty-state guard** on navigation.
   - Runs: `GET …/items/{id}/runs` → stat strip (Runs, Errors, Avg latency, per-metric avg) + `QymDataTable` (`datasets.item.runs.v4`) of run name (link to `/projects/{slug}/runs/{run_id}?item=`), date, model, output (one-line, header toggle expands all outputs), latency, per-metric score, trace button (`trace-drawer-btn` with `data-trace-endpoint=/api/runs/{run}/items/{item}/trace`, handled by `trace_viewer.js`). Client-side sort (`state.itemRunSort`, in-memory).
   - History: `GET …/items/{id}/lineage` → per ancestor version a card (version tag, Drafted By, date) then each revision (`created|updated|deleted` pill, `#n`, Edited By, time) with a before/after word diff per changed field (`historyDiffBody` `D:3649`, Myers diff with budgets `D:5533-5607`). No revert on the page (the legacy drawer had "↩ Revert to this" `D:4468`; the drawer is no longer reachable from UI, only `window.__dsx.openItemDrawer`).

8. **Create a draft / publish / set production.** "Create draft" (`D:5021`): dialog with Name and "Copy items from" select (blank or any version; default = current) → `POST …/versions {name, from_version}` → navigate to the new draft (optionally straight to an item, `options.itemId`). "Publish" (`D:5055`): dialog explains the snapshot, checkbox "Set as production" (default on; absent when not allowed, with a note) → `POST …/versions/{v}:publish {set_alias?}`. Publishing an empty draft is a 400 toast. "Set as production" (`D:5084`) → `POST …/aliases/production {version}`. "Name version…" (`D:5005`) → `PATCH …/versions/{v} {name}`.

9. **Runs tab** (`renderRunsTab` `D:4558`): `GET /v1/datasets/{ref}/runs?version=<active>&limit=100&offset=` → `QymDataTable` (`datasets.runs.v2`): run name link, status badge, date, model, latency, per-metric averages, → arrow; whole row navigates to the run. Client-side sort; pager when `total > 100`. Empty state links to docs.

10. **Lineage tab** (`renderLineageTab` `D:4756`): `GET /v1/datasets/{ref}/lineage` → parent/child tree (`parent_version_id`), each node: version link (`?tab=lineage&v=`), name, status pill, alias tags, items · runs, `change_counts` chips (+added −deleted ~modified vs parent), Published By / Drafted By pills, "Compare" button (parent vs this → compare page), created/published times. Below: "Change log" `<ol>` of every `changes[]` row (`created | published | uploaded | alias_set`, `describeChange` `D:4716`).

11. **Settings tab** (`renderSettingsTab` `D:4885`): General card (Name, Description, Tags chip input, Save → `PATCH /v1/datasets/{ref}`), Visibility card (admins only, `can_set_private_test_set`): "Private test set (admins only)" checkbox → `PATCH {private_test_set}` immediately (optimistic revert on error), Danger zone: "Delete dataset" (only when `permissions.can_delete`; else rule note) → confirm dialog with `requireText: dataset.name` → `DELETE /v1/datasets/{ref}` → toast → catalog. Read-only project: inputs readonly, no buttons.

12. **Deleted datasets** (`?view=deleted`, `deletedCatalogView` `D:1815`): `GET /v1/datasets?deleted=true` → table (Dataset name + original slug, Deleted at, Deleted by, Latest version, Restore). Restore only when `permissions.can_manage` and not archived; `POST /v1/datasets/{id}:restore` → toast → navigate to the restored dataset. 409 (slug/name now taken) is a toast.

13. **Compare versions** (`compareView` `D:5232`): hero with Base / Head selects (`?base=&head=`), swap button, "Open base" / "Open head" / "Download diff" (fetches the full un-paged compare and downloads `{slug}_{base}_vs_{head}.diff.json`). Summary strip (Added / Removed / Changed / Unchanged). Tabs `changed|added|removed|unchanged` (`?tab=`, default changed). Each list is paged 50 at a time with "Show N more" (`:compare?kind=&limit=50&offset=`), rows are collapsible (`<button aria-expanded>`), the first 3 open, bodies built lazily, change time shown (`changed_at`, "version created" vs "changed"), editor pill, per-field before/after panes with word-level highlights (or a "too large to highlight" note), auto-scroll to the first change in long fields. Item identity shows `Item #n` for UUID-like ids (`compareItemIdentity` `D:1038`).

Keyboard (datasets): version popover combobox keys; context menus (WAI-ARIA menu: ↑↓ Home End Enter Esc Tab, `D:5139-5217`); wizard Tab trap + Esc; legacy drawer only: `j`/`k`.

### Reviews

14. **Work the queue.** Entry: sidebar "Reviews" (`/projects/{slug}/reviews`) or `/reviews` (all projects the user can review; cards then show a Project chip linking to the project queue). `init` waits for `qym:shell-ready`, applies URL state, loads `/v1/me` (header user, bootstrap-admin prompt), then `GET api/corrections?…&limit=25`. Hero: title, "Queue: N to review", "X of Y reviewed" progress bar (`role=progressbar`). Status strip = `role=tablist` (To review / Approved / Rejected / All, ←→ Home End). Toolbar: select-all checkbox, search (debounced 300 ms, server `search=`), sort select (Oldest first default, Lowest confidence, Most recent; persisted in `localStorage` `qym.reviews.sort`), four multiselect dropdowns (Tasks, Datasets, Models, Runs; each with search, Select All / Clear, per-option "Only" and facet counts; `null` = all, `[]` = none), Source segmented (All / AI Only / Human Only / AI+Human Corrected), Confidence min/max range sliders (step 5, debounced 150 ms, clamped), bulk bar (visible when selection > 0: Approve, Reject, Reset, Delete, ×), "Clear filters" (visible when any filter active; resets to the pending tab), result count (`aria-live`), "?" shortcuts dialog. Every filter is mirrored into the query string (`syncReviewsUrl` `R:2753`: `status`, `source`, `conf_min`, `conf_max`, `q`, `task`, `dataset`, `model`, `run` (multi; `__none__` sentinel)); `?id=` deep-links one correction (fetched separately if not on the page, tab switched to its status, card ringed for 2.6 s `R:3310-3355`).
   List: card per correction (`renderCard` `R:2941`): checkbox, `#id`, item id, status badge, "Self-approved" tag, priority tag (High/Medium from confidence < 0.5/0.75, changed diagnosis, ≥14 days waiting `R:2877`), confidence %, "by <corrector> MM/DD HH:MM", actions (Approve ✓ / Reject ✗ on pending; Reset ↺ on decided; disabled with a tooltip when `review_block` is set; Edit ✎; Delete; expand ▶), context chips (Task, Metric, Project, Run → link to `/projects/{slug}/runs/{run_id}?pass=&item=`, Pass, Dataset, Model with reasoning badge), two columns AI vs Human "Root-cause issues" (each issue: category, subcategory, finding, "Why this category" `<details>`, confidence; human column highlighted `changed`, AI `removed` when they differ), footer "Reviewed by X … "comment"", collapsed previews (Input / Expected / Output one-liners from `*_preview`), expandable detail (`GET api/corrections/{id}` on first open: full Input / Expected / Output snapshots rendered key-by-key with link detection and SQL blocks, Revision History, Metric Scores chips, Item Metadata JSON). Infinite scroll: an `IntersectionObserver` on the "Load more" row (root `#reviews-body`, 600 px margin) appends the next cursor page; a manual "Load more" button too; the queue is topped up when fewer than 5 cards remain after removals.
   Keyboard (`R:3884`): `j`/`k` (or ↑/↓ on a focused card) move the current card, `a` approve, `r` reject (opens comment modal), `e` edit, `o`/Enter toggle details, `x` select, `Shift+A` bulk approve, `/` focus search, `?` help, `Esc` closes modal / cancels edit. Current card gets `is-current` and focus; after approve/reject the place advances to the next pending card (`advanceAfterReview` `R:3374`).

15. **Decide a correction.** Approve → `POST api/corrections/{id}/approve {comment:''}` immediately (no dialog), toast, card patched in place or removed if it leaves the current tab; counts refreshed with a `limit=1` request (`refreshCounts` `R:2156`). Reject → modal with optional comment (Ctrl/⌘+Enter confirms) → `POST …/reject {comment}`. Reset → `POST …/reset`. Delete → confirm toast (`role=alertdialog`) → `DELETE api/corrections/{id}` (marks rejected, keeps history). One in-flight action per id (`actionsInFlight` `R:3389`). Blocked by `review_block` → error toast with the server's reason.

16. **Edit the human diagnosis.** `e` or ✎ swaps the Human column for an edit form (`renderEditForm` `R:3242`): a list of issues, each Category (required), Subcategory, Finding, remove button; "Add issue"; Save → `PUT api/corrections/{id}` with `human_root_cause_issues` + legacy fields (`R:3513`); the response may carry a **new id** (a new revision/candidate), handled by `applyCorrectionUpdate` `R:2257`. Cancel/Esc restores.

17. **Bulk actions.** Select via checkboxes, `x`, or select-all (visible cards). Each bulk button only acts on fitting rows (`BULK_FITS` `R:2623`: approve/reject need pending, reset needs decided) and shows a count badge when partial; unfit-only selections are refused with a toast. Approve/Reject open the comment modal describing the view (`describeView` `R:3359`). `POST api/corrections/bulk {ids, action, comment, expected_count, expected_status}`; 409 when rows changed meanwhile ("Reload the list and select again"). The response's `corrections[]` patch the cards. Delete → confirm toast → `action:'delete'`.

### Trash (deleted runs)

18. **Restore deleted runs (admins).** Entry: sidebar "Deleted Runs" (`/trash`). `loadMe` then in parallel `GET api/runs/trash?limit=50&offset=&project_id=&q=` and `GET api/runs/trash/projects`. Header shows retention ("N days" / "Off" from the `X-Qym-Deleted-Run-Grace-Days` header) and the total (`X-Qym-Total-Count`, "N matching" when filtered). Toolbar: search (name or id, debounced 250 ms), project select ("Name (archived) · count"), selection label (`aria-live`), "Restore N selected". Table (`QymDataTable`, `trash-v2`): select (header checkbox selects every restorable row on the page, indeterminate state), Run (name + mono id, tooltip with created time), Project (+ "Project archived" tag), Purges ("in N days" / "in under 1 day" / "Due now" tag, warning when < 3 days, "Purge paused while the project is archived", "Not scheduled"), Deleted (date + "by name"), Status badge, Model (+ reasoning badge), Task, Dataset, Restore (sticky right column; disabled for archived projects). Rows sorted by purge date within the page; a purge-soon row gets a warning left border. Restore one → `POST api/runs/restore {run_id}`; bulk → `{run_ids}` (≤200) returning `restored[]`/`skipped[{run_id, reason}]`; rows removed, toast, list and project facet reloaded; an emptied last page steps back. 403 → "Admin access required" empty state. No URL state at all (filters/page are not in the query string).

## 3. Functional inventory

### Datasets — catalog
- Card grid with identicon, state line, stats, dates — MUST-KEEP (the only overview of version state per dataset).
- Client-side search (`?q=`) and sort select — MUST-KEEP search; sort NICE (could move server-side; `GET /v1/datasets` already accepts `limit/offset` but not sort).
- "+ New dataset" split menu (blank / import) and first-run CTA — MUST-KEEP.
- Deleted datasets view + restore — MUST-KEEP (only recovery path).
- Skeleton → fade "arrive" choreography (`QymShell.skeletonHTML/arrive/watchArrivals`) — NICE (foundation Skeleton primitive should cover it).
- Breadcrumb name from `sessionStorage` while loading — NICE.

### Datasets — import wizard
- Client-side CSV parsing, delimiter + encoding detection with an Arabic-aware heuristic, encoding override select — MUST-KEEP (Excel-on-Arabic-Windows CSVs are a stated use case; the server mirrors it in `API-D:1219-1350` and accepts `encoding`).
- JSON/JSONL validation with per-line errors — MUST-KEEP.
- Column mapping with roles, auto-detect, multi-column combine, "not imported" warnings — MUST-KEEP.
- Name clash detection with "upload as new version" shortcut — MUST-KEEP.
- Publish / set production options with permission gating — MUST-KEEP.
- Discard confirmation, focus trap, focus return — MUST-KEEP (a11y).
- Chunked bulk upsert for add-to-draft (1000/req) — MUST-KEEP (server hard limit `API-D:2710`).
- Upload progress — currently absent (spinner only). NICE: use `XMLHttpRequest`/`fetch` with `ReadableStream` upload progress for `:upload`, and chunk progress ("3 of 12 batches") for add-to-draft.

### Datasets — detail hero / versions
- Version switcher combobox with search and keyboard — MUST-KEEP.
- State-driven primary actions (draft/published/production) — MUST-KEEP.
- Overflow: Name version, Compare, Download JSONL, Upload as new version — MUST-KEEP.
- Inline rename / description edit via dialogs — MUST-KEEP (could become true inline editing).
- Meta row with "forked from vN", Published By / Drafted By pills — NICE.
- Read-only mode for archived projects (`project.is_active === false`, server answers 409 on writes) — MUST-KEEP.
- Late shell-ready reconciliation (`reconcileLateShellProject` `D:1400`) — DROP-CANDIDATE (React Query + shell context removes the race).

### Datasets — items table
- Server-paged, server-sorted, server-searched table with metric columns and persisted column widths — MUST-KEEP.
- Hover popover with the full value — NICE (consider a Popover primitive; keyboard users have the item page).
- Row ⋮ (Copy as JSON, Delete) — MUST-KEEP.
- `label:` chip filter from `?label=` — NICE (no UI sets it; only deep links).
- Fixed-bottom pager that offsets by sidebar width (`D:348-350`) — DROP-CANDIDATE (layout-specific hack; use a normal table footer).
- "Refresh single row after edit" (`state.refreshItemRow` `D:3378`) — DROP-CANDIDATE (React Query invalidation).

### Datasets — item page
- Text/JSON mode editor with type tag, live validation, highlight overlay, auto-grow, expand — MUST-KEEP (the core editing contract: strings stay strings, type changes are explicit and visible).
- Partial PATCH (only touched fields) — MUST-KEEP (server contract `API-D:2629`).
- Prev/Next following the list's search/sort — MUST-KEEP.
- Runs tab with stat strip, sortable table, trace drawer — MUST-KEEP.
- History tab with word diffs — MUST-KEEP; "Revert to revision" — NICE (exists only in the dead drawer code `D:4468`; re-add on the page via a full-body PATCH).
- Legacy item drawer (`openItemDrawerImpl` `D:4190`) — DROP (unreachable except via `window.__dsx`).
- Dirty-state guard on leaving an edited item — currently absent; NICE-to-add.

### Datasets — runs / lineage / settings / compare
- Runs tab table + pager — MUST-KEEP.
- Lineage tree + change log — MUST-KEEP.
- Settings: name/description/tags, private test set toggle (admins), delete with typed confirmation — MUST-KEEP.
- Compare: paged kinds, lazy diff bodies, word-level diff with budgets, "Download diff" — MUST-KEEP (word diff can be a small pure module; port the budget logic).

### Hidden behaviors (datasets)
- No polling or live updates. All loads are one-shot; mutations trigger `refreshDetailView({force:true})` (re-fetch dataset + versions + tab).
- Request sequencing guards (`itemsLoadSeq`, `itemPageRenderSeq`, compare `loadSeq`) — replace with React Query cancellation / keyed queries.
- Clipboard: Copy item ID, Copy as JSON, copy field, copy compare identifier (`navigator.clipboard.writeText` + toast).
- Downloads: JSONL via `window.open(…:download)`, diff JSON via Blob.
- Confirm dialogs: delete item, delete dataset (typed name), discard upload, revert (drawer).
- Toasts for every mutation.

### Reviews
- Status tabs with counts and reviewed progress — MUST-KEEP.
- Cursor pagination + infinite scroll + Load more — MUST-KEEP.
- Faceted multiselects with counts and "Only" — MUST-KEEP (foundation Multiselect primitive).
- Source segmented and confidence sliders — MUST-KEEP.
- URL-mirrored filters and `?id=` deep link with ring — MUST-KEEP.
- Sort persisted in localStorage — NICE.
- Card: AI vs Human issue columns, priority, self-approved, review_block tooltips — MUST-KEEP.
- Lazy detail (snapshots, history, scores, metadata) — MUST-KEEP.
- Inline edit form for human issues with new-id handling — MUST-KEEP.
- Single and bulk decisions with expected_count/expected_status concurrency guards and fit-based bulk buttons — MUST-KEEP.
- Delete (mark rejected) single/bulk with alertdialog confirm — MUST-KEEP.
- Keyboard-driven triage (`j k a r e o x / ? Shift+A`) — MUST-KEEP (power-user flow).
- In-place card patching preserving focus (`patchCard` `R:2829`) — behaviour must survive; implementation becomes React state.
- Page-local toast system (`R:1937-2032`) and header-user population (`R:1708-1764`) — DROP (duplicates the shell; use the foundation Toast).
- Counts refresh via `limit=1` list call after each action — NICE (cheap; keep until a dedicated counts endpoint exists).
- Hidden: list requests abort the previous one (`AbortController`), selection cleared on reload, `RESTORING_REVIEWS_VIEW` suppresses scroll on Back/Forward.

### Trash
- Admin-only list with retention copy and purge countdown — MUST-KEEP.
- Search + project facet — MUST-KEEP.
- Single and bulk restore with skipped reasons — MUST-KEEP.
- Sticky Restore column, purge-soon highlighting — NICE.
- No URL state — add (`?q=&project=&page=`).

## 4. Data & API contract

Auth: all dataset routes accept either a UI session (cookie, via `require_ui_principal`) or `Authorization: Bearer <api key>` (`dataset_principal` `API-D:155`); the dashboard sends `QymAuth.getHeaders()` + `credentials:'include'` (`D:747-760`). `project_slug` is a **query parameter on every dataset call** (`D:1438` etc.). Error envelope: FastAPI `{"detail": string | object}`; the UI stringifies objects (`D:767`). Reviews/trash use `/api/*` routes with the UI session only (`require_ui_principal`). Timestamps are ISO strings (`to_api_timestamp`).

Private test sets: `dataset.private_test_set` (admin-only toggle) hides item contents from non-admins. Reads of items (`list_items`, `get_item`, `download`) accept header `X-Qym-Dataset-Read-Token` (`services/dataset_read_tokens.py:33`), which lifts the block **only together with an API key** (`_require_items_visible` `API-D:224-243`); this is the SDK's `QYM_DATASET_READ_TOKEN`, irrelevant to the browser UI. Tokens are issued/revoked by admins under `GET/POST/DELETE /v1/projects/{project_id}/dataset-read-tokens[/{token_id}]` (`api/projects.py:1359-1412`, project-settings area, not this brief). The UI relies on `dataset.items_visible` (viewer-specific) and `dataset.can_set_private_test_set`. Runs on private sets also redact `input/expected/output` in reviews (`redact_item_content`, `API-A:8801`, `9333`).

Permissions object on every dataset payload (`_dataset_permissions` `API-D:501` + `can_set_production` `API-D:604`): `{can_manage, is_creator, can_rename_slug, can_move_production, can_delete, can_restore, can_set_production}`. Rules (server strings `API-D:1826-1829`): only managers change slug / move production / restore; creator or manager deletes; the creator may set the first production alias.

Payload shapes (field: type):

- **Dataset** (`API-D:577-607`): `id, project_id, name, slug, description|null, tags: string[], private_test_set: bool, items_visible: bool, can_set_private_test_set: bool, created_by_user_id, created_by: User|null, created_at, updated_at, production_version: Version|null, latest_version: Version|null, run_count: int, permissions: Permissions`; deleted rows add `deleted_at, deleted_by: User|null, original_slug`.
- **User**: `{id, email, display_name}`.
- **Version** (`API-D:462-487`): `id, dataset_id, version: "vN", name: string, description, status: "draft"|"published", source_type: "api"|"derived"|"csv"|"jsonl"|"json"|…, source_uri, parent_version_id, base_version_id, schema: {input_cols, expected_cols, id_col, metadata_cols, label_cols, encoding?}, labels: string[], item_count: int, run_count: int, content_hash, created_by_user_id, published_by_user_id, created_by: User|null, published_by: User|null, created_at, updated_at, published_at|null, is_default: bool, aliases: string[]` (lineage adds `change_counts: {added, deleted, modified}`).
- **Item** (`API-D:417-433`): `id: int (pk), item_id: string, index: int, input: any, expected_output: any, metadata: object, labels: string[], fingerprint, created_at, updated_at`, plus `run_count?: int`, `result_summary?: {run_count, avg_latency_ms, metrics: {name: {avg, …}}}`, `edit_count` (list only).

| Method | Path | Query / body | Response | Used by |
|---|---|---|---|---|
| GET | `/v1/datasets` (`API-D:1749`) | `project_slug`, `deleted=true`, `limit≤1000`, `offset` | `{project:{id,slug,name}, datasets: Dataset[], total, permissions:{can_manage}}`; live sorted by name, deleted by `deleted_at desc` | catalog `D:1660`, deleted view `D:1829`; `permissions.can_manage` gates Restore |
| POST | `/v1/datasets` (`API-D:1779`) | body `{name, project_slug, slug?, description?, tags?, private_test_set?}` | `{dataset}`; 409 slug conflict | blank wizard `D:1916` |
| GET | `/v1/datasets/{ref}` (`API-D:1813`) | `project_slug`; ref = id, slug or name | `{dataset}`; 404 | detail/compare/item page |
| PATCH | `/v1/datasets/{ref}` (`API-D:1832`) | `{name?, slug?, description?, tags?, private_test_set?}` | `{dataset}`; 403 slug (managers) / private flag (admins); 409 slug | rename, description, settings, visibility |
| DELETE | `/v1/datasets/{ref}` (`API-D:1877`) | — | `{ok:true, restorable:true}`; 403 `DELETE_RULE` | settings danger zone |
| POST | `/v1/datasets/{id}:restore` (`API-D:1905`) | by **id** (not slug) | `{dataset}`; 403 managers only; 404; 409 slug/name taken | deleted view `D:1880` |
| GET | `/v1/datasets/{ref}/versions` (`API-D:1967`) | — | `{dataset, versions: Version[]}` newest first | detail load `D:1448` |
| POST | `/v1/datasets/{ref}/versions` (`API-D:2094`) | `{name?, description?, labels?, version?, from_version?|from_alias?}` | `{version}` (draft; items copied from parent) | create draft `D:5040` |
| PATCH | `/v1/datasets/{ref}/versions/{v}` (`API-D:2189`) | `{name?, description?}` | `{version}` | name version |
| POST | `/v1/datasets/{ref}/versions/{v}:publish` (`API-D:2136`) | `{set_alias?: "production"}` | `{version}`; 400 empty; 403 alias | publish |
| POST | `/v1/datasets/{ref}/aliases/{alias}` (`API-D:2301`) | `{version}` | `{alias:{dataset_id, alias, dataset_version_id}}`; 409 not published; 403 | set production |
| GET | `/v1/datasets/{ref}/runs` (`API-D:1987`) | `version?`, `limit≤500` (default 50), `offset` | `{runs:[{id, run_name, external_run_id, status, task, model, started_at, completed_at, avg_latency_ms, eval_score, metric_averages:{m: num|null}, metric_directions:{m: dir}, version_label, items_count}], total, metric_names}` | runs tab (`limit=100`) |
| GET | `/v1/datasets/{ref}/lineage` (`API-D:2319`) | — | `{dataset, versions: (Version & {change_counts})[] oldest first, changes:[{id, dataset_version_id, parent_version_id, change_summary:{type, item_count?, source_type?, alias?, from_version_id?, actor_user_id?}, actor: User|null, created_at}]}` | lineage tab |
| GET | `/v1/datasets/{ref}/versions/{v}/items` (`API-D:2460`) | `limit≤1000` (default 100), `offset`, `search`, `sort`, `label`, `include_context=false`; header `X-Qym-Dataset-Read-Token` | `{items: Item[] (+edit_count, run_count, result_summary), metric_names: string[], metric_directions: {m: dir}, total, next_offset|null, dataset?, version?}`; 403 private | items tab. Sort keys: `index_asc|index_desc|updated_desc|item_id|item_id_desc|input_asc|input_desc|expected_asc|expected_desc|metadata_asc|metadata_desc|runs_asc|runs_desc|edits_asc|edits_desc|latency_asc|latency_desc|metric:<name>:asc|desc` (`API-D:2379, 2412`) |
| POST | `/v1/datasets/{ref}/versions/{v}/items` (`API-D:2536`) | `{item_id?, input, expected_output?, metadata?, labels?}` | `{item}`; 409 duplicate id; 409 not a draft | add item |
| GET | `…/items/{item_id}` (`API-D:2593`) | — | `{item (+run_count)}`; 404 | item page |
| PATCH | `…/items/{item_id}` (`API-D:2619`) | partial `{item_id?, input?, expected_output?, metadata?, labels?}` (pydantic `exclude_unset`) | `{item}`; unchanged body → no revision; 409 not draft | item page save, (drawer revert sends a full body) |
| DELETE | `…/items/{item_id}` (`API-D:2678`) | — | `{ok:true}` | row menu, item page |
| POST | `…/items:bulk` (`API-D:2713`) | `{upserts:[{item_id?, op?:"create", input, expected_output?, metadata?, labels?}], deletes?: string[]}`, ≤1000 entries (422) | `{summary:{created,updated,deleted}, created: Item[], updated: Item[], deleted: string[]}`; 409 id conflict | add-to-draft import |
| GET | `…/items/{item_id}/runs` (`API-D:2925`) | — | `{item, aggregates:{run_count, success_count, error_count, avg_latency_ms, avg_score, metrics:{m:{count,avg,min,max}}, metric_directions}, runs:[{run_id, run_name, external_run_id, task, dataset, model, status, created_at, started_at, completed_at, owner: User, item_id, output, trace_id, trace_url, error, latency_ms, retry_count, metric_directions, scores:[{metric_name, score_numeric, score_raw, label, explanation}]}]}` | item Runs tab |
| GET | `…/items/{item_id}/neighbors` (`API-D:3061`) | `search`, `sort`, `label` | `{item_id, index, total, previous: Item|null, next: Item|null}`; 404 when not in the filtered set | Prev/Next |
| GET | `…/items/{item_id}/lineage` (`API-D:3122`) | — | `{item_id, lineage:[{version: Version, item: Item|null, revisions:[{id, revision_number, change_type:"created"|"updated"|"deleted", before: Item-ish, after: Item-ish, actor_user_id, actor: User|null, actor_email, actor_name, created_at}]}]}` root→head | item History tab |
| GET | `/api/datasets/{ref}/versions/{v}/items/{item_id}/revisions` (`API-D:3861`) | — | `{revisions:[…]}` newest first | unused by the UI (SDK/legacy) |
| GET | `/v1/datasets/{ref}/versions/{v}:compare` (`API-D:3281`) | `base` (required), `include_diffs=1`, `kind`, `limit≤500`, `offset` | `{base: Version, target: Version, summary:{added,removed,changed,unchanged}}` + un-paged: `added, removed, unchanged: string[]`, `changed:[{item_id, base_index, target_index, edited_by: User|null, changed_at, changed_at_source:"revision"|"version", fields?}]`, `timestamps`; with diffs: `added_items`, `removed_items` (Item & timing), `field_diffs:[changed entry & {before:{input,expected_output,metadata,labels}, after:{…}}]`, `diffs_truncated?, diffs_limit?`; paged (`limit`): `unchanged_items`, `page:{kind, offset, limit, total, next_offset}` | compare view (paged 50) and Download diff (un-paged) |
| POST | `/v1/datasets:upload` (`API-D:3526`) | multipart: `file`, `name`, `project_slug`, `version?`, `version_name?`, `description?`, `tags?`, `labels?`, `publish` ("true"), `set_alias?`, `input_cols`, `expected_cols`, `id_col?`, `metadata_cols`, `label_cols?`, `format` (`csv|jsonl|json`), `encoding?`, `create_only` ("true"), `dataset_ref?`, `private_test_set?` | `{dataset, version}`; 400 no name; 409 name/slug clash (create_only) or renamed dataset; 413 oversized (`read_upload`); 403 alias / private | wizard `D:2804` |
| GET | `/v1/datasets/{ref}/versions/{v}:download` (`API-D:3770`) | header read token optional | streamed `application/x-ndjson`, `Content-Disposition: attachment; filename={slug}-{v}.jsonl`; lines `{item_id,input,expected_output,metadata,labels}` | overflow menu (`window.open`) |
| GET | `/v1/datasets/{ref}/versions/{v}` (`API-D:3846`) | — | `{dataset, version}` | unused by UI |
| GET | `/api/corrections` (`API-A:9346`) | `project_slug?`, `task[]`, `dataset[]`, `model[]`, `run_name[]`, `source` (`ai_only|human_only|corrected`), `conf_min`, `conf_max` (0-100), `status` (`pending|approved|rejected`), `search`, `limit≤500` (default 50), `sort` (`newest|oldest|confidence`), `cursor` | `{corrections: Row[], total, has_more, next_cursor|null, sort, limit, stats:{total,pending,approved,rejected}, tasks[], datasets[], models[], run_names[], facet_counts:{task:{v:n}, dataset, model, run_name}}`; 400 bad sort/cursor; 404 archived project for non-members | list (`limit=25`), counts refresh (`limit=1`) |
| GET | `/api/corrections/{id}` (`API-A:9662`) | — | full Row incl. `history[]` and `*_snapshot`; 403/404 | card detail, `?id=` |
| PUT | `/api/corrections/{id}` (`API-A:9678`) | `{human_root_cause_issues:[{category, subcategory, finding}], human_root_causes, human_root_cause, human_root_cause_detail, human_root_cause_note, …}` | full Row (possibly a **different id**); 409 historical; 400 for issue-scoped rows | edit form |
| POST | `/api/corrections/{id}/approve` (`API-A:9834`) | `{comment}` | full Row; 403 `review_block` reason; 409 edited meanwhile | approve |
| POST | `/api/corrections/{id}/reject` (`API-A:10079`) | `{comment}` | full Row | reject |
| POST | `/api/corrections/{id}/reset` (`API-A:10115`) | `{}` | full Row | reset |
| POST | `/api/corrections/bulk` (`API-A:10155`) | `{ids:int[], action:"approve"|"reject"|"reset"|"delete", comment?, expected_count?, expected_status?}` | `{ok, affected, corrections?: Row[]}`; 409 count/status drift; 403 | bulk bar |
| DELETE | `/api/corrections/{id}` (`API-A:10306`) | — | `{ok, deleted_id, status:"rejected"}` | delete |
| GET | `/api/runs/trash` (`API-R:4675`) | `limit≤200`, `offset`, `project_id?`, `q?` (≤200 chars) | JSON array of `{id, run_name, task, dataset, dataset_version, dataset_aliases, model, trace_stats, status, owner_user_id, deleted_at, deleted_by_user_id, deleted_by_name, created_at, purge_at|null, purge_paused, project_archived, project_id, project_name, project_slug}`; headers `X-Qym-Total-Count`, `X-Qym-Deleted-Run-Grace-Days`; 403 non-admin | trash list |
| GET | `/api/runs/trash/projects` (`API-R:4785`) | — | array `{id, name, slug, archived, deleted_runs}` | project facet |
| POST | `/api/runs/restore` (`API-R:7025`) | `{run_id}` or `{run_ids: string[] ≤200}` | `{ok}` or `{ok, restored: string[], skipped:[{run_id, reason}]}`; 403; 404; 409 archived project (single) | restore |

Correction **Row** (`_serialize_review_fields` `API-A:8526-8617`): `id, revision_id, run_id, item_id, metric_name|null, pass_number|null, pass_deleted_at, issue_id|null, task, dataset, model (provider stripped), has_reasoning, run_name, ai_root_cause, ai_root_causes[], ai_root_cause_issues:[{category, subcategory, finding, category_reason?, confidence?, solution?}], ai_category_taxonomy, ai_root_cause_detail, ai_root_cause_note, ai_confidence: 0..1|null, ai_solution, ai_solution_note, human_* (same set), corrected_by: User|null, created_at, status, is_active, reviewed_by: User|null, reviewed_at, review_comment, self_reviewed: bool, project_slug, project_name, review_rules:{correction_approvers:"members"|"managers", correction_require_different_reviewer: bool}, review_block: string|null`. List rows replace `input_snapshot/expected_snapshot/output_snapshot` with `input_preview/expected_preview/output_preview` (≤280 chars, `API-A:9274`); `scores_snapshot` stays. Detail rows add `history:[{revision_id, revision_number, actor_source, actor_user, before_state, after_state, review:{status, review_comment, pass_number, …}|null, created_at}]`. The UI normalises legacy single-field root causes into issues client-side (`reviewRootCauseIssues` `R:3127`) — the server already does the same, so the React version can rely on `*_root_cause_issues`.

Client-side reshaping worth noting: datasets `metric_names` fallback from item summaries (`D:3432`); catalog version count derived from the latest label `vN` (`D:1793`); reviews rebuild summary rows from full action responses (`summaryRow` `R:2241`) and adjust status counts locally (`shiftStatusCounts` `R:2251`) before `refreshCounts`.

## 5. Shared dependencies

- `shell.js` (`window.QymShell`, export list `shell.js:2896-2941`): `apiUrl`, `navigateTo`, `setBreadcrumbs`, `getProject`/`getRememberedProject`/`getUser`, `toast`, `identicon`, `openFormDialog` (fields: text/textarea/select/checkbox, `validate`, `onSubmit`, `details`, `requireText`), `openConfirmDialog`, `openDrawer` (legacy drawer only), `pageSignal`, `replaceUrlQuery` (reviews URL sync), `skeletonHTML/liftSkeleton/arrive/watchArrivals`, `datasetVersionInline`. Events consumed: `qym:shell-ready`, `qym:popstate`, `qym:before-navigate`. Datasets also reads `window.__QYM_ROOT_PATH__` (injected by `_dashboard_html_response` `API-R:1267`) and `window.__QYM_USER__.projects`.
- `auth.js` (`window.QymAuth`): `requireAuth`, `getHeaders`, `handle401`, `maybePromptBootstrapAdmin`.
- `qym_safe.js` (`QymSafe`): `escapeHtml`, `applyTextDir`, `textDirAttrs` (RTL/Arabic direction per value; keep this behaviour in React via a `dir="auto"`/plaintext helper).
- `qym_table.js` (`QymDataTable.render({host, columns:[{id,label,className,width,minWidth,flex,resizable,sortKey}], rows, renderRow, storageKey, minWidth, scrollLeft, sortState(key)→'ascending'|'descending'|'none', onSort(column, nextDir, sortKey), tableClass})` `qym_table.js:69`): used by datasets items/runs/item-runs/deleted tables and trash. Column widths persist in localStorage by `storageKey`.
- `ui_components.js` (`QymUIComponents` `ui_components.js:1494`): `renderPagination` (page, pageCount, pageSize, pageSizeOptions, total, start, end, noun, onPageChange, onPageSizeChange), `renderErrorState`/`classifyError` (not_found vs other), `openDialog`/`releaseDialog` (focus contract: trap, Esc, restore), `enhanceSelect`.
- `metrics.js` (`QymMetrics`): `parseScoreValue`, `detectMetricTypeFromAvg`, `getMetricColorClass(value, type, direction)`, `formatMetricValueSmart` — datasets metric cells (`D:1141`).
- `trace_viewer.js` (`QymTraceViewer.init({exportMode:false})` + `.trace-drawer-btn[data-trace-endpoint]` delegation) — item Runs tab trace button.
- CSS classes reused from `dashboard.css`/`shell.css`/`ui_components.css`: `shell-btn*`, `shell-modal*`, `shell-form-*`, `shell-drawer-body`, `actions-trigger`, `actions-menu`/`actions-item`, `qym-tabs`, `qym-badge`, `qym-tag--*`, `qym-chip`, `qym-stat-strip*`, `qym-segmented`, `qym-control`/`qym-select`/`qym-search`, `qym-icon-action`, `qym-inline-action*`, `qym-pagination`, `qym-dropdown__*`, `multi-select-*`, `custom-checkbox`/`checkmark`, `status-badge status-*`, `owner-name`/`owner-avatar`, `model-label`/`model-reasoning-badge`, `tv-copy-btn`/`tv-expand-btn`.
- Nothing in this area is imported by other areas. The run page links **into** this area (`/projects/{slug}/datasets/{ref}?…`) and reviews link **out** to `/projects/{slug}/runs/{run_id}?pass=&item=`.

## 6. Design-token usage

- Type roles: `--font-title` (page/hero titles), `--font-xl` (empty-state h3, stat values), `--font-lg` (card titles, section h2), `--font-md` (tabs, body controls), `--font-base` (table cells, meta), `--font-sm` (table headers, chips, pills, help), `--font-xs` (pills, card dates). Mono (`--font-mono`) for item ids, version labels, JSON previews/editors, slugs, timestamps in lineage; sans for everything else — matches rule 4.
- Colors: `--text-primary/secondary/muted` for content; `--text-dim` only on placeholders, separators, disabled (`D:35, 221, 322, 526`); `--accent-primary` (active tab, focus, production), `--accent-secondary` (published pill, links), `--warning` (draft), `--error`, `--success`; surfaces `--bg-base/surface/elevated/hover/void`; borders `--border-subtle/default/strong`; `--control-height`, `--control-radius`, `--space-*`.
- Area-specific CSS that should become component styles: `.dsx-pill` variants (success/warning/published/info/neutral/alias/add/remove) → a `Pill`/`Badge` variant map; `.dsx-version-pill` + popover → `VersionSwitcher`; `.dsx-code` highlight-overlay editor + `.dsx-jtok-*` palette (`#00a8ff`, `#00d4aa`, `#a855f7`) and the preview `tok-*` palette (`#a3e635`, `#facc15`, `#f87171`) → a `JsonEditor`/`JsonView` with tokenised syntax colors (ideally the `--code-*` tokens the docs pages use); `.dsx-diff-pane` before/after + `.dsx-diff-added-tok/removed-tok` → `DiffPane`; `.dsx-lineage-*` tree connectors → `LineageTree`; `.dsx-file-drop` → `FileDropZone`; `.dsx-wizard-steps` → `Stepper`; `.dsx-chipinput` → `TagInput`; reviews `.correction-card`, `.review-issue*`, `.conf-slider`, `.bulk-bar`, `.card-status-badge` → `ReviewCard`, `IssueList`, `RangeSlider`, `BulkBar`; trash sticky `.trash-col-actions` → table "pinned column" option.
- Hardcoded values to tokenise on port: accent alpha washes `rgba(0,212,170,…)`, `rgba(239,68,68,…)`, `rgba(245,158,11,…)`, `rgba(16,185,129,…)`, `rgba(168,85,247,…)` (`D:37,45,144-152`, `R:220-1419`), `#07120f` primary-button text (`D:73`), `#00e6b8` hover (`D:76`), `#f87171` (`R:1268`), fixed px sizes (`13px` icon fonts `D:35, 667`, `14px` swap `D:564`, `32px` empty icon). Datasets hero gradient and trash/reviews shadows use raw `rgba(0,0,0,…)`.
- Sanctioned exceptions: none apply (this is not docs or the SDK UI). The dark-only `color-scheme` rule applies; `<input type=range>` in reviews is styled manually (`R:1400-1420`).

## 7. UX pain points observed

- **Two item editors, one dead**: the item page (`D:3827`) and the legacy drawer (`D:4190`) implement the same editing contract twice; the drawer is unreachable. Revert-to-revision exists only in the drawer.
- Item editing has **no unsaved-changes guard**; Prev/Next, tab clicks and Back discard edits silently. Save re-renders the whole page (focus lost).
- Items **cannot be edited inline** in the table and there is **no multi-select / bulk delete / bulk label** for items; the only bulk path is file import. Deleting many items means N confirm dialogs.
- Every mutation on the detail page triggers `refreshDetailView({force:true})`: three requests and a full tab re-render (scroll position lost, table rebuilt).
- Fixed-position pager (`D:348`) overlaps content at the bottom and depends on sidebar width; `margin-bottom: 48px` hack on the table wrap.
- Table cells rely on **hover-only** popovers for full values; keyboard/touch users must open the item. Rows have `cursor:pointer` and a click handler plus a link in the `#` cell (double affordance).
- Catalog sort is not persisted and not in the URL; search is client-side so projects with >1000 datasets would silently truncate (`limit≤1000`, the UI sends none).
- Upload wizard: no byte progress, no cancellation; large files are parsed fully in the main thread (`csvParseLite` on the whole text, `D:2464`) → UI freezes on multi-MB CSVs; preview shows only 6 columns; the "Map columns" step re-renders the whole table on each select change (focus restored manually `D:2567`).
- Add-to-draft import sends up to N/1000 sequential requests with no partial-failure recovery (a 409 mid-way leaves earlier batches applied).
- Version switcher popover lists are not virtualised (fine until hundreds of versions) and the hero action set changes shape between states, shifting layout.
- Lineage tab mixes a tree and a flat change log; the tree draws orphans flat with no explanation; long version names overflow.
- Compare: "Unchanged" tab loads bodies that nobody reads; the swap button navigates (full re-fetch); no filter/search within a list; UUID item ids become `Item #n` which differs between base/target index.
- Settings: Tags input has no Enter hint and no duplicate check; Save on General reloads everything; visibility toggle commits on change without confirmation (hides items from the whole team instantly).
- Reviews: the toolbar is one long wrapping row of 15+ controls; filters are hard to scan; the status strip doubles as tabs but looks like stat tiles. Cards are tall (two columns + chips + previews), only ~2 fit on a laptop screen; long findings truncate at 300 chars with no expand. The edit form has no taxonomy picker (free text category) and no validation beyond "category required". Toasts are page-local and visually different from the shell's. `?id=` deep links to a correction outside the first page insert it at the top out of order. Range sliders are a poor control for a confidence band (two separate inputs, step 5, no bar between thumbs). Sort lives in localStorage but not the URL, so shared links differ.
- Reviews a11y: cards are `tabindex=-1` articles focused programmatically; many icon buttons rely on `title`; `role=tab` tiles do not control a `tabpanel` id that changes; the modal is a hand-rolled `div.reviews-modal`.
- Trash: no URL state (refresh loses search/project/page); only admins can even see the page but the sidebar item still renders until `/v1/me` resolves; restore has no undo; `window.alert` fallback when the shell toast is missing.
- Everywhere: dialogs are string-built (`innerHTML`) and focus management is hand-coded per page; three different toast implementations; `formatDate` in reviews drops the year (`MM/DD HH:MM`).

## 8. Migration notes

### Proposed React component tree and routes
- Routes (React Router, keep every current URL/param):
  - `/app/projects/:slug/datasets` → `DatasetCatalogPage` (`?q=`, `?view=deleted` → `DeletedDatasetsPage`, add `?sort=`)
  - `/app/projects/:slug/datasets/:ref` → `DatasetDetailPage` (`?tab=items|runs|lineage|settings`, `?v=`, `?page=`, `?search=`, `?sort=`, `?label=`; map `tab=versions` → lineage)
  - same route with `?item=` → `DatasetItemPage` (`?tab=details|runs|history`)
  - `/app/projects/:slug/datasets/:ref/compare` → `DatasetComparePage` (`?base=`, `?head=`, `?tab=`)
  - `/app/projects/:slug/reviews` and `/app/reviews` → `ReviewsPage` (`?status`, `?task`, `?dataset`, `?model`, `?run`, `?source`, `?conf_min`, `?conf_max`, `?q`, `?id`; add `?sort`)
  - `/app/trash` → `TrashPage` (add `?q`, `?project`, `?page`)
- Components:
  - `features/datasets/`
    - `DatasetCatalogPage` → `CatalogToolbar` (SearchInput, SortSelect, NewDatasetMenu), `DatasetCardGrid` → `DatasetCard` (Identicon, UserPill, VersionStateLine, PrivateTag), `CatalogEmptyState`
    - `DeletedDatasetsPage` → `DeletedDatasetsTable` (DataTable), `RestoreButton`
    - `NewDatasetDialog`
    - `UploadWizard` → `WizardStepper`, `SourceStep` (NameField w/ SlugPreview + ClashNotice, FileDropZone, EncodingSelect, FileStatus/ErrorList), `MapColumnsStep` (ColumnMappingTable, MappingSummary), `ReviewStep` (VersionNameField, PublishOptions, IgnoredNotice, PreviewTable), `UploadProgress`; pure modules `csv/parse.ts`, `csv/encoding.ts`, `json/records.ts`, `mapping.ts`
    - `DatasetDetailPage` → `DatasetHero` (TitleEditable, DescriptionEditable, HeroMeta, VersionSwitcher (Combobox+Listbox), HeroActions, OverflowMenu), `DetailTabs`
      - `ItemsTab` → `ItemsToolbar` (SearchInput, LabelChip), `ItemsTable` (DataTable w/ metric columns, `ItemPreviewCell`, `RowActionsMenu`), `AddItemFooter`, `Pagination`, `PrivateItemsLocked`, `ItemsEmptyState`
      - `RunsTab` → `DatasetRunsTable`, `Pagination`
      - `LineageTab` → `LineageTree` → `LineageNode`; `ChangeLog` → `ChangeEntry`
      - `SettingsTab` → `GeneralSettingsForm` (TagInput), `VisibilityCard`, `DangerZone` (DeleteDatasetDialog w/ typed confirm)
    - `DatasetItemPage` → `ItemHeader` (ItemActions: CreateDraft, Delete, PrevNext, Save), `ItemTabs`; `ItemDetailsTab` → `JsonFieldPanel` ×3 (`JsonEditor` w/ TextJsonToggle + TypeTag + ValidationStatus, or `JsonView`), `ItemRunsTab` (StatStrip, ItemRunsTable, TraceButton), `ItemHistoryTab` (RevisionList → RevisionEntry → FieldDiff), `UnsavedChangesGuard`
    - dialogs: `CreateDraftDialog`, `PublishDialog`, `NameVersionDialog`, `AddItemDialog`, `ConfirmDialog`
    - `DatasetComparePage` → `CompareHero` (VersionSelect ×2, SwapButton, Actions), `CompareSummary`, `CompareTabs`, `CompareList` → `DiffRow` (collapsible) → `FieldDiff` (DiffPane ×2), `ShowMore`; pure `diff/wordDiff.ts` (Myers + budgets)
  - `features/reviews/`
    - `ReviewsPage` → `ReviewsHero` (QueueProgress), `StatusTabs`, `ReviewsToolbar` (SelectAll, SearchInput, SortSelect, FacetMultiselect ×4, SourceSegmented, ConfidenceRange, BulkBar, ClearFilters, ResultCount, ShortcutsButton), `CorrectionList` (keyboard navigation hook `useQueueNavigation`) → `CorrectionCard` (CardHeader w/ DecisionButtons + PriorityTag + SelfReviewedTag, ContextChips, IssueColumns → IssueList/IssueCard, IssueEditForm, CardFooter, SnapshotPreviews, CardDetail → SnapshotSection, RevisionHistory, ScoreChips, MetadataJson), `LoadMoreSentinel`, `ReviewsEmptyState`, `CommentDialog`, `ShortcutsDialog`, `ConfirmDeleteDialog`
  - `features/trash/`
    - `TrashPage` → `TrashHeader` (RetentionNote, TotalCount), `TrashToolbar` (SearchInput, ProjectSelect, SelectionLabel, RestoreSelectedButton), `DeletedRunsTable` (DataTable, pinned actions column, SelectAllHeader, PurgeCell, RestoreButton), `Pagination`, `AdminRequiredState`

### State placement
- URL: everything listed under routes above (search/sort/page/tab/version/item for datasets; all review filters + `id`; trash `q/project/page`). Keep `page` 0-based for datasets to preserve deep links (or accept both).
- Local (component/zustand): wizard state, editor drafts and modes, expanded/selected sets in reviews, current card id, in-flight action set, compare expanded rows, version popover open state, trash selection.
- localStorage: DataTable column widths (`datasets.items.v2`, `datasets.runs.v2`, `datasets.item.runs.v4`, `datasets.deleted.v1`, `trash-v2` — reuse keys or migrate), reviews sort (`qym.reviews.sort`), item-run outputs expanded (currently in-memory; fine to persist). sessionStorage dataset name cache can be dropped in favour of the catalog query cache.
- TanStack Query keys (all scoped by `slug`): `['datasets', slug, {deleted}]`, `['dataset', slug, ref]`, `['dataset-versions', slug, ref]`, `['dataset-items', slug, ref, version, {limit, offset, search, sort, label}]`, `['dataset-item', slug, ref, version, itemId]`, `['dataset-item-runs', …]`, `['dataset-item-lineage', …]`, `['dataset-item-neighbors', …, {search, sort, label}]`, `['dataset-runs', slug, ref, {version, page}]`, `['dataset-lineage', slug, ref]`, `['dataset-compare', slug, ref, head, base, kind]` (infinite query, 50/page), `['corrections', filters, sort]` (infinite query, cursor), `['correction', id]`, `['trash', {q, project, page}]`, `['trash-projects']`. Mutations invalidate the dataset/versions/items keys; item PATCH should `setQueryData` on `['dataset-item', …]` and the items list row instead of a full reload. Reviews mutations update the list cache in place (status/counts) then invalidate with `limit=1` counts or re-fetch the first page in the background.

### Backend changes likely needed
- SPA fallback for `/app/*` (foundation). Keep `/projects/{slug}/datasets/{ref:path}` working for old links or redirect to `/app/...`.
- CORS for the Vite dev server on dataset routes (they accept `Authorization` and a custom header; preflight must allow `X-Qym-Dataset-Read-Token` if ever sent from the browser — it is not today).
- Nice-to-have: `GET /v1/datasets` server-side `sort`/`q`; a counts-only corrections endpoint (replaces the `limit=1` trick); `offset`-free cursor for items (optional); bulk item delete (`items:bulk` already supports `deletes`, so the UI can add multi-select without backend work); upload progress needs nothing server-side; a `review` JSON for the trash page's retention could be read from `/api/runs/trash` headers as today.
- The `/api/datasets/.../revisions` route is unused by the UI; leave it.

### Risks / gotchas
- Item `input`/`expected_output` can be any JSON including huge strings (RAG contexts); the editor must stay a textarea (no CodeMirror re-layout per keystroke) and the diff must keep the budgets (`400k chars`, `20k tokens`, `1500 edits`) or run in a worker.
- Type fidelity on save: strings must never be coerced (the `Text`/`JSON` mode contract); `\r\n` normalisation by textareas must not count as an edit; send only touched fields (`exclude_unset` on the server).
- Private test sets: `items_visible === false` must short-circuit every item/compare/download request (the server answers 403, but the UI should not even try) while versions, runs and lineage stay visible. Reviews rows for such runs carry `PRIVATE_TEST_SET_PLACEHOLDER` previews.
- Version resolution order (alias → label → production → latest published → newest) and URL normalisation to `?v=` must be reproduced, or old links change meaning.
- Archived projects: reads work, every write is 409; the UI hides write controls based on `project.is_active`.
- Race conditions: search typing vs. in-flight page loads (abort), compare tab switch vs. "show more" response, reviews list refetch vs. a decision response (keep `review_block`/`self_reviewed` from the action response, not the local patch).
- Reviews concurrency: bulk uses `expected_count` + `expected_status`; show the 409 detail and refetch.
- Virtualisation: items are server-paged (≤250/page) — no virtualisation needed; reviews cards are tall and appended by cursor — virtualise only if pages > ~200 cards; version popover and compare lists are bounded (50/page).
- Upload size: `read_upload` enforces a max (413); surface the message. Parsing in the main thread freezes the UI for large CSVs — move `csv/parse.ts` + encoding scoring into a Web Worker.
- `slugifyDatasetName` and `legacyTextScore` mirror server functions (`API-D:75`, `API-D:1219`); keep them in sync (Vitest fixtures against the Python outputs).
- `navigator.clipboard` requires a secure context; fall back to the foundation `copyText`.
- Trash relative asset URLs (`./static/`) are a legacy quirk; irrelevant once under `/app`.

### Suggested Playwright scenarios
1. Create a blank dataset, open it, create the first draft, add an item via the dialog, see it in the table, publish with "Set as production", confirm the hero shows `v1 Production` and the catalog card says `v1 prod · current`.
2. Import a UTF-8 CSV with `question,answer,id,extra` columns as a new dataset: mapping auto-detects Input/Expected/Item ID/Metadata, review step lists 1 metadata column, submit, items table shows the ID column and N rows.
3. Import a Windows-1256 CSV: encoding is detected, the warning does not appear, the preview shows Arabic text correctly; switch encoding to UTF-8 → error alert blocks Continue.
4. Import a JSONL file with one invalid line: Continue is blocked with "Line 3 is not valid JSON"; fix and re-choose → success.
5. On a draft, open item #2, switch Expected output to JSON mode and type `42`; type tag shows `string → number`; Save; History tab shows an `updated` revision with a "type changed" note; table row shows Edits = 1.
6. Items table: search "foo" (URL gets `?search=foo`), sort by a metric column desc (URL `sort=metric:x:desc`), change page size to 25, reload → same state; Prev/Next on an item follows that order.
7. Published version: item page shows read-only panels and "Create draft to edit"; clicking it lands on the new draft's same item in edit mode.
8. Compare v1 vs v2 with a changed item: summary counts, "Changed" row expanded with word highlights, switch to "Added", URL `?tab=added`, "Download diff" saves a file.
9. Settings: delete dataset requires typing its name; it appears under "Deleted datasets"; Restore (as a manager) brings it back at its original slug; restore as a plain member is refused with the rule tooltip.
10. Reviews: load `/projects/{slug}/reviews?status=pending&source=corrected&conf_max=60`; the filters are applied; press `j`, `a` → card leaves the queue, counts update; `x` on two cards then Shift+A → comment modal, confirm → both approved; `?id=<approved id>` opens the Approved tab with the card ringed and expanded.
11. Reviews: with `correction_require_different_reviewer` on, the author's own pending card shows disabled Approve/Reject with the reason tooltip and `a` shows the "Not allowed" toast.
12. Trash (admin): search by run id, select all restorable rows on the page (archived-project rows stay disabled), "Restore N selected" → rows disappear, toast reports skipped reasons if any; as a non-admin the page shows "Admin access required".

## 9. Open questions

- Should item editing move inline into the table (spreadsheet-like) with multi-row selection and bulk delete (`items:bulk deletes`), or stay page-per-item? The current code explicitly chose "cells are read-only previews; items are edited on the item page only" (`D:3581`).
- Revert-to-revision: re-expose on the item History tab (sends a full-body PATCH) or drop? It only exists in dead drawer code.
- Keep the legacy drawer UX (j/k, side panel) as an optional "quick look" or remove entirely?
- Upload progress: is a Web Worker for CSV parsing in scope, or is a spinner plus a file-size guard enough for v1?
- Catalog sort: add `?sort=` to the URL (and server-side sorting) or keep client-side in-memory?
- Datasets `page` param is 0-based today; keep for compatibility or switch to 1-based with a redirect?
- Private test set toggle: should it require a confirmation dialog (it hides items from the whole team instantly)?
- Reviews toolbar density: collapse facets into a single "Filters" popover/drawer, or keep all controls visible for keyboard triage? The design agent must decide; the keyboard shortcuts must survive either way.
- Reviews `?id=` for a correction outside the loaded page: keep inserting it at the top (out of order) or navigate to a single-correction view?
- Should the reviews sort move from localStorage into the URL (`?sort=`) for shareable links?
- Trash: add URL state (`?q`, `?project`, `?page`) and a per-row undo/notice after restore? Also whether non-admins should see the sidebar entry at all before `/v1/me` resolves.
- Column-width persistence keys: reuse the existing localStorage keys (so widths carry over) or start fresh?
- Metric score colouring in dataset tables depends on `QymMetrics` heuristics (score vs numeric, direction); confirm the foundation exposes an equivalent `MetricValue` primitive before porting.
